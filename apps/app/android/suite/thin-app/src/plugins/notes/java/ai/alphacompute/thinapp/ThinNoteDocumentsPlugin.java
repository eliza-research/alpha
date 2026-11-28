package ai.alphacompute.thinapp;

import ai.eliza.plugins.media.DocumentBytes;
import ai.eliza.plugins.media.DocumentDestinations;
import ai.eliza.plugins.media.DocumentExport;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;

/** Standalone {@code AlphaNoteDocuments} plugin handling text import and export through Android SAF. */
@CapacitorPlugin(name = "AlphaNoteDocuments")
public final class ThinNoteDocumentsPlugin extends Plugin {
    private record Destination(String id, Uri uri) {}

    private final ExecutorService documents = Executors.newSingleThreadExecutor();
    private Destination destination;
    private boolean picking;
    private volatile boolean closed;

    private static JSObject outcome(String status) {
        return new JSObject().put("status", status);
    }

    @PluginMethod public void pick(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(outcome("unavailable"));
            return;
        }
        activity.runOnUiThread(() -> {
            if (closed || picking || activity.isFinishing() || activity.isDestroyed()) {
                call.resolve(outcome("unavailable"));
                return;
            }
            boolean importing = call.getBoolean("importing", false);
            Intent choice = importing
                ? DocumentDestinations.open("text/plain")
                : DocumentDestinations.create("text/plain", DocumentExport.title(call.getString("title", "Note"), "Note") + ".txt");
            destination = null;
            picking = true;
            try {
                startActivityForResult(call, choice, "selected");
            } catch (RuntimeException unavailable) {
                picking = false;
                call.resolve(outcome("unavailable"));
            }
        });
    }

    @ActivityCallback private void selected(PluginCall call, ActivityResult result) {
        picking = false;
        if (call == null) return;
        if (closed || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.resolve(outcome("cancelled"));
            return;
        }
        Uri uri = result.getData().getData();
        if (!DocumentDestinations.admits(uri)) {
            call.resolve(outcome("unavailable"));
            return;
        }
        if (!call.getBoolean("importing", false)) {
            destination = new Destination(UUID.randomUUID().toString(), uri);
            call.resolve(outcome("picked").put("handle", destination.id()));
            return;
        }
        try {
            documents.execute(() -> {
                if (closed) {
                    call.resolve(outcome("cancelled"));
                    return;
                }
                try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
                    if (input == null) {
                        call.resolve(outcome("unreadable"));
                        return;
                    }
                    byte[] bytes = DocumentBytes.read(input, DocumentExport.TEXT_LIMIT);
                    String text = StandardCharsets.UTF_8.newDecoder()
                        .onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT)
                        .decode(ByteBuffer.wrap(bytes))
                        .toString();
                    call.resolve(text.isBlank() || text.indexOf(0) >= 0
                        ? outcome("unreadable")
                        : outcome("picked").put("text", text));
                } catch (Exception unavailable) {
                    call.resolve(outcome("unreadable"));
                }
            });
        } catch (RejectedExecutionException stopped) {
            call.resolve(outcome("cancelled"));
        }
    }

    @PluginMethod public void write(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(outcome("unavailable"));
            return;
        }
        activity.runOnUiThread(() -> {
            Destination asked = destination;
            if (closed || asked == null || !asked.id().equals(call.getString("handle"))) {
                call.resolve(outcome("unavailable"));
                return;
            }
            destination = null;
            try {
                documents.execute(() -> {
                    if (closed) {
                        call.resolve(outcome("cancelled"));
                        return;
                    }
                    try {
                        byte[] content = DocumentExport.utf8(call.getString("text"));
                        call.resolve(outcome(DocumentDestinations.write(
                            getContext().getContentResolver(),
                            asked.uri(),
                            content,
                            () -> {
                                if (closed) throw new IllegalStateException();
                            }
                        ).status));
                    } catch (Exception failure) {
                        call.resolve(outcome("failed"));
                    }
                });
            } catch (RejectedExecutionException stopped) {
                call.resolve(outcome("cancelled"));
            }
        });
    }

    @Override protected Bundle saveInstanceState() {
        return null;
    }

    @Override protected void handleOnDestroy() {
        closed = true;
        destination = null;
        documents.shutdownNow();
        super.handleOnDestroy();
    }
}
