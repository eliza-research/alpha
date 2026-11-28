package ai.alphacompute.thinapp;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.util.Log;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Alarm and timer wakeup reconciling thin telephony deferred deletions after their Undo window closes. */
public final class ThinTelephonyDeletionWakeup extends BroadcastReceiver {
    private static final String TAG = "ThinDeletionWakeup";
    private static final String ACTION = BuildConfig.APPLICATION_ID + ".action.RECONCILE_TELEPHONY_DELETIONS";
    private static final long RETRY_DELAY_MS = 30_000L;
    private static final ScheduledThreadPoolExecutor WORK = new ScheduledThreadPoolExecutor(1);

    private static long wakeAt = Long.MAX_VALUE;
    private static ScheduledFuture<?> wake;

    static {
        WORK.setRemoveOnCancelPolicy(true);
    }

    static synchronized void schedule(Context context, long delay) {
        long deadline = SystemClock.elapsedRealtime() + Math.max(1L, delay);
        if (deadline >= wakeAt) return;
        if (wake != null) wake.cancel(false);
        wakeAt = deadline;
        wake = WORK.schedule(() -> elapsed(context.getApplicationContext(), deadline), Math.max(1L, delay), TimeUnit.MILLISECONDS);
        try {
            AlarmManager alarms = context.getSystemService(AlarmManager.class);
            if (alarms != null) alarms.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, deadline, operation(context, 0));
        } catch (RuntimeException unavailable) {
            Log.w(TAG, "Telephony deletion recovery alarm unavailable");
        }
    }

    private static PendingIntent operation(Context context, int flags) {
        Intent intent = new Intent(context, ThinTelephonyDeletionWakeup.class).setAction(ACTION);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_IMMUTABLE | flags);
    }

    private static synchronized void clearRecoveryIfIdle(Context context) {
        if (wake != null) return;
        try {
            AlarmManager alarms = context.getSystemService(AlarmManager.class);
            PendingIntent operation = operation(context, PendingIntent.FLAG_NO_CREATE);
            if (alarms != null && operation != null) alarms.cancel(operation);
        } catch (RuntimeException unavailable) {
            Log.w(TAG, "Telephony deletion recovery alarm could not be cleared");
        }
    }

    private static void elapsed(Context context, long deadline) {
        synchronized (ThinTelephonyDeletionWakeup.class) {
            if (wakeAt != deadline) return;
            wakeAt = Long.MAX_VALUE;
            wake = null;
        }
        reconcile(context);
    }

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) return;
        Context app = context.getApplicationContext();
        PendingResult pending = goAsync();
        WORK.execute(() -> {
            try {
                reconcile(app);
            } finally {
                pending.finish();
            }
        });
    }

    private static void reconcile(Context context) {
        try {
            if (!ThinTelephonyDeletions.get(context).reconcile()) {
                clearRecoveryIfIdle(context);
                return;
            }
        } catch (Exception unavailable) {
            Log.w(TAG, "Telephony deletion settlement unavailable");
        }
        schedule(context, RETRY_DELAY_MS);
    }
}
