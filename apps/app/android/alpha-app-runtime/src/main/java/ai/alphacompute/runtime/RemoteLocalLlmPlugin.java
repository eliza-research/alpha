package ai.alphacompute.runtime;

import ai.alphacompute.ipc.IAlphaEventCallback;
import ai.alphacompute.ipc.IAlphaPlatformBroker;
import android.os.Handler;
import android.os.Looper;
import android.os.RemoteException;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;

/** Core-proxied {@code AlphaLocalLlm} plugin delegating on-device Gemma catalog, downloads, lifecycle, inference, and progress events to AlphaCore. */
@CapacitorPlugin(name = "AlphaLocalLlm")
public final class RemoteLocalLlmPlugin extends CorePluginProxy {
    private static final String EVENT_DOWNLOAD_PROGRESS = "downloadProgress";

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean observerRegistered = new AtomicBoolean(false);
    private volatile boolean destroyed;

    private final IAlphaEventCallback.Stub progressObserver = new IAlphaEventCallback.Stub() {
        @Override public void onEvent(String subId, long index, String eventJson) {
            if (destroyed || !EVENT_DOWNLOAD_PROGRESS.equals(subId)) return;
            JSObject payload;
            try {
                payload = eventJson == null || eventJson.isBlank() ? new JSObject() : new JSObject(eventJson);
            } catch (JSONException malformed) {
                payload = new JSObject();
            }
            JSObject finalPayload = payload;
            mainHandler.post(() -> {
                if (!destroyed) {
                    notifyListeners(EVENT_DOWNLOAD_PROGRESS, finalPayload);
                }
            });
        }

        @Override public void onEnd(String subId, String kind, String failCode) {
            observerRegistered.set(false);
        }
    };

    @Override protected String corePluginName() { return "AlphaLocalLlm"; }

    @Override public void load() {
        super.load();
        registerObserverAsync();
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        if (observerRegistered.compareAndSet(true, false)) {
            IAlphaPlatformBroker broker = connectBroker(300L);
            if (broker != null) {
                try {
                    broker.unregisterSignInObserver(progressObserver);
                } catch (RemoteException | SecurityException ignored) {
                }
            }
        }
        super.handleOnDestroy();
    }

    @PluginMethod public void catalog(PluginCall call) { forwardLocalLlm(call, "catalog"); }
    @PluginMethod public void status(PluginCall call) { forwardLocalLlm(call, "status"); }
    @PluginMethod public void download(PluginCall call) { forwardLocalLlm(call, "download"); }
    @PluginMethod public void cancelDownload(PluginCall call) { forwardLocalLlm(call, "cancelDownload"); }
    @PluginMethod public void activate(PluginCall call) { forwardLocalLlm(call, "activate"); }
    @PluginMethod public void unload(PluginCall call) { forwardLocalLlm(call, "unload"); }
    @PluginMethod public void delete(PluginCall call) { forwardLocalLlm(call, "delete"); }
    @PluginMethod public void generate(PluginCall call) { forwardLocalLlm(call, "generate"); }
    @PluginMethod public void setMode(PluginCall call) { forwardLocalLlm(call, "setMode"); }

    private void registerObserverAsync() {
        if (destroyed || observerRegistered.get()) return;
        runBackground(() -> {
            if (destroyed || observerRegistered.get()) return;
            IAlphaPlatformBroker broker = connectBroker();
            if (broker != null) ensureObserverRegistered(broker);
        });
    }

    private void ensureObserverRegistered(IAlphaPlatformBroker broker) {
        if (destroyed || !observerRegistered.compareAndSet(false, true)) return;
        try {
            broker.registerSignInObserver(progressObserver);
        } catch (RemoteException | SecurityException failed) {
            observerRegistered.set(false);
        }
    }

    private void forwardLocalLlm(PluginCall call, String method) {
        String argsJson = call.getData() == null ? "{}" : call.getData().toString();
        runOnWorker(call, () -> {
            IAlphaPlatformBroker broker = connectBroker();
            if (broker == null) {
                call.reject("AlphaCoreUnavailable", "AlphaCoreUnavailable");
                return;
            }
            ensureObserverRegistered(broker);
            try {
                String raw = broker.corePluginCall(corePluginName(), method, argsJson);
                resolveCoreReply(call, raw);
            } catch (RemoteException | SecurityException refused) {
                String code = refused instanceof SecurityException ? "Rejected" : "AlphaCoreUnavailable";
                call.reject(code, code);
            }
        });
    }
}
