package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.IAlphaContextRegistry;
import android.os.Binder;
import android.os.IBinder;
import android.os.RemoteException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;
import org.json.JSONObject;

/** Capacitor bridge publishing bounded foreground UI context to {@link IAlphaContextRegistry} and settling signed agent intents. */
@CapacitorPlugin(name = "AlphaContext")
public final class AlphaContextPlugin extends Plugin {
    private final Binder clientToken = new Binder();
    private final ExecutorService workers = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "AlphaContextClient");
        thread.setDaemon(true);
        return thread;
    });

    private CoreServiceConnector<IAlphaContextRegistry> connector;
    private volatile IBinder registeredBinder;

    @Override public void load() {
        connector = new CoreServiceConnector<>(getContext(), AlphaIpcContract.ACTION_CONTEXT_REGISTRY, IAlphaContextRegistry.Stub::asInterface);
        connector.warmUp();
        workers.execute(() -> {
            IAlphaContextRegistry registry = connector.connect();
            if (registry != null) ensureClientRegistered(registry);
        });
    }

    @Override protected void handleOnDestroy() {
        registeredBinder = null;
        if (connector != null) connector.close();
        workers.shutdownNow();
        super.handleOnDestroy();
    }

    private void ensureClientRegistered(IAlphaContextRegistry registry) {
        IBinder remote = registry.asBinder();
        if (remote == null || remote == registeredBinder) return;
        try {
            registry.registerClient(clientToken);
            registeredBinder = remote;
        } catch (RemoteException | SecurityException ignored) {
        }
    }

    /** Clears a foreground view context from native lifecycle callbacks such as {@code onPause}. */
    void clearViewContext(String view) {
        if (view == null || view.isEmpty() || connector == null) return;
        workers.execute(() -> {
            IAlphaContextRegistry registry = connector.connect(500L);
            if (registry == null) return;
            try {
                registry.clearContext(view);
            } catch (RemoteException | SecurityException ignored) {
            }
        });
    }

    @PluginMethod public void publish(PluginCall call) {
        String view = call.getString("view", "");
        String route = call.getString("route", "");
        boolean sensitive = Boolean.TRUE.equals(call.getBoolean("sensitive", false));
        long requestedLease = call.getInt("leaseMs", (int) AlphaIpcContract.DEFAULT_CONTEXT_LEASE_MS);
        long leaseMs = Math.max(1_000L, Math.min(AlphaIpcContract.MAX_CONTEXT_LEASE_MS, requestedLease));
        Object snapshotRaw = call.getData().opt("snapshot");
        String snapshotJson = snapshotRaw == null || snapshotRaw == JSONObject.NULL ? "{}" : snapshotRaw.toString();
        if (view.isEmpty()) {
            call.reject("View is required", AlphaIpcContract.FAIL_ROUTE_REFUSED);
            return;
        }
        if (snapshotJson.getBytes(StandardCharsets.UTF_8).length > AlphaIpcContract.MAX_CONTEXT_SNAPSHOT_BYTES) {
            call.reject("Context snapshot exceeds 32 KiB limit", AlphaIpcContract.FAIL_TOO_LARGE);
            return;
        }
        workers.execute(() -> {
            IAlphaContextRegistry registry = connector.connect();
            if (registry == null) {
                call.resolve(new JSObject().put("published", false));
                return;
            }
            try {
                ensureClientRegistered(registry);
                registry.publishContext(view, route, snapshotJson, sensitive, leaseMs);
                call.resolve(new JSObject().put("published", true));
            } catch (RemoteException | SecurityException failed) {
                call.resolve(new JSObject().put("published", false));
            }
        });
    }

    @PluginMethod public void clear(PluginCall call) {
        String view = call.getString("view", "");
        workers.execute(() -> {
            IAlphaContextRegistry registry = connector.connect();
            boolean cleared = false;
            if (registry != null && !view.isEmpty()) {
                try {
                    registry.clearContext(view);
                    cleared = true;
                } catch (RemoteException | SecurityException ignored) {
                }
            }
            call.resolve(new JSObject().put("cleared", cleared));
        });
    }

    @PluginMethod public void getActive(PluginCall call) {
        workers.execute(() -> {
            IAlphaContextRegistry registry = connector.connect();
            if (registry == null) {
                call.resolve(new JSObject().put("active", JSONObject.NULL));
                return;
            }
            try {
                String json = registry.getActiveContextJson();
                if (json == null || json.isBlank()) {
                    call.resolve(new JSObject().put("active", JSONObject.NULL));
                    return;
                }
                call.resolve(new JSObject().put("active", new JSObject(json)));
            } catch (JSONException | RemoteException | SecurityException refused) {
                call.resolve(new JSObject().put("active", JSONObject.NULL));
            }
        });
    }

    @PluginMethod public void replyAction(PluginCall call) {
        String claimId = call.getString("claimId", "");
        boolean switched = Boolean.TRUE.equals(call.getBoolean("switched", false));
        Object resultRaw = call.getData().opt("result");
        String resultJson = resultRaw == null || resultRaw == JSONObject.NULL ? null : resultRaw.toString();
        String errorCode = call.getString("errorCode");
        if (!(getActivity() instanceof AlphaBaseActivity activity)) {
            call.resolve(new JSObject().put("delivered", false));
            return;
        }
        boolean delivered = activity.replyAction(claimId, switched, resultJson, errorCode);
        call.resolve(new JSObject().put("delivered", delivered));
    }
}
