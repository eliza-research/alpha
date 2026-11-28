package ai.alphacompute.runtime;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.ipc.IAlphaEventCallback;
import ai.alphacompute.ipc.IAlphaPlatformBroker;
import android.os.Handler;
import android.os.Looper;
import android.os.RemoteException;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONException;
import org.json.JSONObject;

/** Drop-in Capacitor {@code ElizaSignIn} proxy delegating sign-in queries, lease upgrades, and {@code signInSettled} broadcasts to {@link IAlphaPlatformBroker}. */
@CapacitorPlugin(name = "ElizaSignIn")
public final class RemoteSignInPlugin extends Plugin {
    private final ExecutorService workers = Executors.newCachedThreadPool(task -> {
        Thread thread = new Thread(task, "AlphaRemoteSignIn");
        thread.setDaemon(true);
        return thread;
    });
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean observerRegistered = new AtomicBoolean(false);
    private volatile boolean destroyed;
    private CoreServiceConnector<IAlphaPlatformBroker> connector;

    private static final String BILLING_RETURN_DOM_EVENT = "window.dispatchEvent(new CustomEvent('alpha-billing-return'))";

    private final IAlphaEventCallback.Stub signInObserver = new IAlphaEventCallback.Stub() {
        @Override public void onEvent(String subId, long index, String eventJson) {
            if (destroyed) return;
            String eventName = subId == null || subId.isBlank() ? "signInSettled" : subId;
            if (!"signInSettled".equals(eventName) && !"billingReturned".equals(eventName)) {
                return;
            }
            JSObject payload;
            try {
                payload = eventJson == null || eventJson.isBlank() ? new JSObject() : new JSObject(eventJson);
            } catch (JSONException malformed) {
                payload = new JSObject();
            }
            JSObject finalPayload = payload;
            mainHandler.post(() -> {
                if (destroyed) return;
                notifyListeners(eventName, finalPayload);
                if ("billingReturned".equals(eventName)) {
                    var bridge = getBridge();
                    WebView page = bridge == null ? null : bridge.getWebView();
                    if (page != null) {
                        page.evaluateJavascript(BILLING_RETURN_DOM_EVENT, null);
                    }
                }
            });
        }

        @Override public void onEnd(String subId, String kind, String failCode) {
            observerRegistered.set(false);
        }
    };

