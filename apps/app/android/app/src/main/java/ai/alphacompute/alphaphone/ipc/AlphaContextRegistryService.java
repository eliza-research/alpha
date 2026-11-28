package ai.alphacompute.alphaphone.ipc;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.AlphaSuitePolicy;
import ai.alphacompute.ipc.IAlphaContextObserver;
import ai.alphacompute.ipc.IAlphaContextRegistry;
import android.app.Service;
import android.content.Intent;
import android.os.Binder;
import android.os.IBinder;
import android.os.RemoteCallbackList;
import android.os.RemoteException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Signature-protected Binder registry holding the active foreground Alpha app's bounded context snapshot. */
public final class AlphaContextRegistryService extends Service {
    private record ActiveContext(
        String packageName,
        String view,
        String route,
        String snapshotJson,
        boolean sensitive,
        long updatedAt,
        long expiresAt
    ) {
        boolean expired(long now) {
            return now >= expiresAt;
        }

        String toWireJson() {
            JSONObject out = new JSONObject();
            try {
                out.put("packageName", packageName)
                    .put("view", view)
                    .put("route", route == null ? "" : route)
                    .put("sensitive", sensitive)
                    .put("updatedAt", updatedAt)
                    .put("expiresAt", expiresAt);
                Object parsed = snapshotJson == null || snapshotJson.isBlank()
                    ? new JSONObject()
                    : new JSONTokener(snapshotJson).nextValue();
                out.put("snapshot", parsed);
            } catch (JSONException fallback) {
                try {
                    out.put("snapshot", new JSONObject());
                } catch (JSONException impossible) {
                    throw new IllegalStateException(impossible);
                }
            }
            return out.toString();
        }
    }

    private record ClientRegistration(
        String packageName,
        IBinder token,
        IBinder.DeathRecipient deathRecipient
    ) {
        void unlink() {
            if (token == null || deathRecipient == null) return;
            try {
                token.unlinkToDeath(deathRecipient, 0);
            } catch (RuntimeException ignored) {
            }
        }
    }

    private static final Object STATE_LOCK = new Object();
    private static volatile ActiveContext currentContext;
    private static volatile AlphaContextRegistryService liveInstance;

    private volatile AlphaSuitePolicy policy = AlphaSuitePolicy.defaults();
    private final RemoteCallbackList<IAlphaContextObserver> observers = new RemoteCallbackList<>();
    private final Map<IBinder, ClientRegistration> clientRegistrations = new ConcurrentHashMap<>();

