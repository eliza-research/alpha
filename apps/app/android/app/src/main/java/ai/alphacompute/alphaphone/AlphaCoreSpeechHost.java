package ai.alphacompute.alphaphone;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Consumer;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Headless host running the genuine {@link AlphaLocalSpeechPlugin} and {@link AlphaCloudSpeechPlugin}
 * pipelines inside the {@code VoiceInteractionSession} overlay without duplicating speech or audio-focus logic.
 */
public final class AlphaCoreSpeechHost implements AutoCloseable {
    @FunctionalInterface
    public interface EventSink {
        void emit(String pluginName, String eventName, JSONObject data);
    }

    private final HeadlessLocalSpeech localSpeech;
    private final HeadlessCloudSpeech cloudSpeech;
    private final Map<String, Method> localMethods;
    private final Map<String, Method> cloudMethods;
    private volatile boolean closed;

    public AlphaCoreSpeechHost(Context context, EventSink sink) {
        Context appContext = context.getApplicationContext();
        this.localSpeech = new HeadlessLocalSpeech(appContext, (event, data) -> sink.emit("AlphaVoiceCloud", event, data));
        this.cloudSpeech = new HeadlessCloudSpeech(appContext, (event, data) -> sink.emit("ElizaCloudSpeech", event, data));
        this.localMethods = indexPluginMethods(AlphaLocalSpeechPlugin.class);
        this.cloudMethods = indexPluginMethods(AlphaCloudSpeechPlugin.class);
        this.localSpeech.load();
        this.cloudSpeech.load();
    }

    /** Invokes a {@code AlphaVoiceCloud} or {@code ElizaCloudSpeech} method headlessly. */
    public boolean dispatch(
        String pluginName,
        String methodName,
        String callId,
        JSONObject options,
        Consumer<JSONObject> resolve,
        BiConsumer<String, String> reject
    ) {
        if (closed) {
            reject.accept("UNAVAILABLE", "Overlay speech host closed");
            return true;
        }
        Plugin target;
        Method method;
        if ("AlphaVoiceCloud".equals(pluginName)) {
            target = localSpeech;
            method = localMethods.get(methodName);
        } else if ("ElizaCloudSpeech".equals(pluginName)) {
            target = cloudSpeech;
            method = cloudMethods.get(methodName);
        } else {
            return false;
        }
        if (method == null) {
            reject.accept("UNIMPLEMENTED", "Unsupported method " + pluginName + "." + methodName);
            return true;
        }
        JSObject data;
        try {
            data = options == null ? new JSObject() : JSObject.fromJSONObject(options);
        } catch (JSONException malformed) {
            data = new JSObject();
        }
        PluginCall call = new PluginCall(null, pluginName, callId, methodName, data) {
            @Override public void resolve(JSObject result) {
                resolve.accept(result == null ? new JSONObject() : result);
            }

            @Override public void resolve() {
                resolve.accept(new JSONObject());
            }

            @Override public void reject(String message, String code, Exception cause, JSObject errorData) {
                reject.accept(code == null || code.isEmpty() ? "ERROR" : code, message == null ? "Speech error" : message);
            }
        };
        try {
            method.invoke(target, call);
        } catch (InvocationTargetException failure) {
            Throwable cause = failure.getTargetException();
            reject.accept("ERROR", cause == null ? "Speech call failed" : String.valueOf(cause.getMessage()));
        } catch (IllegalAccessException | RuntimeException failure) {
            reject.accept("ERROR", failure.getMessage() == null ? "Speech call failed" : failure.getMessage());
        }
        return true;
    }

    /** Notifies both speech pipelines that the Ask Alpha overlay became visible. */
    public void onOverlayShow() {
        if (closed) return;
        localSpeech.onOverlayResume();
        cloudSpeech.onOverlayResume();
    }

    /** Notifies both speech pipelines that the Ask Alpha overlay hid. */
    public void onOverlayHide() {
        if (closed) return;
        localSpeech.onOverlayPause();
        cloudSpeech.onOverlayPause();
    }

    @Override public void close() {
        if (closed) return;
        closed = true;
        localSpeech.onOverlayDestroy();
        cloudSpeech.onOverlayDestroy();
    }

    private static Map<String, Method> indexPluginMethods(Class<?> pluginClass) {
        Map<String, Method> methods = new HashMap<>();
        for (Class<?> cursor = pluginClass; cursor != null && cursor != Object.class; cursor = cursor.getSuperclass()) {
            for (Method method : cursor.getDeclaredMethods()) {
                if (!method.isAnnotationPresent(PluginMethod.class)) continue;
                Class<?>[] params = method.getParameterTypes();
                if (params.length != 1 || params[0] != PluginCall.class) continue;
                if (!methods.containsKey(method.getName())) {
                    method.setAccessible(true);
                    methods.put(method.getName(), method);
                }
            }
        }
        return Collections.unmodifiableMap(methods);
    }

    private static PermissionState microphoneState(Context context) {
        return context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
            ? PermissionState.GRANTED
            : PermissionState.DENIED;
    }

    private static final class HeadlessLocalSpeech extends AlphaLocalSpeechPlugin {
        private final Context appContext;
        private final BiConsumer<String, JSONObject> events;

        HeadlessLocalSpeech(Context appContext, BiConsumer<String, JSONObject> events) {
            this.appContext = appContext;
            this.events = events;
        }

        @Override public Context getContext() {
            return appContext;
        }

        @Override public AppCompatActivity getActivity() {
            return null;
        }

        @Override public Map<String, PermissionState> getPermissionStates() {
            return Collections.singletonMap("microphone", microphoneState(appContext));
        }

        @Override public void requestPermissions(PluginCall call) {
            checkPermissions(call);
        }

        @Override protected boolean launch(PluginCall call, Runnable request) {
            call.reject("Microphone permission must be granted before using voice in the overlay", "permission-denied");
            return false;
        }

        @Override protected void notifyListeners(String eventName, JSObject data, boolean retainUntilConsumed) {
            events.accept(eventName, data == null ? new JSONObject() : data);
        }
    }

    private static final class HeadlessCloudSpeech extends AlphaCloudSpeechPlugin {
        private final Context appContext;
        private final BiConsumer<String, JSONObject> events;

        HeadlessCloudSpeech(Context appContext, BiConsumer<String, JSONObject> events) {
            this.appContext = appContext;
            this.events = events;
        }

        @Override public Context getContext() {
            return appContext;
        }

        @Override public AppCompatActivity getActivity() {
            return null;
        }

        @Override public Map<String, PermissionState> getPermissionStates() {
            return Collections.singletonMap("microphone", microphoneState(appContext));
        }

        @Override public void requestPermissions(PluginCall call) {
            checkPermissions(call);
        }

        @Override protected boolean launch(PluginCall call, Runnable request) {
            call.reject("Microphone permission must be granted before using cloud voice in the overlay", "permission-denied");
            return false;
        }

        @Override protected void notifyListeners(String eventName, JSObject data, boolean retainUntilConsumed) {
            events.accept(eventName, data == null ? new JSONObject() : data);
        }
    }
}