    @Override public void load() {
        super.load();
        connector = new CoreServiceConnector<>(getContext(), AlphaIpcContract.ACTION_PLATFORM_BROKER, IAlphaPlatformBroker.Stub::asInterface);
        connector.warmUp();
        registerObserverAsync();
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        if (observerRegistered.compareAndSet(true, false) && connector != null) {
            IAlphaPlatformBroker broker = connector.connect(300L);
            if (broker != null) {
                try {
                    broker.unregisterSignInObserver(signInObserver);
                } catch (RemoteException | SecurityException ignored) {
                }
            }
        }
        if (connector != null) connector.close();
        workers.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod public void startEmail(PluginCall call) { forward(call, "startEmail"); }
    @PluginMethod public void startPhone(PluginCall call) { forward(call, "startPhone"); }
    @PluginMethod public void startGoogle(PluginCall call) { forward(call, "startGoogle"); }
    @PluginMethod public void upgradeMailLease(PluginCall call) { forward(call, "upgradeMailLease"); }
    @PluginMethod public void cancelMailLeaseUpgrade(PluginCall call) { forward(call, "cancelMailLeaseUpgrade"); }
    @PluginMethod public void reauthenticate(PluginCall call) { forward(call, "reauthenticate"); }
    @PluginMethod public void resend(PluginCall call) { forward(call, "resend"); }
    @PluginMethod public void verify(PluginCall call) { forward(call, "verify"); }
    @PluginMethod public void sendFactorCode(PluginCall call) { forward(call, "sendFactorCode"); }
    @PluginMethod public void cancel(PluginCall call) { forward(call, "cancel"); }
    @PluginMethod public void signOut(PluginCall call) { forward(call, "signOut"); }
    @PluginMethod public void status(PluginCall call) { forward(call, "status"); }
    @PluginMethod public void serviceInfo(PluginCall call) { forward(call, "serviceInfo"); }

    private void registerObserverAsync() {
        if (destroyed || observerRegistered.get()) return;
        try {
            workers.execute(() -> {
                if (destroyed || observerRegistered.get()) return;
                IAlphaPlatformBroker broker = connector == null ? null : connector.connect();
                if (broker == null) return;
                ensureObserverRegistered(broker);
            });
        } catch (RejectedExecutionException ignored) {
        }
    }

    private void ensureObserverRegistered(IAlphaPlatformBroker broker) {
        if (destroyed || !observerRegistered.compareAndSet(false, true)) return;
        try {
            broker.registerSignInObserver(signInObserver);
        } catch (RemoteException | SecurityException failed) {
            observerRegistered.set(false);
        }
    }

    private void forward(PluginCall call, String method) {
        String argsJson = call.getData() == null ? "{}" : call.getData().toString();
        try {
            workers.execute(() -> {
                IAlphaPlatformBroker broker = connector == null ? null : connector.connect();
                if (broker == null) {
                    call.reject("SignInUnavailable", "SignInUnavailable");
                    return;
                }
                ensureObserverRegistered(broker);
                try {
                    String raw = broker.signInCall(method, argsJson);
                    if (raw == null || raw.isBlank()) {
                        call.reject("Rejected", "Rejected");
                        return;
                    }
                    JSObject parsed = new JSObject(raw);
                    if (parsed.has("error") && !parsed.optBoolean("ok", true)) {
                        String code = parsed.optString("error", "Rejected");
                        String message = parsed.optString("message", code);
                        call.reject(message, code);
                        return;
                    }
                    if ("status".equals(method)) {
                        call.resolve(normalizeStatusReply(parsed));
                        return;
                    }
                    call.resolve(parsed);
                } catch (JSONException malformed) {
                    call.reject("MalformedSignInReply", "MalformedSignInReply");
                } catch (RemoteException | SecurityException refused) {
                    String code = refused instanceof SecurityException ? "Rejected" : "SignInUnavailable";
                    call.reject(code, code);
                }
            });
        } catch (RejectedExecutionException closed) {
            call.reject("SignInUnavailable", "SignInUnavailable");
        }
    }

    private static JSObject normalizeStatusReply(JSObject raw) throws JSONException {
        JSObject out = new JSObject();
        out.put("environment", raw.optString("environment", "production"));
        out.put("methodsKnown", raw.optBoolean("methodsKnown", false));
        out.put("email", raw.optBoolean("email", false));
        out.put("sms", raw.optBoolean("sms", false));
        out.put("google", raw.optBoolean("google", false));
        String googleMode = raw.optString("googleMode", "browser");
        out.put("googleMode", "picker".equals(googleMode) ? "picker" : "browser");

        JSONObject rawAccount = raw.optJSONObject("account");
        boolean signedIn = rawAccount != null
            ? rawAccount.optBoolean("signedIn", false)
            : raw.optBoolean("signedIn", false);
        JSObject account = new JSObject();
        if (signedIn && rawAccount != null) {
            String userId = rawAccount.optString("userId", "");
            String orgId = rawAccount.optString("organizationId", "");
            String credId = rawAccount.optString("credentialId", raw.optString("credentialId", ""));
            if (!userId.isEmpty() && !orgId.isEmpty() && !credId.isEmpty()) {
                account.put("signedIn", true);
                account.put("userId", userId);
                account.put("organizationId", orgId);
                account.put("credentialId", credId);
                Object expiresAt = rawAccount.opt("keyExpiresAt");
                if (expiresAt instanceof Number number) {
                    account.put("keyExpiresAt", number.longValue());
                } else {
                    account.put("keyExpiresAt", JSONObject.NULL);
                }
            } else {
                account.put("signedIn", false);
            }
        } else {
            account.put("signedIn", false);
        }
        out.put("account", account);
        return out;
    }
}