    private final IAlphaContextRegistry.Stub binder = new IAlphaContextRegistry.Stub() {
        @Override public void publishContext(String view, String route, String snapshotJson, boolean sensitive, long leaseMs) {
            String callingPkg = requireAuthorizedPackage();
            if (view == null || view.isBlank()) {
                throw new IllegalArgumentException("Context view is required");
            }
            AlphaSuitePolicy.AppRule rule = policy.ruleForPackage(callingPkg);
            if (rule != null && rule.view() != null && !rule.view().equals(view)) {
                throw new SecurityException("Package " + callingPkg + " cannot publish context for view " + view);
            }
            String bounded = snapshotJson == null ? "{}" : snapshotJson;
            if (bounded.getBytes(StandardCharsets.UTF_8).length > AlphaIpcContract.MAX_CONTEXT_SNAPSHOT_BYTES) {
                throw new IllegalArgumentException("Context snapshot exceeds 32 KiB limit");
            }
            long now = System.currentTimeMillis();
            long clampedLease = Math.max(1_000L, Math.min(AlphaIpcContract.MAX_CONTEXT_LEASE_MS, leaseMs));
            ActiveContext next = new ActiveContext(
                callingPkg,
                view,
                route == null ? "" : route,
                bounded,
                sensitive,
                now,
                now + clampedLease
            );
            String wire;
            synchronized (STATE_LOCK) {
                currentContext = next;
                wire = next.toWireJson();
            }
            broadcastContext(wire);
        }

        @Override public void clearContext(String view) {
            String callingPkg = requireAuthorizedPackage();
            boolean changed = false;
            synchronized (STATE_LOCK) {
                ActiveContext existing = currentContext;
                if (existing != null
                    && existing.packageName().equals(callingPkg)
                    && (view == null || view.isEmpty() || existing.view().equals(view))) {
                    currentContext = null;
                    changed = true;
                }
            }
            if (changed) broadcastContext(null);
        }

        @Override public String getActiveContextJson() {
            String callingPkg = requireAuthorizedPackage();
            if (!policy.isActiveContextReadAllowed(callingPkg)) {
                throw new SecurityException("Active context read not permitted for " + callingPkg);
            }
            return currentActiveContextJson();
        }

        @Override public void registerContextObserver(IAlphaContextObserver observer) {
            String callingPkg = requireAuthorizedPackage();
            if (!policy.isActiveContextReadAllowed(callingPkg)) {
                throw new SecurityException("Context observer not permitted for " + callingPkg);
            }
            if (observer != null) {
                observers.register(observer);
            }
        }

        @Override public void unregisterContextObserver(IAlphaContextObserver observer) {
            requireAuthorizedPackage();
            if (observer != null) {
                observers.unregister(observer);
            }
        }

        @Override public void registerClient(IBinder clientToken) {
            String callingPkg = requireAuthorizedPackage();
            if (clientToken == null) return;
            IBinder.DeathRecipient recipient = () -> handleClientDied(callingPkg, clientToken);
            ClientRegistration registration = new ClientRegistration(callingPkg, clientToken, recipient);
            ClientRegistration previous = clientRegistrations.put(clientToken, registration);
            if (previous != null) {
                previous.unlink();
            }
            try {
                clientToken.linkToDeath(recipient, 0);
            } catch (RemoteException alreadyDead) {
                clientRegistrations.remove(clientToken, registration);
                handleClientDied(callingPkg, clientToken);
            }
        }
    };

    /** In-process accessor for AlphaCore's {@code AlphaVoiceInteractionSession} to read unexpired active app context. */
    public static String currentActiveContextJson() {
        long now = System.currentTimeMillis();
        synchronized (STATE_LOCK) {
            ActiveContext existing = currentContext;
            if (existing == null) return null;
            if (existing.expired(now)) {
                currentContext = null;
                return null;
            }
            return existing.toWireJson();
        }
    }

    /** Clears any context owned by {@code packageName} when that process exits or unbinds and notifies observers. */
    public static void clearForPackage(String packageName) {
        if (packageName == null || packageName.isEmpty()) return;
        boolean changed = false;
        synchronized (STATE_LOCK) {
            ActiveContext existing = currentContext;
            if (existing != null && packageName.equals(existing.packageName())) {
                currentContext = null;
                changed = true;
            }
        }
        if (changed) {
            AlphaContextRegistryService instance = liveInstance;
            if (instance != null) {
                instance.broadcastContext(null);
            }
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        policy = AlphaSuitePolicyLoader.load(this);
        liveInstance = this;
    }

    @Override public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override public void onDestroy() {
        if (liveInstance == this) {
            liveInstance = null;
        }
        for (ClientRegistration registration : clientRegistrations.values()) {
            registration.unlink();
        }
        clientRegistrations.clear();
        observers.kill();
        super.onDestroy();
    }

    private void handleClientDied(String packageName, IBinder token) {
        ClientRegistration removed = clientRegistrations.remove(token);
        if (removed != null) {
            removed.unlink();
        }
        for (ClientRegistration remaining : clientRegistrations.values()) {
            if (packageName.equals(remaining.packageName())) {
                return;
            }
        }
        clearForPackage(packageName);
    }

    private void broadcastContext(String activeJson) {
        int count = observers.beginBroadcast();
        try {
            for (int index = 0; index < count; index++) {
                try {
                    observers.getBroadcastItem(index).onContextChanged(activeJson);
                } catch (RemoteException ignored) {
                }
            }
        } finally {
            observers.finishBroadcast();
        }
    }

    private String requireAuthorizedPackage() {
        String pkg = AlphaIpcContract.verifySameSignaturePackage(this, Binder.getCallingUid(), policy);
        if (pkg == null) {
            throw new SecurityException("Unauthorized IPC caller UID " + Binder.getCallingUid());
        }
        return pkg;
    }
}
