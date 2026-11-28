package ai.alphacompute.thinapp;

import ai.alphacompute.runtime.AlphaBaseActivity;
import ai.eliza.plugins.media.DocumentBytes;
import ai.eliza.plugins.media.DocumentDestinations;
import ai.eliza.plugins.media.DocumentExport;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicReference;

/** Standalone {@code AlphaInboxAttachments} plugin saving reviewed email attachments with digest verification. */
@CapacitorPlugin(name = "AlphaInboxAttachments")
public final class ThinInboxAttachmentsPlugin extends Plugin {
    private record Copy(String name, String mimeType, byte[] bytes) {}

    private static final class Review {
        final String attempt;
        final PluginCall call;
        volatile Copy copy;
        volatile boolean cancelled;

        Review(String attempt, PluginCall call) {
            this.attempt = attempt;
            this.call = call;
        }
    }

    private final ExecutorService storage = Executors.newSingleThreadExecutor();
    private final AtomicReference<Review> active = new AtomicReference<>();

    private void submit(Runnable task, Runnable rejected) {
        try {
            storage.execute(task);
        } catch (RejectedExecutionException stopped) {
            rejected.run();
        }
    }

    @PluginMethod public void saveReviewed(PluginCall call) {
        String attempt = call.getString("attempt");
        Review review = new Review(attempt, call);
        if (attempt == null || !attempt.matches("[1-9][0-9]{0,15}") || !active.compareAndSet(null, review)) {
            resolve(call, "refused");
            return;
        }
        submit(() -> {
            try {
                String encoded = call.getString("dataBase64");
                if (encoded == null || encoded.length() > 7 * 1024 * 1024) throw new IllegalArgumentException();
                call.getData().remove("dataBase64");
                byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                String name = call.getString("name");
                DocumentBytes.validateOpaque(name, bytes);
                if (!DocumentBytes.sha256(bytes).equals(call.getString("sha256"))) throw new SecurityException();
                Copy copy = new Copy(name, DocumentBytes.opaqueMime(call.getString("mimeType")), bytes);
                Activity activity = getActivity();
                if (activity == null) throw new IllegalStateException();
                activity.runOnUiThread(() -> choose(activity, review, copy));
            } catch (Exception failure) {
                finish(review, "refused");
            }
        }, () -> finish(review, "refused"));
    }

    private void choose(Activity activity, Review review, Copy copy) {
        if (!current(review) || !AlphaBaseActivity.shareForeground(activity)) {
            finish(review, "refused");
            return;
        }
        review.copy = copy;
        try {
            startActivityForResult(review.call, DocumentDestinations.create(copy.mimeType(), copy.name()), "saved");
        } catch (RuntimeException unavailable) {
            finish(review, "refused");
        }
    }

    @ActivityCallback private void saved(PluginCall call, ActivityResult result) {
        Review review = active.get();
        if (call == null || review == null || review.call != call) return;
        Copy copy = review.copy;
        if (!current(review) || copy == null) {
            finish(review, "unknown");
            return;
        }
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            finish(review, "cancelled");
            return;
        }
        if (result.getResultCode() != Activity.RESULT_OK) {
            finish(review, "refused");
            return;
        }
        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (!DocumentDestinations.admits(uri)) {
            finish(review, "unknown");
            return;
        }
        submit(() -> {
            if (!current(review)) {
                finish(review, "unknown");
                return;
            }
            DocumentExport.Outcome outcome = DocumentDestinations.write(
                getContext().getContentResolver(),
                uri,
                copy.bytes(),
                () -> {
                    if (!current(review)) throw new IllegalStateException();
                }
            );
            finish(review, current(review) && outcome == DocumentExport.Outcome.EXPORTED ? "saved" : "unknown");
        }, () -> finish(review, "unknown"));
    }

    @PluginMethod public void cancelReviewed(PluginCall call) {
        Review review = active.get();
        if (review != null && review.attempt.equals(call.getString("attempt"))) {
            review.cancelled = true;
            review.copy = null;
        }
        call.resolve();
    }

    private boolean current(Review review) {
        return active.get() == review && !review.cancelled;
    }

    private void finish(Review review, String status) {
        if (!active.compareAndSet(review, null)) return;
        review.copy = null;
        resolve(review.call, status);
    }

    private static void resolve(PluginCall call, String status) {
        call.resolve(new JSObject().put("status", status));
    }

    @Override protected Bundle saveInstanceState() {
        return null;
    }

    @Override protected void handleOnDestroy() {
        Review review = active.get();
        if (review != null) finish(review, "unknown");
        storage.shutdownNow();
        super.handleOnDestroy();
    }
}
