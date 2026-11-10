package ai.alphacompute.alphaphone;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.net.Uri;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/**
 * Keeps an explicitly started Maps navigation session alive while the screen is off.
 *
 * <p>A location-type foreground service lets the existing native location watch keep
 * delivering fixes to the renderer, which owns guidance and voice. The ongoing notification
 * mirrors the next instruction and offers Stop. The service never requests location itself,
 * never starts navigation on its own, and a session stops exactly once: from the app, from
 * the notification, or when the task is removed.</p>
 */
public final class AlphaNavigationService extends Service {
 static final String ACTION_SHOW_MAPS="ai.alphacompute.alphaphone.action.SHOW_NAVIGATION";
 static final String CHANNEL = "alpha.maps.navigation";
 static final int NOTIFICATION_ID = 0x4d415053; // "MAPS"
 static final String ACTION_START = "ai.alphacompute.alphaphone.navigation.START";
 static final String ACTION_UPDATE = "ai.alphacompute.alphaphone.navigation.UPDATE";
 static final String ACTION_STOP = "ai.alphacompute.alphaphone.navigation.STOP";
 static final String EXTRA_SESSION = "session", EXTRA_AUTHORITY = "authority", EXTRA_REASON = "reason";
 static final String SESSION_PATTERN = "[A-Za-z0-9_-]{8,80}";

 /** Receives the single terminal stop of a session; the Maps bridge that started it owns it. */
 interface StopListener { void stopped(String session, String reason); }

 private static final class Session {
  final String id;
  final StopListener owner;
  final ComponentName rootComponent;
  final String authority = UUID.randomUUID().toString();
  String title, text;
  Session(String id, StopListener owner, ComponentName rootComponent, String title, String text) {
   this.id = id;
   this.owner = owner;
   this.rootComponent = rootComponent;
   this.title = bounded(title);
   this.text = bounded(text);
  }
  boolean matches(Intent command) {
   return id.equals(command.getStringExtra(EXTRA_SESSION)) && authority.equals(command.getStringExtra(EXTRA_AUTHORITY));
  }
 }

 private static final Object lock = new Object();
 private static Session active;
 private static int stopCount;
 private static String lastStopReason = "";
 private static String lastTitle = "", lastText = "";

 static String activeSession() { synchronized (lock) { return active == null ? null : active.id; } }

 /** Instrumentation-visible state: active session, total terminal stops and last reason. */
 static String[] snapshot() {
  synchronized (lock) { return new String[]{active == null ? "" : active.id, String.valueOf(stopCount), lastStopReason, lastTitle, lastText}; }
 }

 /** True when this build declares the service; a build without the manifest entry stays foreground-only. */
 static boolean declared(Context context) {
  try {
   ServiceInfo info = context.getPackageManager().getServiceInfo(new ComponentName(context, AlphaNavigationService.class), 0);
   return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || (info.getForegroundServiceType() & ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) != 0;
  } catch (PackageManager.NameNotFoundException missing) { return false; }
 }

 static boolean locationGranted(Context context) {
  return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
   || context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
 }

 static boolean start(Context context, String id, String title, String text, StopListener owner, ComponentName rootComponent, BooleanSupplier admitted) {
  final Session session;
  final Session replaced;
  synchronized (lock) {
   if (!admitted.getAsBoolean()) return false;
   replaced = retireLocked("replaced");
   session = new Session(id, owner, rootComponent, title, text);
   active = session;
   lastTitle = session.title;
   lastText = session.text;
  }
  try {
   if (replaced != null) dispatchStop(context, replaced, "replaced");
   synchronized (lock) {
    if (active != session || !admitted.getAsBoolean()) return false;
   }
   context.startForegroundService(intent(context, ACTION_START, session));
  } catch (RuntimeException refused) {
   final Session retired;
   synchronized (lock) {
    retired = active == session ? retireLocked("refused") : null;
   }
   if (retired != null) dispatchStop(context, retired, "refused");
   throw refused;
  }
  synchronized (lock) { return active == session && admitted.getAsBoolean(); }
 }

 static boolean update(Context context, String id, String title, String text, StopListener owner) {
  final Session session;
  synchronized (lock) {
   if (active == null || active.owner != owner || !active.id.equals(id)) return false;
   session = active;
   session.title = lastTitle = bounded(title);
   session.text = lastText = bounded(text);
  }
  context.startService(intent(context, ACTION_UPDATE, session));
  return true;
 }

 /** Retires only this bridge owner's session. A null id is used by renderer destruction. */
 static boolean stop(Context context, String id, StopListener owner, String reason) {
  final Session session;
  synchronized (lock) {
   if (active == null || active.owner != owner || (id != null && !active.id.equals(id))) return false;
   session = retireLocked(reason);
  }
  dispatchStop(context, session, reason);
  return true;
 }

 /** Caller holds lock. Delivery occurs outside it, against the retired session's exact listener. */
 private static Session retireLocked(String reason) {
  Session retired = active;
  if (retired != null) {
   active = null;
   stopCount++;
   lastStopReason = reason;
  }
  return retired;
 }

 private static void notifyStopped(Session retired, String reason) {
  if (retired != null) retired.owner.stopped(retired.id, reason);
 }

