package ai.alphacompute.alphaphone.overlay;

import android.app.KeyguardManager;
import android.content.Context;
import android.graphics.Rect;
import android.os.UserManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;
import org.json.JSONException;
import org.json.JSONObject;

/** Capacitor bridge allowing the {@code overlay} web surface to drive {@link AlphaVoiceInteractionSession} regions, focus, and app intents. */
@CapacitorPlugin(name = "AlphaOverlayHost")
public final class AlphaOverlayHostPlugin extends Plugin {
    /** Native session delegate receiving overlay region, focus, dismiss, and signed app-open commands. */
    public interface HostDelegate {
        void setTouchableRegions(List<Rect> rects);
        void setFocusable(boolean focusable);
        void dismiss();
        boolean openAppIntent(String uri, String claimId, String payloadJson);
    }

    private static final Set<WeakReference<AlphaOverlayHostPlugin>> INSTANCES = new CopyOnWriteArraySet<>();
    private static volatile WeakReference<HostDelegate> activeHost = new WeakReference<>(null);

    /** Attaches the currently visible {@link AlphaVoiceInteractionSession} delegate. */
    public static void attachHost(HostDelegate host) {
        activeHost = new WeakReference<>(host);
    }

    /** Detaches {@code host} when its session hides or tears down. */
    public static void detachHost(HostDelegate host) {
        if (activeHost.get() == host) {
            activeHost = new WeakReference<>(null);
        }
    }

    /** Returns the currently attached overlay session delegate, or null when inactive. */
    public static HostDelegate currentHost() {
        return activeHost.get();
    }

    /** Whether an active Ask Alpha overlay session is currently attached on an unlocked device. */
    public static boolean isOverlayForeground(Context context) {
        if (context == null || activeHost.get() == null) return false;
        KeyguardManager lock = context.getSystemService(KeyguardManager.class);
        UserManager users = context.getSystemService(UserManager.class);
        return lock != null && users != null && users.isUserUnlocked() && !lock.isDeviceLocked() && !lock.isKeyguardLocked();
    }

    /** Broadcasts an asynchronous cross-app action callback receipt to mounted {@code AlphaOverlayHost} listeners. */
    public static void emitActionResult(JSONObject payload) {
        broadcastEvent("actionResult", payload);
    }

    /** Broadcasts captured Assist context metadata to all mounted {@code AlphaOverlayHost} Capacitor listeners. */
    public static void emitAssistContext(JSONObject payload) {
        broadcastEvent("assistContext", payload);
    }

    private static void broadcastEvent(String eventName, JSONObject payload) {
        JSObject event;
        try {
            event = payload == null ? new JSObject() : JSObject.fromJSONObject(payload);
        } catch (JSONException fallback) {
            event = new JSObject();
        }
        for (WeakReference<AlphaOverlayHostPlugin> ref : INSTANCES) {
            AlphaOverlayHostPlugin instance = ref.get();
            if (instance == null) {
                INSTANCES.remove(ref);
            } else {
                instance.notifyListeners(eventName, event);
            }
        }
    }

    @Override public void load() {
        INSTANCES.add(new WeakReference<>(this));
    }

    @Override protected void handleOnDestroy() {
        INSTANCES.removeIf(ref -> ref.get() == null || ref.get() == this);
        super.handleOnDestroy();
    }

    @PluginMethod public void setTouchableRegions(PluginCall call) {
        HostDelegate host = activeHost.get();
        if (host == null) {
            call.resolve();
            return;
        }
        float density = call.getFloat("density", getContext().getResources().getDisplayMetrics().density);
        if (!Float.isFinite(density) || density <= 0f) density = 1f;
        JSArray raw = call.getArray("rects");
        List<Rect> rects = new ArrayList<>();
        if (raw != null) {
            for (int index = 0; index < raw.length(); index++) {
                JSONObject item = raw.optJSONObject(index);
                if (item == null) continue;
                int left = Math.round((float) item.optDouble("left", 0) * density);
                int top = Math.round((float) item.optDouble("top", 0) * density);
                int right = Math.round((float) item.optDouble("right", 0) * density);
                int bottom = Math.round((float) item.optDouble("bottom", 0) * density);
                if (right > left && bottom > top) {
                    rects.add(new Rect(left, top, right, bottom));
                }
            }
        }
        host.setTouchableRegions(rects);
        call.resolve();
    }

    @PluginMethod public void setFocusable(PluginCall call) {
        HostDelegate host = activeHost.get();
        boolean focusable = Boolean.TRUE.equals(call.getBoolean("focusable", false));
        if (host != null) {
            host.setFocusable(focusable);
        }
        call.resolve();
    }

    @PluginMethod public void dismiss(PluginCall call) {
        HostDelegate host = activeHost.get();
        if (host != null) {
            host.dismiss();
        }
        call.resolve();
    }

    @PluginMethod public void openAppIntent(PluginCall call) {
        HostDelegate host = activeHost.get();
        String uri = call.getString("uri", "");
        String claimId = call.getString("claimId");
        String payloadJson = call.getString("payloadJson");
        boolean opened = host != null && host.openAppIntent(uri, claimId, payloadJson);
        call.resolve(new JSObject().put("opened", opened));
    }
}
