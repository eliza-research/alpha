package ai.alphacompute.thinapp;

import ai.eliza.plugins.messages.SmsRoleConfiguration;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.net.Uri;
import android.os.IBinder;
import android.telephony.TelephonyManager;
import android.util.Log;
import java.util.UUID;

/** Standalone {@code ROLE_SMS} quick-reply service routing incoming replies to explicit user review in Messages. */
public final class ThinRespondViaMessageService extends Service {
    private static final String TAG = "ThinRespondViaMessage";

    @Override public IBinder onBind(Intent intent) {
        return null;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            if (intent != null && TelephonyManager.ACTION_RESPOND_VIA_MESSAGE.equals(intent.getAction())) {
                Uri data = intent.getData();
                String recipient = data == null ? null : data.getSchemeSpecificPart();
                if (recipient != null && !recipient.isBlank()) {
                    String body = intent.getStringExtra(Intent.EXTRA_TEXT);
                    if (body == null) body = intent.getStringExtra("sms_body");
                    postReview(recipient.trim(), body == null ? "" : body);
                }
            }
        } catch (RuntimeException unavailable) {
            Log.w(TAG, "Quick reply review could not be offered");
        } finally {
            stopSelf(startId);
        }
        return START_NOT_STICKY;
    }

    private void postReview(String recipient, String body) {
        NotificationManager notifications = getSystemService(NotificationManager.class);
        if (notifications == null) return;
        SmsRoleConfiguration config = ThinTelephonyConfig.SMS_ROLE;
        String ticket = UUID.randomUUID().toString();
        Intent review = new Intent(this, ThinAppActivity.class)
            .setAction(Intent.ACTION_SENDTO)
            .setData(Uri.fromParts("smsto", recipient, null))
            .setIdentifier(ticket)
            .putExtra("sms_body", body)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent open = PendingIntent.getActivity(this, 0, review, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT);
        notifications.createNotificationChannel(new NotificationChannel(config.channelId, config.channelName, NotificationManager.IMPORTANCE_HIGH));
        Notification notice = new Notification.Builder(this, config.channelId)
            .setSmallIcon(config.notificationIcon)
            .setContentTitle("Review your reply")
            .setContentText("Nothing is sent until you press Send.")
            .setAutoCancel(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setContentIntent(open)
            .build();
        notifications.notify("respond-via-message", 1, notice);
    }
}
