package ai.alphacompute.thinapp;

import ai.alphacompute.runtime.AlphaBaseActivity;
import ai.eliza.plugins.media.DocumentDestinations;
import ai.eliza.plugins.media.DocumentExport;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** Standalone {@code AlphaScan} plugin streaming scanned PDF drafts and saving them with SHA-256 readback verification. */
@CapacitorPlugin(name = "AlphaScan")
public final class ThinScanPlugin extends Plugin {
    private static final long DOCUMENT_LIMIT = 64L * 1024 * 1024;
    private static final int CHUNK_LIMIT = 256 * 1024;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Draft inFlight;

    private static final class Draft {
        final String id = UUID.randomUUID().toString();
        final File file;
        final long length;
        FileOutputStream out;
        long wrote;
        boolean picking;

        Draft(File file, long length) throws IOException {
            this.file = file;
            this.length = length;
            this.out = new FileOutputStream(file, false);
        }

        void closeOut() {
            FileOutputStream stream = out;
            out = null;
            if (stream != null) {
                try {
                    stream.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private void submit(Runnable task, Runnable rejected) {
        try {
            worker.execute(task);
        } catch (RejectedExecutionException stopped) {
            rejected.run();
        }
    }

    @Override public void load() {
        super.load();
        submit(() -> {
            File[] remains = getContext().getCacheDir().listFiles((dir, name) -> name.startsWith("alpha-scan-") && name.endsWith(".pdf"));
            if (remains != null) {
                for (File file : remains) file.delete();
            }
        }, () -> {});
    }

    @PluginMethod public void begin(PluginCall call) {
        submit(() -> {
            Integer length = call.getInt("length");
            if (inFlight != null || length == null || length < 5 || length > DOCUMENT_LIMIT) {
                call.reject("A document cannot start", "SCAN_REFUSED");
                return;
            }
            File temp = null;
            try {
                temp = File.createTempFile("alpha-scan-", ".pdf", getContext().getCacheDir());
                inFlight = new Draft(temp, length);
                call.resolve(new JSObject().put("id", inFlight.id));
            } catch (IOException error) {
                if (temp != null) temp.delete();
                call.reject("The document could not be prepared", "SCAN_REFUSED", error);
            }
        }, () -> call.reject("The document could not be prepared", "SCAN_REFUSED"));
    }

    @PluginMethod public void append(PluginCall call) {
        submit(() -> {
            Draft draft = matching(call);
            String chunk = call.getString("data");
            Integer offset = call.getInt("offset");
            if (draft == null || draft.picking || draft.out == null || offset == null || offset != draft.wrote
                || chunk == null || chunk.length() > ((CHUNK_LIMIT + 2) / 3) * 4) {
                call.reject("The document chunk was refused", "SCAN_REFUSED");
                return;
            }
            try {
                byte[] bytes = Base64.decode(chunk, Base64.NO_WRAP);
                if (bytes.length == 0 || bytes.length > CHUNK_LIMIT || draft.wrote + bytes.length > draft.length) {
                    throw new IOException("Invalid document chunk length");
                }
                if (draft.wrote == 0 && (bytes.length < 5 || bytes[0] != '%' || bytes[1] != 'P'
                    || bytes[2] != 'D' || bytes[3] != 'F' || bytes[4] != '-')) {
                    throw new IOException("Invalid PDF signature");
                }
                draft.out.write(bytes);
                draft.wrote += bytes.length;
                if (draft.wrote == draft.length) {
                    draft.out.flush();
                    draft.closeOut();
                }
                call.resolve();
            } catch (IOException | IllegalArgumentException error) {
                retire(draft);
                call.reject("The document could not be prepared", "SCAN_REFUSED", error);
            }
        }, () -> call.reject("The document chunk was refused", "SCAN_REFUSED"));
    }

    @PluginMethod public void save(PluginCall call) {
        submit(() -> {
            Draft draft = matching(call);
            Activity activity = getActivity();
            if (draft == null || draft.picking || draft.wrote != draft.length
                || activity == null || !AlphaBaseActivity.shareForeground(activity)) {
                call.resolve(status(false, true));
                return;
            }
            draft.closeOut();
            draft.picking = true;
            Intent intent = DocumentDestinations.create("application/pdf", "Scanned document.pdf")
                .addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            activity.runOnUiThread(() -> {
                if (!AlphaBaseActivity.shareForeground(activity)) {
                    submit(() -> {
                        draft.picking = false;
                        call.resolve(status(false, true));
                    }, () -> call.resolve(status(false, true)));
                    return;
                }
                try {
                    startActivityForResult(call, intent, "picked");
                } catch (RuntimeException error) {
                    submit(() -> {
                        retire(draft);
                        call.resolve(status(false, true));
                    }, () -> {
                        draft.closeOut();
                        draft.file.delete();
                        call.resolve(status(false, true));
                    });
                }
            });
        }, () -> call.resolve(status(false, true)));
    }

    @ActivityCallback private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        submit(() -> {
            Draft draft = matching(call);
            Intent data = result.getData();
            Uri uri = data == null ? null : data.getData();
            if (draft == null) {
                call.resolve(status(false, false));
                return;
            }
            if (result.getResultCode() != Activity.RESULT_OK || !DocumentDestinations.admits(uri)) {
                retire(draft);
                call.resolve(status(false, true));
                return;
            }
            DocumentExport.Outcome outcome;
            try {
                draft.closeOut();
                outcome = write(draft, uri);
            } finally {
                retire(draft);
            }
            boolean saved = outcome == DocumentExport.Outcome.EXPORTED;
            JSObject receipt = status(saved, outcome != DocumentExport.Outcome.UNVERIFIED);
            if (saved) {
                int flags = 0;
                if ((data.getFlags() & Intent.FLAG_GRANT_READ_URI_PERMISSION) != 0) {
                    try {
                        getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        flags = Intent.FLAG_GRANT_READ_URI_PERMISSION;
                    } catch (SecurityException ignored) {
                    }
                }
                try {
                    receipt.put("selectionId", ThinSelectedDocumentsPlugin.documents(getContext()).authorize(uri, flags));
                } catch (RuntimeException failure) {
                    if (flags != 0) ThinSelectedDocumentsPlugin.documents(getContext()).releaseUnreferenced(uri);
                }
            }
            call.resolve(receipt);
        }, () -> call.resolve(status(false, false)));
    }

    private DocumentExport.Outcome write(Draft draft, Uri uri) {
        boolean providerWriteAttempted = false;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            ContentResolver resolver = getContext().getContentResolver();
            byte[] buffer = new byte[8192];
            if (draft.file.length() != draft.length) return DocumentExport.Outcome.FAILED;
            try (DigestInputStream source = new DigestInputStream(new FileInputStream(draft.file), digest)) {
                providerWriteAttempted = true;
                try (OutputStream destination = resolver.openOutputStream(uri, "wt")) {
                    if (destination == null) return DocumentExport.Outcome.UNVERIFIED;
                    long length = 0L;
                    for (int count; (count = source.read(buffer)) != -1; ) {
                        if (count == 0 || length + count > draft.length) return DocumentExport.Outcome.UNVERIFIED;
                        destination.write(buffer, 0, count);
                        length += count;
                    }
                    if (length != draft.length) return DocumentExport.Outcome.UNVERIFIED;
                    destination.flush();
                }
            }
            byte[] written = digest.digest();
            try (InputStream provider = resolver.openInputStream(uri)) {
                if (provider == null) return DocumentExport.Outcome.UNVERIFIED;
                DigestInputStream readback = new DigestInputStream(provider, digest);
                for (long remaining = draft.length; remaining > 0L; ) {
                    int count = readback.read(buffer, 0, (int) Math.min(remaining, buffer.length));
                    if (count <= 0) return DocumentExport.Outcome.UNVERIFIED;
                    remaining -= count;
                }
                if (readback.read() != -1 || !MessageDigest.isEqual(written, digest.digest())) {
                    return DocumentExport.Outcome.UNVERIFIED;
                }
            }
            return DocumentExport.Outcome.EXPORTED;
        } catch (IOException | NoSuchAlgorithmException | RuntimeException failure) {
            return DocumentExport.failed(providerWriteAttempted);
        }
    }

    @PluginMethod public void abandon(PluginCall call) {
        submit(() -> {
            Draft draft = matching(call);
            if (draft != null && !draft.picking) retire(draft);
            call.resolve();
        }, call::resolve);
    }

    private Draft matching(PluginCall call) {
        return inFlight != null && inFlight.id.equals(call.getString("id")) ? inFlight : null;
    }

    private void retire(Draft draft) {
        draft.closeOut();
        draft.file.delete();
        if (inFlight == draft) inFlight = null;
    }

    private static JSObject status(boolean confirmed, boolean known) {
        return new JSObject().put("confirmed", confirmed).put("known", known);
    }

    @Override protected void handleOnDestroy() {
        submit(() -> {
            if (inFlight != null) retire(inFlight);
        }, () -> {});
        worker.shutdown();
        super.handleOnDestroy();
    }
}
