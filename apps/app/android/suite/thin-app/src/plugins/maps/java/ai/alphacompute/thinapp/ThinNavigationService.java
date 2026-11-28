package ai.alphacompute.thinapp;

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
import android.net.Uri;
import android.os.IBinder;
import android.os.SystemClock;
import java.util.UUID;
import java.util.function.BooleanSupplier;

/** Location foreground service keeping standalone Maps turn-by-turn sessions alive while the screen is off. */
public final class ThinNavigationService extends Service {
    static final String ACTION_SHOW_MAPS = BuildConfig.APPLICATION_ID + ".action.SHOW_NAVIGATION";
    static final String CHANNEL = "alpha.maps.navigation";
    static final int NOTIFICATION_ID = 0x4d415053;
    static final int ARRIVAL_NOTIFICATION_ID = 0x4d415041;
    static final String ACTION_START = BuildConfig.APPLICATION_ID + ".navigation.START";
    static final String ACTION_UPDATE = BuildConfig.APPLICATION_ID + ".navigation.UPDATE";
    static final String ACTION_STOP = BuildConfig.APPLICATION_ID + ".navigation.STOP";
    static final String EXTRA_SESSION = "session";
    static final String EXTRA_AUTHORITY = "authority";
    static final String EXTRA_REASON = "reason";
    static final String SESSION_PATTERN = "[A-Za-z0-9_-]{8,80}";
    private static final long SHOW_MAPS_LIFETIME_MS = 30_000L;

    interface StopListener {
        void stopped(String session, String reason);
    }

    private static final class Session {
        final String id;
        final StopListener owner;
        final ComponentName rootComponent;
        final String authority = UUID.randomUUID().toString();
        String title;
        String text;

        Session(String id, StopListener owner, ComponentName rootComponent, String title, String text) {
            this.id = id;
            this.owner = owner;
            this.rootComponent = rootComponent;
            this.title = bounded(title);
            this.text = bounded(text);
        }

        boolean matches(Intent command) {
            return id.equals(command.getStringExtra(EXTRA_SESSION))
                && authority.equals(command.getStringExtra(EXTRA_AUTHORITY));
        }
    }

    private static final Object LOCK = new Object();
    private static Session active;
    private static long showMapsUntil = -1L;

    private Session owned;

    static synchronized boolean offerFromIntent(Intent intent) {
        if (intent == null || !ACTION_SHOW_MAPS.equals(intent.getAction())) return false;
        showMapsUntil = SystemClock.elapsedRealtime() + SHOW_MAPS_LIFETIME_MS;
        return true;
    }

    static synchronized boolean consumeShowMaps() {
        boolean open = showMapsUntil >= 0L && SystemClock.elapsedRealtime() < showMapsUntil;
        showMapsUntil = -1L;
        return open;
    }

    static synchronized void clearShowMaps() {
        showMapsUntil = -1L;
    }

    static String activeSession() {
        synchronized (LOCK) {
            return active == null ? null : active.id;
        }
    }

    static boolean declared(Context context) {
        try {
            ServiceInfo info = context.getPackageManager().getServiceInfo(new ComponentName(context, ThinNavigationService.class), 0);
            return (info.getForegroundServiceType() & ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION) != 0;
        } catch (PackageManager.NameNotFoundException missing) {
            return false;
        }
    }

