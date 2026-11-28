package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.IAlphaPlatformBroker;
import android.os.RemoteException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONException;

/** Drop-in Capacitor {@code ElizaSecureStore} proxy forwarding package-scoped slot calls to {@link IAlphaPlatformBroker}. */
@CapacitorPlugin(name = "ElizaSecureStore")
public final class RemoteSecureStorePlugin extends Plugin {
    private final ExecutorService workers = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "AlphaRemoteSecureStore");
        thread.setDaemon(true);
        return thread;
    });

    private CoreServiceConnector<IAlphaPlatformBroker> connector;

    @Override public void load() {
        connector = new CoreServiceConnector<>(getContext(), AlphaIpcContract.ACTION_PLATFORM_BROKER, IAlphaPlatformBroker.Stub::asInterface);
        connector.warmUp();
    }

    @Override protected void handleOnDestroy() {
        if (connector != null) connector.close();
        workers.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod public void get(PluginCall call) {
        invoke(call, "get", call.getString("key", ""), null, null);
    }

    @PluginMethod public void set(PluginCall call) {
        invoke(call, "set", call.getString("key", ""), null, call.getString("value", ""));
    }

    @PluginMethod public void remove(PluginCall call) {
        invoke(call, "remove", call.getString("key", ""), null, null);
    }

    @PluginMethod public void compareAndExchange(PluginCall call) {
        invoke(call, "compareAndExchange", call.getString("key", ""), call.getString("expected"), call.getString("value"));
    }

    @PluginMethod public void status(PluginCall call) {
        workers.execute(() -> {
            IAlphaPlatformBroker broker = connector.connect();
            if (broker == null) {
                call.resolve(unavailableStatus());
                return;
            }
            try {
                String raw = broker.secureStoreCall("status", "", null, null);
                call.resolve(raw == null || raw.isBlank() ? unavailableStatus() : new JSObject(raw));
            } catch (JSONException | RemoteException | SecurityException failed) {
                call.resolve(unavailableStatus());
            }
        });
    }

    private void invoke(PluginCall call, String op, String key, String expected, String value) {
        workers.execute(() -> {
            IAlphaPlatformBroker broker = connector.connect();
            if (broker == null) {
                call.resolve(failure(AlphaIpcContract.SECURE_UNAVAILABLE));
                return;
            }
            try {
                String raw = broker.secureStoreCall(op, key, expected, value);
                call.resolve(raw == null || raw.isBlank() ? failure(AlphaIpcContract.SECURE_UNAVAILABLE) : new JSObject(raw));
            } catch (SecurityException denied) {
                call.resolve(failure(AlphaIpcContract.SECURE_DENIED));
            } catch (JSONException | RemoteException failed) {
                call.resolve(failure(AlphaIpcContract.SECURE_UNAVAILABLE));
            }
        });
    }

    private static JSObject failure(String error) {
        return new JSObject().put("ok", false).put("error", error);
    }

    private static JSObject unavailableStatus() {
        return new JSObject()
            .put("ok", false)
            .put("available", false)
            .put("error", AlphaIpcContract.SECURE_UNAVAILABLE)
            .put("backend", "unavailable")
            .put("accessibility", "unavailable")
            .put("synchronized", false)
            .put("accessGroup", "app_only");
    }
}
