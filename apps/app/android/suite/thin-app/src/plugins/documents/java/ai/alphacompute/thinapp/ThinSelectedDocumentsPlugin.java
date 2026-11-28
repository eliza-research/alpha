package ai.alphacompute.thinapp;

import ai.alphacompute.runtime.AlphaBaseActivity;
import ai.eliza.plugins.filesystem.browser.StorageBrowser;
import ai.eliza.plugins.filesystem.browser.StorageCatalog;
import ai.eliza.plugins.media.DocumentBytes;
import ai.eliza.plugins.media.DocumentDestinations;
import ai.eliza.plugins.media.SelectedDocumentCalls;
import ai.eliza.plugins.media.SelectedDocuments;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.system.Os;
import android.system.OsConstants;
import android.system.StructStat;
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
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;

/** Standalone {@code SelectedDocuments} plugin managing explicit Android SAF selections and verified attachments. */
@CapacitorPlugin(name = "SelectedDocuments")
public final class ThinSelectedDocumentsPlugin extends Plugin {
    private static final String TRASH_FOLDER = ".Trash-alpha";
    private static final Set<String> STORAGE_ATTACHMENT_TYPES = Set.of(
        "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/tiff", "image/svg+xml",
        "application/pdf", "text/plain", "text/csv", "text/markdown", "application/json"
    );

    private static SelectedDocuments registry;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean picking = new AtomicBoolean();
    private volatile boolean closed;

    static synchronized SelectedDocuments documents(Context context) {
        if (registry == null) {
            Context app = context.getApplicationContext();
            registry = new SelectedDocuments(app, "selected-documents", "document-", uri -> false, ThinIsolatedPdfService.class);
        }
        return registry;
    }

    private SelectedDocuments documents() {
        return documents(getContext());
    }

    @Override public void load() {
        super.load();
        ThinSelectionBridge.register((context, uri, flags) -> documents(context).authorize(uri, flags));
    }

    @PluginMethod public void restoreSelected(PluginCall call) {
        work(call, () -> SelectedDocumentCalls.restore(call, this::documents));
    }

    @PluginMethod public void describeSelected(PluginCall call) {
        work(call, () -> SelectedDocumentCalls.describe(call, this::documents));
    }

    @PluginMethod public void renameSelected(PluginCall call) {
        foreground(call, () -> work(call, () -> {
            if (!AlphaBaseActivity.shareForeground(getActivity())) {
                call.reject("Open and unlock Alpha before renaming this document.");
                return;
            }
            SelectedDocumentCalls.rename(call, this::documents);
        }));
    }

    @PluginMethod public void pdfSelected(PluginCall call) {
        work(call, () -> SelectedDocumentCalls.pdf(call, this::documents));
    }

    @PluginMethod public void readSelected(PluginCall call) {
        work(call, () -> SelectedDocumentCalls.read(call, this::documents));
    }

    @PluginMethod public void forgetSelected(PluginCall call) {
        work(call, () -> SelectedDocumentCalls.forget(call, this::documents));
    }

    @PluginMethod public void openSelected(PluginCall call) {
        foreground(call, () -> work(call, () -> {
            Activity activity = getActivity();
            if (!AlphaBaseActivity.shareForeground(activity)) {
                call.reject("Open and unlock Alpha before using this document.");
                return;
            }
            SelectedDocumentCalls.open(call, this::documents, activity);
        }));
    }

    @PluginMethod public void shareSelected(PluginCall call) {
        foreground(call, () -> work(call, () -> {
            Activity activity = getActivity();
            if (!AlphaBaseActivity.shareForeground(activity)) {
                call.reject("Open and unlock Alpha before using this document.");
                return;
            }
            SelectedDocumentCalls.share(call, this::documents, activity);
        }));
    }

    @PluginMethod public void pickSelected(PluginCall call) {
        foreground(call, () -> {
            if (!picking.compareAndSet(false, true)) {
                call.reject("A document picker is already open.");
                return;
            }
            try {
                Intent intent = DocumentDestinations.open("*/*")
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(call, intent, "picked");
            } catch (RuntimeException failure) {
                picking.set(false);
                call.reject("Android could not open the document picker.");
            }
        });
    }

