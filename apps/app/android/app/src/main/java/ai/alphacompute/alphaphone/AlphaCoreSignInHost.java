// spec/app/account/signIn.md, "Story: Choose how to sign in"; spec/app/account/session.md, "Story: Hold the account signed in"
package ai.alphacompute.alphaphone;

import ai.alphacompute.ipc.AlphaIpcContract;
import ai.eliza.plugins.signin.ElizaSignInPlugin;
import android.content.Context;
import android.content.Intent;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginConfig;
import com.getcapacitor.PluginMethod;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Shared headless host running the genuine {@link ElizaSignInPlugin} state machine inside AlphaCore
 * so standalone thin apps (such as {@code ai.alphacompute.settings}) and the Ask Alpha overlay
 * execute full Email/Phone OTP, Google OAuth, 2FA, mail lease upgrade, and sign-out flows directly
 * over {@code DeviceCustody} without duplicating sign-in policy.
 */
public final class AlphaCoreSignInHost {
    private static final long STANDARD_TIMEOUT_MS = 25_000L;
    private static final long BROWSER_OAUTH_TIMEOUT_MS = 180_000L;
    private static final long ACTIVITY_LAUNCH_TIMEOUT_MS = 5_000L;
    private static final Set<String> BROWSER_METHODS = Set.of("startGoogle", "upgradeMailLease", "reauthenticate");
    private static final Set<String> ACTIVITY_HOSTED_METHODS = Set.of("startGoogle", "upgradeMailLease");
    private static final Object SINGLETON_LOCK = new Object();
    private static AlphaCoreSignInHost sharedInstance;

    /** Listener notified whenever {@code ElizaSignInPlugin} emits {@code signInSettled} or {@code signInReadinessChanged}. */
    @FunctionalInterface
    public interface EventListener {
        /** Receives a sign-in plugin event payload. */
        void onEvent(String eventName, JSONObject data);
    }

    private final Context appContext;
    private final HeadlessSignInPlugin plugin;
    private final Map<String, Method> methods;
    private final Set<EventListener> listeners = new CopyOnWriteArraySet<>();
    private final AtomicReference<String> pendingBrowserCaller = new AtomicReference<>();

    private AlphaCoreSignInHost(Context context) {
        this.appContext = context.getApplicationContext();
        PluginConfig config = CapConfig.loadDefault(this.appContext).getPluginConfiguration("ElizaSignIn");
        this.plugin = new HeadlessSignInPlugin(this.appContext, config, this::handlePluginEvent);
        this.methods = indexPluginMethods(ElizaSignInPlugin.class);
        this.plugin.load();
    }

    /** Returns the process-wide shared sign-in host backed by AlphaCore's {@code ElizaSignIn} configuration. */
    public static AlphaCoreSignInHost shared(Context context) {
        synchronized (SINGLETON_LOCK) {
            if (sharedInstance == null) {
                sharedInstance = new AlphaCoreSignInHost(context);
            }
            return sharedInstance;
        }
    }

    /** Subscribes to live {@code signInSettled} and {@code signInReadinessChanged} events from this host. */
    public AutoCloseable subscribe(EventListener listener) {
        if (listener == null) return () -> {};
        listeners.add(listener);
        return () -> listeners.remove(listener);
    }

    /** Notifies the hosted {@link ElizaSignInPlugin} that a foreground sign-in activity resumed. */
    void onHostActivityResume() {
        plugin.resumeHeadless();
    }

    /** Dispatches an {@code ElizaSignIn} method asynchronously and settles via {@code resolve} or {@code reject}. */
    public void dispatch(
        String callingPackage,
        String methodName,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        if ("openSignIn".equals(methodName)) {
            openSignInSurface(callingPackage, resolve, reject);
            return;
        }
        Method method = methods.get(methodName);
        if (method == null) {
            reject.accept("UNIMPLEMENTED", "Unsupported ElizaSignIn method: " + methodName);
            return;
        }
        if (BROWSER_METHODS.contains(methodName)
            && callingPackage != null
            && !callingPackage.isBlank()
            && !AlphaIpcContract.CORE_PACKAGE.equals(callingPackage)) {
            pendingBrowserCaller.set(callingPackage);
        }
        boolean launchedTrampoline = false;
        if (ACTIVITY_HOSTED_METHODS.contains(methodName) && AlphaCoreSignInActivity.current() == null) {
            launchedTrampoline = AlphaCoreSignInActivity.ensureActivity(appContext, callingPackage, ACTIVITY_LAUNCH_TIMEOUT_MS) != null;
        }
        boolean closeTrampolineOnReject = launchedTrampoline;
        JSONObject rawArgs = options == null ? new JSONObject() : options;
        if (!rawArgs.has("environment") && needsEnvironment(methodName)) {
            try {
                rawArgs = new JSONObject(rawArgs.toString()).put("environment", "production");
            } catch (JSONException ignored) {
            }
        }
        JSObject data;
        try {
            data = JSObject.fromJSONObject(rawArgs);
        } catch (JSONException malformed) {
            data = new JSObject();
        }
        PluginCall call = new PluginCall(null, "ElizaSignIn", "core-signin-" + UUID.randomUUID(), methodName, data) {
            @Override public void resolve(JSObject result) {
                resolve.accept(result == null ? new JSONObject() : result);
            }

            @Override public void resolve() {
                resolve.accept(new JSONObject());
            }

            @Override public void reject(String message, String code, Exception cause, JSObject errorData) {
                if (closeTrampolineOnReject) {
                    AlphaCoreSignInActivity.finishActive();
                }
                String resolvedCode = code == null || code.isEmpty() ? "Rejected" : code;
                String resolvedMessage = message == null || message.isEmpty() ? resolvedCode : message;
                reject.accept(resolvedCode, resolvedMessage);
            }
        };
        try {
            method.invoke(plugin, call);
        } catch (InvocationTargetException failure) {
            if (closeTrampolineOnReject) AlphaCoreSignInActivity.finishActive();
            Throwable cause = failure.getTargetException();
            reject.accept("Unavailable", cause == null ? "Sign-in call failed" : String.valueOf(cause.getMessage()));
        } catch (IllegalAccessException | RuntimeException failure) {
            if (closeTrampolineOnReject) AlphaCoreSignInActivity.finishActive();
            reject.accept("Unavailable", failure.getMessage() == null ? "Sign-in call failed" : failure.getMessage());
        }
    }

