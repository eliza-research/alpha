package ai.elizaresearch.alphaphone;

import android.content.Context;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import ai.eliza.plugins.notifications.NotificationMirror;
import ai.eliza.plugins.notifications.NotificationMirrorConfig;

/** Product storage identities and Capacitor values around the shared mirror. */
final class NotificationAccess {
 static final NotificationMirror MIRROR = new NotificationMirror(new NotificationMirrorConfig(
   "alpha-notification-access", "alpha.notification.history.v1", "notification-history.enc", AlphaNotificationListener.class));
 static final Object LOCK = MIRROR.lock;
 private NotificationAccess() {}
 static android.content.ComponentName component(Context c) { return MIRROR.component(c); }
 static android.content.SharedPreferences prefs(Context c) { return MIRROR.prefs(c); }
 static boolean granted(Context c) { return MIRROR.granted(c); }
 static AlphaNotificationListener listener() { return (AlphaNotificationListener) MIRROR.listener(); }
 static long eventGeneration() { return MIRROR.eventGeneration(); }
 static String signature(Context c, String name) throws Exception { return NotificationMirror.signature(c, name); }
 static JSObject status(Context c) throws Exception { return new JSObject(MIRROR.status(c).toString()); }
 static JSObject update(Context c, JSObject input) throws Exception { return new JSObject(MIRROR.update(c, input).toString()); }
 static JSArray apps(Context c) throws Exception { return new JSArray(MIRROR.apps(c).toString()); }
 static JSArray list(Context c) throws Exception { return new JSArray(MIRROR.list(c).toString()); }
 static JSArray history(Context c) throws Exception { return new JSArray(MIRROR.history(c).toString()); }
 static void action(Context c, String id, String revision, boolean open) throws Exception { MIRROR.action(c, id, revision, open); }
 static void pause(Context c, boolean paused) throws Exception { MIRROR.pause(c, paused); }
 static void redact() { MIRROR.redact(); }
 static void clearHistoryBoundary(Context c) { MIRROR.clearHistoryBoundary(c); }
}
