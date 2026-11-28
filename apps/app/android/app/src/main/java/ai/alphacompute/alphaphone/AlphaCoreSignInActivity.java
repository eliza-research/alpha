// spec/app/account/signIn.md, "Story: Sign in with Google"
package ai.alphacompute.alphaphone;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Looper;
import androidx.appcompat.app.AppCompatActivity;
import java.lang.ref.WeakReference;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Translucent, no-history AppCompat trampoline activity hosted inside AlphaCore when an interactive
 * sign-in operation (such as Credential Manager Google picker mode or browser OAuth handoff)
 * requires a live {@link AppCompatActivity} context.
 */
public final class AlphaCoreSignInActivity extends AppCompatActivity {
    /** Optional sibling package name to return to foreground after sign-in settles. */
    public static final String EXTRA_CALLER_PACKAGE = "ai.alphacompute.extra.CALLER_PACKAGE";
    private static final Object WAIT_LOCK = new Object();
    private static final AtomicReference<WeakReference<AlphaCoreSignInActivity>> ACTIVE =
        new AtomicReference<>(new WeakReference<>(null));
    private static CompletableFuture<AlphaCoreSignInActivity> pendingReady;

    /** Returns the currently live trampoline activity, or null when headless. */
    static AlphaCoreSignInActivity current() {
        AlphaCoreSignInActivity live = ACTIVE.get().get();
        if (live == null || live.isFinishing() || live.isDestroyed()) return null;
        return live;
    }

    /**
     * Ensures a resumed {@link AlphaCoreSignInActivity} is available for interactive sign-in
     * calls initiated from headless Binder or overlay threads.
     */
    static AlphaCoreSignInActivity ensureActivity(Context context, String callingPackage, long timeoutMs) {
        AlphaCoreSignInActivity existing = current();
        if (existing != null) return existing;
        if (context == null || Looper.myLooper() == Looper.getMainLooper()) return null;
        CompletableFuture<AlphaCoreSignInActivity> waiter;
        boolean shouldLaunch = false;
        synchronized (WAIT_LOCK) {
            AlphaCoreSignInActivity raced = current();
            if (raced != null) return raced;
            if (pendingReady == null || pendingReady.isDone()) {
                pendingReady = new CompletableFuture<>();
                shouldLaunch = true;
            }
            waiter = pendingReady;
        }
        if (shouldLaunch) {
            try {
                Intent intent = new Intent(context.getApplicationContext(), AlphaCoreSignInActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
                if (callingPackage != null && !callingPackage.isBlank()) {
                    intent.putExtra(EXTRA_CALLER_PACKAGE, callingPackage);
                }
                context.getApplicationContext().startActivity(intent);
            } catch (RuntimeException unavailable) {
                waiter.complete(null);
                return null;
            }
        }
        try {
            return waiter.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (Exception timedOut) {
            return current();
        }
    }

    /** Finishes any currently open trampoline activity cleanly on the UI thread. */
    static void finishActive() {
        AlphaCoreSignInActivity live = current();
        if (live != null) {
            live.runOnUiThread(() -> {
                if (!live.isFinishing() && !live.isDestroyed()) {
                    live.finish();
                    live.overridePendingTransition(0, 0);
                }
            });
        }
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ACTIVE.set(new WeakReference<>(this));
        AlphaCoreSignInHost.shared(this).onHostActivityResume();
    }

    @Override protected void onResume() {
        super.onResume();
        ACTIVE.set(new WeakReference<>(this));
        synchronized (WAIT_LOCK) {
            if (pendingReady != null && !pendingReady.isDone()) {
                pendingReady.complete(this);
            }
        }
        AlphaCoreSignInHost.shared(this).onHostActivityResume();
    }

    @Override protected void onDestroy() {
        AlphaCoreSignInActivity current = ACTIVE.get().get();
        if (current == this) {
            ACTIVE.set(new WeakReference<>(null));
        }
        synchronized (WAIT_LOCK) {
            if (pendingReady != null && !pendingReady.isDone()) {
                pendingReady.complete(null);
            }
        }
        super.onDestroy();
    }
}