    /** Executes an {@code ElizaSignIn} broker call synchronously and returns the flat JSON payload expected by {@code RemoteSignInPlugin}. */
    public String invokeSync(String callingPackage, String methodName, String argsJson) {
        JSONObject options;
        try {
            options = argsJson == null || argsJson.isBlank() ? new JSONObject() : new JSONObject(argsJson);
        } catch (JSONException malformed) {
            options = new JSONObject();
        }
        CompletableFuture<String> pending = new CompletableFuture<>();
        dispatch(
            callingPackage,
            methodName,
            options,
            data -> pending.complete((data == null ? new JSONObject() : data).toString()),
            (code, message) -> pending.complete(errorJson(code, message))
        );
        long timeoutMs = BROWSER_METHODS.contains(methodName) ? BROWSER_OAUTH_TIMEOUT_MS : STANDARD_TIMEOUT_MS;
        try {
            return pending.get(timeoutMs, TimeUnit.MILLISECONDS);
        } catch (Exception timedOut) {
            return errorJson("Unavailable", "Sign-in request timed out");
        }
    }

    private void handlePluginEvent(String eventName, JSONObject data) {
        for (EventListener listener : listeners) {
            try {
                listener.onEvent(eventName, data);
            } catch (RuntimeException ignored) {
            }
        }
        if ("signInSettled".equals(eventName)) {
            String callerPkg = pendingBrowserCaller.getAndSet(null);
            if (callerPkg != null && AlphaIpcContract.hasCoreSignature(appContext, callerPkg)) {
                restoreCallerPackage(callerPkg);
            }
            AlphaCoreSignInActivity.finishActive();
        }
    }

    private void restoreCallerPackage(String packageName) {
        try {
            Intent launch = appContext.getPackageManager().getLaunchIntentForPackage(packageName);
            if (launch == null) {
                launch = new Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_LAUNCHER)
                    .setPackage(packageName);
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            appContext.startActivity(launch);
        } catch (RuntimeException ignored) {
        }
    }

    private void openSignInSurface(String callingPackage, Consumer<JSONObject> resolve, BiConsumer<String, String> reject) {
        try {
            Intent intent = new Intent(appContext, AlphaCoreSignInActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (callingPackage != null && !callingPackage.isBlank()) {
                intent.putExtra(AlphaCoreSignInActivity.EXTRA_CALLER_PACKAGE, callingPackage);
            }
            appContext.startActivity(intent);
            JSONObject out = new JSONObject();
            out.put("opened", true);
            resolve.accept(out);
        } catch (JSONException | RuntimeException unavailable) {
            reject.accept("Unavailable", "Sign-in activity unavailable");
        }
    }

    private static boolean needsEnvironment(String methodName) {
        return switch (methodName) {
            case "status", "serviceInfo", "startEmail", "startPhone", "startGoogle",
                "reauthenticate", "upgradeMailLease", "cancelMailLeaseUpgrade", "signOut" -> true;
            default -> false;
        };
    }

    private static String errorJson(String code, String message) {
        JSONObject out = new JSONObject();
        try {
            out.put("ok", false)
                .put("error", code == null || code.isEmpty() ? "Rejected" : code)
                .put("message", message == null || message.isEmpty() ? "Sign-in failed" : message);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return out.toString();
    }

    private static Map<String, Method> indexPluginMethods(Class<?> pluginClass) {
        Map<String, Method> found = new HashMap<>();
        for (Class<?> cursor = pluginClass; cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
            for (Method method : cursor.getDeclaredMethods()) {
                if (!method.isAnnotationPresent(PluginMethod.class)) continue;
                Class<?>[] params = method.getParameterTypes();
                if (params.length != 1 || params[0] != PluginCall.class) continue;
                if (!found.containsKey(method.getName())) {
                    method.setAccessible(true);
                    found.put(method.getName(), method);
                }
            }
        }
        return Collections.unmodifiableMap(found);
    }

    private static final class HeadlessSignInPlugin extends ElizaSignInPlugin {
        private final Context appContext;
        private final PluginConfig config;
        private final BiConsumer<String, JSONObject> events;

        HeadlessSignInPlugin(Context appContext, PluginConfig config, BiConsumer<String, JSONObject> events) {
            this.appContext = appContext;
            this.config = config;
            this.events = events;
        }

        @Override public Context getContext() {
            return appContext;
        }

        @Override public PluginConfig getConfig() {
            return config;
        }

        @Override public AppCompatActivity getActivity() {
            return AlphaCoreSignInActivity.current();
        }

        @Override protected void notifyListeners(String eventName, JSObject data, boolean retainUntilConsumed) {
            events.accept(eventName, data == null ? new JSONObject() : data);
        }

        void resumeHeadless() {
            handleOnResume();
        }
    }
}