 private static void dispatchStop(Context context, Session retired, String reason) {
  try {
   notifyStopped(retired, reason);
  } finally {
   try { context.startService(intent(context, ACTION_STOP, retired).putExtra(EXTRA_REASON, reason)); }
   catch (RuntimeException backgroundRestricted) {
    // An exact STOP command is preferred. Android's unscoped stopService is safe only
    // while the service has no successor, including a successor still awaiting START.
    synchronized (lock) {
     if (active == null) context.stopService(new Intent(context, AlphaNavigationService.class));
    }
   }
  }
 }

 private static Intent intent(Context context, String action, Session session) {
  Intent command = new Intent(context, AlphaNavigationService.class).setAction(action);
  if (session != null) command.putExtra(EXTRA_SESSION, session.id).putExtra(EXTRA_AUTHORITY, session.authority);
  return command;
 }

 private static String bounded(String value) {
  if (value == null) return "";
  String clean = value.replaceAll("[\\u0000-\\u001f]", " ").trim();
  return clean.length() > 200 ? clean.substring(0, 200) : clean;
 }

 /** The session this service instance last entered the foreground for. */
 private Session owned;

 @Override public IBinder onBind(Intent intent) { return null; }

 @Override public int onStartCommand(Intent intent, int flags, int startId) {
  String action = intent == null ? null : intent.getAction();
  Session retired = null;
  String reason = "refused";
  synchronized (lock) {
   if (ACTION_STOP.equals(action)) {
    if (active != null && active.matches(intent)) {
     reason = intent.getStringExtra(EXTRA_REASON) == null ? "notification" : intent.getStringExtra(EXTRA_REASON);
     retired = retireLocked(reason);
    }
    endIfIdle(startId);
   } else {
    boolean live = active != null && intent != null && active.matches(intent);
    if (ACTION_START.equals(action) || (ACTION_UPDATE.equals(action) && live)) {
     // A queued START must satisfy Android even after its owner retired. Publish the
     // current session's instruction if one exists, never the stale command's data.
     try {
      Notification notification = notification(active);
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
      else startForeground(NOTIFICATION_ID, notification);
      owned = active;
     } catch (RuntimeException refused) {
      if (live) retired = retireLocked(reason);
     }
    }
    endIfIdle(startId);
   }
  }
  notifyStopped(retired, reason);
  return START_NOT_STICKY;
 }

 @Override public void onTaskRemoved(Intent rootIntent) {
  final Session retired;
  // Android reports a task from this package, which can belong to a different Activity.
  ComponentName removedRoot = rootIntent == null ? null : rootIntent.getComponent();
  synchronized (lock) {
   retired = owned != null && active == owned && removedRoot != null && removedRoot.equals(owned.rootComponent)
    ? retireLocked("task-removed") : null;
   endIfIdle(-1);
  }
  notifyStopped(retired, "task-removed");
  super.onTaskRemoved(rootIntent);
 }

 @Override public void onDestroy() {
  final Session retired;
  synchronized (lock) {
   retired = owned != null && active == owned ? retireLocked("destroyed") : null;
  }
  notifyStopped(retired, "destroyed");
  super.onDestroy();
 }

 /** Caller holds lock. A queued command for another owner cannot remove its foreground. */
 private void endIfIdle(int startId) {
  if (active != null) return;
  stopForeground(STOP_FOREGROUND_REMOVE);
  if (startId < 0) stopSelf(); else stopSelf(startId);
 }

 private Notification notification(Session session) {
  NotificationManager manager = getSystemService(NotificationManager.class);
  if (manager.getNotificationChannel(CHANNEL) == null) {
   NotificationChannel channel = new NotificationChannel(CHANNEL, "Maps navigation", NotificationManager.IMPORTANCE_LOW);
   channel.setDescription("Shows the next instruction while Maps navigation runs with the screen off");
   channel.setShowBadge(false);
   channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
   manager.createNotificationChannel(channel);
  }
  Intent open = new Intent(this, MainActivity.class).setAction(ACTION_SHOW_MAPS).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
  PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  Notification.Builder notification = new Notification.Builder(this, CHANNEL)
   .setSmallIcon(R.drawable.ic_navigation)
   .setContentTitle(session == null || session.title.isEmpty() ? "Navigation" : session.title)
   .setContentText(session == null ? "" : session.text)
   .setContentIntent(content)
   .setOngoing(true)
   .setOnlyAlertOnce(true)
   .setShowWhen(false)
   .setCategory(Notification.CATEGORY_NAVIGATION)
   .setVisibility(Notification.VISIBILITY_PUBLIC);
  if (session != null) {
   // Extras do not distinguish PendingIntents. Keep an older notification's Stop
   // tied to its own admission even if another renderer reuses a public session id.
   Intent stopIntent = intent(this, ACTION_STOP, session).putExtra(EXTRA_REASON, "notification")
    .setData(Uri.parse("alphaphone-navigation:" + session.authority));
   PendingIntent stop = PendingIntent.getService(this, 1, stopIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
   notification.addAction(new Notification.Action.Builder(null, "End navigation", stop).build());
  }
  return notification.build();
 }
}
