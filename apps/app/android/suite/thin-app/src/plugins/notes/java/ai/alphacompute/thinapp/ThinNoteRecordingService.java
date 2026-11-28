package ai.alphacompute.thinapp;

import android.Manifest;
import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.util.Objects;

/** Microphone foreground service keeping standalone Notes voice recordings active with the screen off. */
public final class ThinNoteRecordingService extends Service {
    static final String CHANNEL = "alpha.notes.recording";
    static final int NOTIFICATION_ID = 0x4e524543;
    static final String ACTION_START = BuildConfig.APPLICATION_ID + ".notes.recording.START";
    static final String ACTION_PAUSE = BuildConfig.APPLICATION_ID + ".notes.recording.PAUSE";
    static final String ACTION_STOP = BuildConfig.APPLICATION_ID + ".notes.recording.STOP";
    static final String ACTION_RESUME = BuildConfig.APPLICATION_ID + ".notes.recording.RESUME";
    static final String ACTION_FINISH = BuildConfig.APPLICATION_ID + ".notes.recording.FINISH";
    static final String ACTION_SHOW_NOTES = BuildConfig.APPLICATION_ID + ".notes.recording.SHOW";
    static final String EXTRA_RECORDING = "recording";
    private static final long SHOW_NOTES_LIFETIME_MS = 30_000L;

    private static volatile boolean foreground;
    private static volatile String foregroundRecording;
    private static volatile ThinNoteRecordingService activeService;
    private static long showNotesUntil = -1L;

    private volatile int lastStartId;

    static synchronized boolean offerFromIntent(Context context, Intent intent) {
        KeyguardManager lock = context.getSystemService(KeyguardManager.class);
        if (intent == null || !ACTION_SHOW_NOTES.equals(intent.getAction()) || !foreground || lock == null || lock.isDeviceLocked()) {
            return false;
        }
        showNotesUntil = SystemClock.elapsedRealtime() + SHOW_NOTES_LIFETIME_MS;
        return true;
    }

    static synchronized boolean consumeShowNotes() {
        boolean open = showNotesUntil >= 0L && SystemClock.elapsedRealtime() < showNotesUntil;
        showNotesUntil = -1L;
        return open;
    }

    static void start(Context context, String recordingId) {
        try {
            context.startForegroundService(intent(context, ACTION_START, recordingId));
        } catch (RuntimeException ignored) {
        }
    }

    static void recordingClosed(Context context, String recordingId) {
        try {
            context.startService(intent(context, ACTION_STOP, recordingId));
        } catch (RuntimeException backgroundRestricted) {
            ThinNoteRecordingService service = activeService;
            if (service != null) {
                int startId = service.lastStartId;
                new Handler(Looper.getMainLooper()).post(() -> service.stopClosedRecording(recordingId, startId));
            }
        }
    }

    static void refresh(Context context) {
        if (!foreground) return;
        JSObject status = ThinNoteRecorder.get(context).status();
        String state = status.optString("state");
        if (!"recording".equals(state) && !"paused".equals(state)) return;
        if (!Objects.equals(foregroundRecording, status.getString("recordingId"))) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification(context, status));
    }

    private static boolean canResumeMicrophone(Context context) {
        KeyguardManager lock = context.getSystemService(KeyguardManager.class);
        return lock != null
            && !lock.isDeviceLocked()
            && !ThinNotesPlugin.inCall(context)
            && context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private static Intent intent(Context context, String action, String recordingId) {
        String identity = recordingId == null ? "" : recordingId;
        return new Intent(context, ThinNoteRecordingService.class)
            .setAction(action)
            .setIdentifier(identity)
            .putExtra(EXTRA_RECORDING, identity);
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        activeService = this;
        lastStartId = startId;
        String action = intent == null ? null : intent.getAction();
        String recording = intent == null ? "" : intent.getStringExtra(EXTRA_RECORDING);
        ThinNoteRecorder recorder = ThinNoteRecorder.get(this);
        if (ACTION_PAUSE.equals(action) || ACTION_RESUME.equals(action)) {
            if (recording != null && recorder.owns(recording)) {
                try {
                    if (ACTION_PAUSE.equals(action)) {
                        recorder.pause(recording);
                    } else if (foreground && recording.equals(foregroundRecording)
                        && "paused".equals(recorder.status().optString("state"))
                        && canResumeMicrophone(this)) {
                        recorder.resume(recording);
                    }
                } catch (RuntimeException | IOException ignored) {
                }
            }
            refresh(this);
            if (!foreground) stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (ACTION_FINISH.equals(action)) {
            if (recording != null && recorder.owns(recording)) {
                try {
                    recorder.stop(recording);
                } catch (RuntimeException ignored) {
                }
            }
            stopClosedRecording(recording, startId);
            return START_NOT_STICKY;
        }
        if (ACTION_STOP.equals(action)) {
            stopClosedRecording(recording, startId);
            return START_NOT_STICKY;
        }
        if (foreground && (recording == null || !recorder.owns(recording))) return START_NOT_STICKY;
        try {
            Notification shown = notification(this, recorder.status());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                startForeground(NOTIFICATION_ID, shown, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
            } else {
                startForeground(NOTIFICATION_ID, shown);
            }
            foregroundRecording = recording;
            foreground = true;
        } catch (RuntimeException refused) {
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (recording == null || !recorder.owns(recording)) {
            foregroundRecording = null;
            foreground = false;
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf(startId);
        }
        return START_NOT_STICKY;
    }

    private void stopClosedRecording(String recording, int startId) {
        if (activeService != this) return;
        ThinNoteRecorder recorder = ThinNoteRecorder.get(this);
        String state = recorder.status().optString("state");
        if ("recording".equals(state) || "paused".equals(state)) return;
        if (recording == null || recording.isEmpty()) {
            if (recorder.open()) return;
        } else {
            if (foreground && !recording.equals(foregroundRecording)) return;
            if (recorder.open() && !recorder.owns(recording)) return;
        }
        if (!stopSelfResult(startId)) return;
        foregroundRecording = null;
        foreground = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
    }

    @Override public void onDestroy() {
        if (activeService == this) {
            activeService = null;
            foregroundRecording = null;
            foreground = false;
        }
        super.onDestroy();
    }

    private static Notification notification(Context context, JSObject status) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Voice note recording", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shows active voice note recordings");
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
        String recording = status.optString("recordingId", "");
        boolean paused = "paused".equals(status.optString("state"));
        String title = paused ? "Voice note · Paused" : "Voice note · Recording";
        Intent open = new Intent(context, ThinAppActivity.class)
            .setAction(ACTION_SHOW_NOTES)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent toggle = PendingIntent.getForegroundService(
            context,
            paused ? 2 : 1,
            intent(context, paused ? ACTION_RESUME : ACTION_PAUSE, recording),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        PendingIntent finish = PendingIntent.getForegroundService(
            context,
            3,
            intent(context, ACTION_FINISH, recording),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        Notification publicVersion = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(title)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build();
        Notification.Builder builder = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle(title)
            .setContentText("Tap to return to Notes")
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setPublicVersion(publicVersion)
            .addAction(new Notification.Action.Builder(null, paused ? "Resume" : "Pause", toggle).build())
            .addAction(new Notification.Action.Builder(null, "Stop", finish).build());
        if (paused) {
            builder.setShowWhen(false).setUsesChronometer(false);
        } else {
            builder.setUsesChronometer(true).setShowWhen(true).setWhen(System.currentTimeMillis() - Math.max(0L, status.optLong("durationMs", 0L)));
        }
        return builder.build();
    }
}