    @ActivityCallback private void picked(PluginCall call, ActivityResult result) {
        picking.set(false);
        if (call == null || closed) return;
        Intent answer = result.getData();
        Uri uri = answer == null ? null : answer.getData();
        if (result.getResultCode() != Activity.RESULT_OK || !DocumentDestinations.admits(uri)) {
            call.resolve(new JSObject().put("selectionId", ""));
            return;
        }
        work(call, () -> {
            ContentResolver resolver = getContext().getContentResolver();
            int flags = 0;
            int permission = answer.getFlags();
            int read = Intent.FLAG_GRANT_READ_URI_PERMISSION;
            int write = Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
            if ((permission & Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION) != 0 && (permission & read) != 0) {
                int offered = permission & (read | write);
                try {
                    resolver.takePersistableUriPermission(uri, offered);
                    flags = offered;
                } catch (SecurityException refused) {
                    if (offered != read) {
                        try {
                            resolver.takePersistableUriPermission(uri, read);
                            flags = read;
                        } catch (SecurityException ignored) {
                        }
                    }
                }
            }
            try {
                call.resolve(new JSObject().put("selectionId", documents().authorize(uri, flags)));
            } catch (RuntimeException failure) {
                if (flags != 0) documents().releaseUnreferenced(uri);
                call.reject("The selected document could not be opened.");
            }
        });
    }

    @PluginMethod public void attachmentSelected(PluginCall call) {
        foreground(call, () -> work(call, () -> attach(call)));
    }