    static boolean locationGranted(Context context) {
        return context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean start(
        Context context,
        String id,
        String title,
        String text,
        StopListener owner,
        ComponentName rootComponent,
        BooleanSupplier admitted
    ) {
        Session session;
        Session replaced;
        synchronized (LOCK) {
            if (!admitted.getAsBoolean()) return false;
            replaced = retireLocked();
            session = new Session(id, owner, rootComponent, title, text);
            active = session;
        }
        try {
            if (replaced != null) dispatchStop(context, replaced, "replaced");
            synchronized (LOCK) {
                if (active != session || !admitted.getAsBoolean()) return false;
            }
            context.startForegroundService(intent(context, ACTION_START, session));
        } catch (RuntimeException refused) {
            Session retired;
            synchronized (LOCK) {
                retired = active == session ? retireLocked() : null;
            }
            if (retired != null) dispatchStop(context, retired, "refused");
            throw refused;
        }
        synchronized (LOCK) {
            return active == session && admitted.getAsBoolean();
        }
    }

    static boolean update(Context context, String id, String title, String text, StopListener owner) {
        Session session;
        synchronized (LOCK) {
            if (active == null || active.owner != owner || !active.id.equals(id)) return false;
            session = active;
            session.title = bounded(title);
            session.text = bounded(text);
        }
        context.startService(intent(context, ACTION_UPDATE, session));
        return true;
    }

    static boolean arrived(Context context, StopListener owner, String title, String text) {
        synchronized (LOCK) {
            if (active == null || active.owner != owner) return false;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return false;
        ensureChannel(manager);
        String heading = bounded(title);
        Notification notice = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle(heading.isEmpty() ? "Arrived" : heading)
            .setContentText(bounded(text))
            .setContentIntent(showMaps(context))
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .build();
        manager.notify(ARRIVAL_NOTIFICATION_ID, notice);
        return true;
    }

    static boolean stop(Context context, String id, StopListener owner, String reason) {
        Session session;
        synchronized (LOCK) {
            if (active == null || active.owner != owner || (id != null && !active.id.equals(id))) return false;
            session = retireLocked();
        }
        dispatchStop(context, session, reason);
        return true;
    }

    private static Session retireLocked() {
        Session retired = active;
        active = null;
        return retired;
    }

    private static void notifyStopped(Session retired, String reason) {
        if (retired != null) retired.owner.stopped(retired.id, reason);
    }

    private static void dispatchStop(Context context, Session retired, String reason) {
        try {
            notifyStopped(retired, reason);
        } finally {
            try {
                context.startService(intent(context, ACTION_STOP, retired).putExtra(EXTRA_REASON, reason));
            } catch (RuntimeException backgroundRestricted) {
                synchronized (LOCK) {
                    if (active == null) context.stopService(new Intent(context, ThinNavigationService.class));
                }
            }
        }
    }

    private static Intent intent(Context context, String action, Session session) {
        Intent command = new Intent(context, ThinNavigationService.class).setAction(action);
        if (session != null) {
            command.putExtra(EXTRA_SESSION, session.id).putExtra(EXTRA_AUTHORITY, session.authority);
        }
        return command;
    }

    private static String bounded(String value) {
        if (value == null) return "";
        String clean = value.replaceAll("[\\u0000-\\u001f]", " ").trim();
        return clean.length() > 200 ? clean.substring(0, 200) : clean;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        Session retired = null;
        String reason = "refused";
        synchronized (LOCK) {
            if (ACTION_STOP.equals(action)) {
                if (active != null && active.matches(intent)) {
                    String extra = intent.getStringExtra(EXTRA_REASON);
                    reason = extra == null ? "notification" : extra;
                    retired = retireLocked();
                }
                endIfIdle(startId);
            } else {
                boolean live = active != null && intent != null && active.matches(intent);
                if (ACTION_START.equals(action) || (ACTION_UPDATE.equals(action) && live)) {
                    try {
                        startForeground(NOTIFICATION_ID, notification(active), ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                        owned = active;
                    } catch (RuntimeException refused) {
                        if (live) retired = retireLocked();
                    }
                }
                endIfIdle(startId);
            }
        }
        notifyStopped(retired, reason);
        return START_NOT_STICKY;
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        Session retired;
        ComponentName removedRoot = rootIntent == null ? null : rootIntent.getComponent();
        synchronized (LOCK) {
            retired = owned != null && active == owned && removedRoot != null && removedRoot.equals(owned.rootComponent)
                ? retireLocked()
                : null;
            endIfIdle(-1);
        }
        notifyStopped(retired, "task-removed");
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        Session retired;
        synchronized (LOCK) {
            retired = owned != null && active == owned ? retireLocked() : null;
        }
        notifyStopped(retired, "destroyed");
        super.onDestroy();
    }

    private void endIfIdle(int startId) {
        if (active != null) return;
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (startId < 0) stopSelf();
        else stopSelf(startId);
    }

    private static void ensureChannel(NotificationManager manager) {
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Maps navigation", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shows the next turn while Maps navigation is running");
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    private static PendingIntent showMaps(Context context) {
        Intent open = new Intent(context, ThinAppActivity.class)
            .setAction(ACTION_SHOW_MAPS)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification notification(Session session) {
        ensureChannel(getSystemService(NotificationManager.class));
        Notification.Builder builder = new Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_directions)
            .setContentTitle(session == null || session.title.isEmpty() ? "Navigation" : session.title)
            .setContentText(session == null ? "" : session.text)
            .setContentIntent(showMaps(this))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (session != null) {
            Intent stopIntent = intent(this, ACTION_STOP, session)
                .putExtra(EXTRA_REASON, "notification")
                .setData(Uri.parse("alphaphone-navigation:" + session.authority));
            PendingIntent stop = PendingIntent.getService(this, 1, stopIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            builder.addAction(new Notification.Action.Builder(null, "End navigation", stop).build());
        }
        return builder.build();
    }
}
