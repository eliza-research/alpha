// spec/app/account/billing.md, "Coming back from the browser, giving up on it, or waiting too long for it, confirms a checkout of this sign-in with Cloud and checks the plan; the return itself changes nothing"
package ai.alphacompute.alphaphone;

import android.content.Intent;
import android.net.Uri;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;

/** Captures verified Stripe billing return deep links and broadcasts return signals to AlphaCore and thin apps. */
public final class BillingReturn {
    private static final AtomicReference<String> pending = new AtomicReference<>();
    private static final AtomicReference<String> checkoutCallerPackage = new AtomicReference<>();
    private static final Set<Consumer<String>> listeners = new CopyOnWriteArraySet<>();

    private BillingReturn() {}

    /** Records the Alpha suite package that initiated the active Stripe checkout or portal visit. */
    public static void recordCheckoutCaller(String packageName) {
        if (packageName != null && !packageName.isBlank()) {
            checkoutCallerPackage.set(packageName);
        }
    }

    /** Returns and clears the package that initiated the most recent Stripe checkout visit. */
    static String consumeCheckoutCaller() {
        return checkoutCallerPackage.getAndSet(null);
    }

    /** Subscribes to verified billing return signals; the argument is the optional Stripe session id or null on cancel. */
    public static AutoCloseable subscribe(Consumer<String> listener) {
        if (listener == null) return () -> {};
        listeners.add(listener);
        return () -> listeners.remove(listener);
    }

    /** Validates and captures an incoming Stripe return deep link. */
    static boolean capture(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return false;
        Uri url = intent.getData();
        if (url == null || !url.isHierarchical() || !"https".equals(url.getScheme()) || url.getFragment() != null
            || !"/alphaphone/billing/return".equals(url.getEncodedPath())) return false;
        String authority = url.getEncodedAuthority(), host = BuildConfig.CLOUD_APP_LINK_HOST;
        if (!host.equals(authority) && !(host + ":443").equals(authority)) return false;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;
        var sessions = url.getQueryParameters("session_id");
        var results = url.getQueryParameters("result");
        if (results.size() != 1) return false;
        if ("success".equals(results.get(0)) && sessions.size() == 1 && sessions.get(0).matches("cs_[A-Za-z0-9_]{1,250}")) {
            String sessionId = sessions.get(0);
            pending.set(sessionId);
            intent.setData(null);
            notifyReturned(sessionId);
            return true;
        }
        if (!"cancel".equals(results.get(0)) || !sessions.isEmpty()) return false;
        intent.setData(null);
        notifyReturned(null);
        return true;
    }

    /** Consumes the pending Stripe checkout session id captured on billing return. */
    static String take() {
        return pending.getAndSet(null);
    }

    private static void notifyReturned(String sessionId) {
        for (Consumer<String> listener : listeners) {
            try {
                listener.accept(sessionId);
            } catch (RuntimeException ignored) {
            }
        }
    }
}