    private void attach(PluginCall call) {
        String id = call.getString("selectionId");
        SelectedDocuments files = documents();
        try {
            Uri uri = files.resolve(id);
            JSObject before = files.describeSelected(id);
            if (uri == null || !"selected".equals(before.getString("status"))) throw new IllegalStateException();
            String name = before.getString("name");
            String type = DocumentBytes.opaqueMime(before.getString("mimeType"));
            if (name == null || name.isBlank() || name.length() > 255 || type.startsWith("audio/") || type.startsWith("video/")) {
                throw new IllegalArgumentException();
            }
            int limit = attachmentLimit(type);
            byte[] bytes;
            try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                bytes = DocumentBytes.read(input, limit);
            }
            JSObject after = files.describeSelected(id);
            if (!AlphaBaseActivity.shareForeground(getActivity()) || bytes.length == 0 || !uri.equals(files.resolve(id))
                || !Objects.equals(name, after.getString("name"))
                || !Objects.equals(before.getString("mimeType"), after.getString("mimeType"))
                || !Objects.equals(before.opt("size"), after.opt("size"))
                || !Objects.equals(before.opt("modified"), after.opt("modified"))) {
                throw new IllegalStateException();
            }
            call.resolve(new JSObject()
                .put("name", name)
                .put("mimeType", type)
                .put("dataBase64", Base64.encodeToString(bytes, Base64.NO_WRAP)));
        } catch (Exception failure) {
            call.reject("The selected file could not be attached. Select it again or choose a supported file.");
        }
    }

    @PluginMethod public void reviewStorageAttachment(PluginCall call) {
        foreground(call, () -> work(call, () -> {
            try {
                File file = attachmentPath(call);
                String type = StorageBrowser.mime(file.getName());
                StructStat before = Os.lstat(file.getPath());
                String receipt = attachmentReceipt(file, before);
                Double size = call.getDouble("size");
                Double modified = call.getDouble("modified");
                if (size == null || modified == null || size != before.st_size || modified != file.lastModified()
                    || before.st_size < 1 || before.st_size > attachmentLimit(type) || !STORAGE_ATTACHMENT_TYPES.contains(type)
                    || !file.getName().equals(call.getString("name")) || !type.equals(call.getString("mimeType"))
                    || !stillReviewed(call, receipt)) {
                    throw new IllegalStateException();
                }
                call.resolve(new JSObject().put("reviewed", receipt));
            } catch (Exception failure) {
                call.reject("This file changed or cannot be attached. Select it again.");
            }
        }));
    }

    @PluginMethod public void readStorageAttachment(PluginCall call) {
        foreground(call, () -> work(call, () -> {
            try {
                String reviewed = call.getString("reviewed");
                if (reviewed == null || !reviewed.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException();
                File file = attachmentPath(call);
                String type = StorageBrowser.mime(file.getName());
                if (!STORAGE_ATTACHMENT_TYPES.contains(type) || !reviewed.equals(attachmentReceipt(file))) {
                    throw new IllegalStateException();
                }
                byte[] bytes = readReviewedDescriptor(file, reviewed, attachmentLimit(type));
                if (!stillReviewed(call, reviewed)) throw new IllegalStateException();
                call.resolve(new JSObject()
                    .put("name", file.getName())
                    .put("mimeType", type)
                    .put("dataBase64", Base64.encodeToString(bytes, Base64.NO_WRAP)));
            } catch (Exception failure) {
                call.reject("This file changed or cannot be attached. Select it again.");
            }
        }));
    }

    private static int attachmentLimit(String mimeType) {
        return mimeType.startsWith("image/") ? DocumentBytes.CHAT_MAX_BYTES : 15 * 1024 * 1024 / 4 * 3;
    }

    private File attachmentPath(PluginCall call) throws Exception {
        if (closed || !AlphaBaseActivity.shareForeground(getActivity()) || !"granted".equals(StorageCatalog.access(getContext()))) {
            throw new SecurityException();
        }
        StorageCatalog.Volume volume = StorageCatalog.volume(getContext(), call.getString("volume", "primary"));
        if (volume == null) throw new SecurityException();
        return new StorageBrowser(volume.directory, TRASH_FOLDER).resolve(call.getString("path"), false);
    }

    private boolean stillReviewed(PluginCall call, String reviewed) throws Exception {
        return reviewed.equals(attachmentReceipt(attachmentPath(call)));
    }

    private static String attachmentReceipt(File file) throws Exception {
        return attachmentReceipt(file, Os.lstat(file.getPath()));
    }

    private static byte[] readReviewedDescriptor(File file, String reviewed, int limit) throws Exception {
        var descriptor = Os.open(file.getPath(), OsConstants.O_RDONLY | OsConstants.O_NOFOLLOW | OsConstants.O_NONBLOCK, 0);
        try (FileInputStream source = new FileInputStream(descriptor)) {
            StructStat opened = Os.fstat(descriptor);
            if (!reviewed.equals(attachmentReceipt(file, opened)) || opened.st_size < 1 || opened.st_size > limit) {
                throw new IllegalStateException();
            }
            byte[] bytes = DocumentBytes.read(source, limit);
            if (bytes.length != opened.st_size || !reviewed.equals(attachmentReceipt(file, Os.fstat(descriptor)))) {
                throw new IllegalStateException();
            }
            return bytes;
        } finally {
            if (descriptor.valid()) Os.close(descriptor);
        }
    }

    private static String attachmentReceipt(File file, StructStat stat) throws Exception {
        if (!OsConstants.S_ISREG(stat.st_mode)) throw new IllegalStateException();
        String observation = file.getPath() + "\n" + stat.st_dev + "\n" + stat.st_ino + "\n" + stat.st_size + "\n"
            + stat.st_mtim.tv_sec + "\n" + stat.st_mtim.tv_nsec + "\n" + stat.st_ctim.tv_sec + "\n" + stat.st_ctim.tv_nsec;
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(observation.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(digest, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    private void work(PluginCall call, Runnable operation) {
        Runnable stopped = () -> call.reject("Document access closed.");
        try {
            worker.execute(() -> {
                if (closed) stopped.run();
                else operation.run();
            });
        } catch (RejectedExecutionException rejected) {
            stopped.run();
        }
    }

    private void foreground(PluginCall call, Runnable operation) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Open and unlock Alpha before using this document.");
            return;
        }
        activity.runOnUiThread(() -> {
            if (!AlphaBaseActivity.shareForeground(activity)) {
                call.reject("Open and unlock Alpha before using this document.");
            } else {
                operation.run();
            }
        });
    }

    @Override protected void handleOnDestroy() {
        closed = true;
        worker.shutdown();
        super.handleOnDestroy();
    }
}
