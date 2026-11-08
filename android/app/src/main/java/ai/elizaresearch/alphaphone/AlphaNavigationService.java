package ai.elizaresearch.alphaphone;

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
 static final String CHANNEL = "alpha.maps.navigation";
 static final int NOTIFICATION_ID = 0x4d415053; // "MAPS"
 static final String ACTION_START = "ai.elizaresearch.alphaphone.navigation.START";
 static final String ACTION_UPDATE = "ai.elizaresearch.alphaphone.navigation.UPDATE";
 static final String ACTION_STOP = "ai.elizaresearch.alphaphone.navigation.STOP";
 static final String EXTRA_SESSION = "session", EXTRA_TITLE = "title", EXTRA_TEXT = "text", EXTRA_REASON = "reason";
 static final String SESSION_PATTERN = "[A-Za-z0-9_-]{8,80}";

 /** Receives the single terminal stop of each session; registered by the Maps bridge. */
 interface StopListener { void stopped(String session, String reason); }

 private static final Object lock = new Object();
 private static String activeSession;
 private static StopListener listener;
 private static int stopCount;
 private static String lastStopReason = "";
 private static String lastTitle = "", lastText = "";

 static void setStopListener(StopListener value) { synchronized (lock) { listener = value; } }
 static void clearStopListener(StopListener value) { synchronized (lock) { if (listener == value) listener = null; } }
 static String activeSession() { synchronized (lock) { return activeSession; } }

 /** Instrumentation-visible state: active session, total terminal stops and last reason. */
 static String[] snapshot() {
  synchronized (lock) { return new String[]{activeSession == null ? "" : activeSession, String.valueOf(stopCount), lastStopReason, lastTitle, lastText}; }
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

 static void start(Context context, String session, String title, String text) {
  synchronized (lock) { activeSession = session; lastTitle = bounded(title); lastText = bounded(text); }
  context.startForegroundService(intent(context, ACTION_START, session).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text));
 }

 static boolean update(Context context, String session, String title, String text) {
  synchronized (lock) { if (activeSession == null || !activeSession.equals(session)) return false; lastTitle = bounded(title); lastText = bounded(text); }
  context.startService(intent(context, ACTION_UPDATE, session).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_TEXT, text));
  return true;
 }

 /** Ends the session if it is still active. Returns false when it already stopped.
  * The service is told through a command rather than stopService: a start that is still
  * queued must reach startForeground first, or the platform treats the start as broken. */
 static boolean stop(Context context, String session, String reason) {
  if (!finish(session, reason)) return false;
  try { context.startService(intent(context, ACTION_STOP, session).putExtra(EXTRA_REASON, reason)); }
  catch (RuntimeException backgroundRestricted) { context.stopService(new Intent(context, AlphaNavigationService.class)); }
  return true;
 }

 private static boolean finish(String session, String reason) {
  StopListener target;
  synchronized (lock) {
   if (activeSession == null || (session != null && !activeSession.equals(session))) return false;
   session = activeSession; activeSession = null; stopCount++; lastStopReason = reason; target = listener;
  }
  if (target != null) target.stopped(session, reason);
  return true;
 }

 private static Intent intent(Context context, String action, String session) {
  return new Intent(context, AlphaNavigationService.class).setAction(action).putExtra(EXTRA_SESSION, session);
 }

 private static String bounded(String value) {
  if (value == null) return "";
  String clean = value.replaceAll("[\\u0000-\\u001f]", " ").trim();
  return clean.length() > 200 ? clean.substring(0, 200) : clean;
 }

 /** The session this service instance last entered the foreground for. */
 private String owned;

 @Override public IBinder onBind(Intent intent) { return null; }

 @Override public int onStartCommand(Intent intent, int flags, int startId) {
  String action = intent == null ? null : intent.getAction();
  String session = intent == null ? null : intent.getStringExtra(EXTRA_SESSION);
  if (ACTION_STOP.equals(action)) {
   // Notification Stop: the renderer hears it through the bridge listener once. An app stop
   // already finished the session; a stop of a replaced session leaves its successor running.
   finish(session, intent.getStringExtra(EXTRA_REASON) == null ? "notification" : intent.getStringExtra(EXTRA_REASON));
   if (activeSession() == null) end(startId);
   return START_NOT_STICKY;
  }
  String current = activeSession();
  boolean live = session != null && session.equals(current) && (ACTION_START.equals(action) || ACTION_UPDATE.equals(action));
  if (!live && !ACTION_START.equals(action)) {
   // A stale or replayed update never revives a stopped session.
   if (current == null) end(startId);
   return START_NOT_STICKY;
  }
  // A start command always enters the foreground first (the platform requires it), then a
  // session that already stopped ends immediately.
  Notification notification = notification(bounded(intent.getStringExtra(EXTRA_TITLE)), bounded(intent.getStringExtra(EXTRA_TEXT)), session == null ? "" : session);
  try {
   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
   else startForeground(NOTIFICATION_ID, notification);
  } catch (RuntimeException refused) {
   // Missing location permission or a background start restriction: no silent continuation.
   finish(session, "refused");
   end(startId);
   return START_NOT_STICKY;
  }
  if (live) owned = session; else end(startId);
  return START_NOT_STICKY;
 }

 @Override public void onTaskRemoved(Intent rootIntent) {
  finish(null, "task-removed");
  end(-1);
  super.onTaskRemoved(rootIntent);
 }

 @Override public void onDestroy() {
  // The system can destroy the service without a command; report that stop as well. Only the
  // session this instance served: a destroy that trails a stop must not end its successor.
  if (owned != null) finish(owned, "destroyed");
  super.onDestroy();
 }

 /** Leaves the foreground and stops unless a newer command (a new Start) has arrived since. */
 private void end(int startId) {
  stopForeground(STOP_FOREGROUND_REMOVE);
  if (startId < 0) stopSelf(); else stopSelf(startId);
 }

 private Notification notification(String title, String text, String session) {
  NotificationManager manager = getSystemService(NotificationManager.class);
  if (manager.getNotificationChannel(CHANNEL) == null) {
   NotificationChannel channel = new NotificationChannel(CHANNEL, "Maps navigation", NotificationManager.IMPORTANCE_LOW);
   channel.setDescription("Shows the next instruction while Maps navigation runs with the screen off");
   channel.setShowBadge(false);
   channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
   manager.createNotificationChannel(channel);
  }
  Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
  PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent stop = PendingIntent.getService(this, 1, intent(this, ACTION_STOP, session).putExtra(EXTRA_REASON, "notification"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  return new Notification.Builder(this, CHANNEL)
   .setSmallIcon(android.R.drawable.ic_menu_directions)
   .setContentTitle(title.isEmpty() ? "Navigation" : title)
   .setContentText(text)
   .setContentIntent(content)
   .setOngoing(true)
   .setOnlyAlertOnce(true)
   .setShowWhen(false)
   .setCategory(Notification.CATEGORY_NAVIGATION)
   .setVisibility(Notification.VISIBILITY_PUBLIC)
   .addAction(new Notification.Action.Builder(null, "Stop", stop).build())
   .build();
 }
}
