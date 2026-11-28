package ai.alphacompute.thinapp;

import ai.eliza.plugins.messages.MmsStore;
import ai.eliza.plugins.messages.SmsRoleConfiguration;
import ai.eliza.plugins.messages.SmsTelephony;
import ai.eliza.plugins.messages.ThinSmsAccess;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import android.telephony.SubscriptionManager;
import android.util.Log;
import java.util.concurrent.RejectedExecutionException;

/** Standalone {@code ROLE_SMS} {@code SMS_DELIVER} receiver persisting incoming texts and posting notifications. */
public final class ThinSmsDeliverReceiver extends BroadcastReceiver {
    private static final String TAG = "ThinSmsDeliverReceiver";

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null || !Telephony.Sms.Intents.SMS_DELIVER_ACTION.equals(intent.getAction()) || !MmsStore.isDefaultSmsApp(context)) {
            return;
        }
        SmsMessage[] messages = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;
        String sender = null;
        long timestamp = 0L;
        StringBuilder body = new StringBuilder();
        for (SmsMessage message : messages) {
            if (message == null) continue;
            if (sender == null) sender = message.getDisplayOriginatingAddress();
            if (timestamp == 0L) timestamp = message.getTimestampMillis();
            if (message.getDisplayMessageBody() != null) body.append(message.getDisplayMessageBody());
        }
        int subscription = intent.getIntExtra(SubscriptionManager.EXTRA_SUBSCRIPTION_INDEX, -1);
        SmsRoleConfiguration config = ThinTelephonyConfig.SMS_ROLE;
        Context app = context.getApplicationContext();
        String from = sender;
        String text = body.toString();
        long at = timestamp;
        PendingResult pending = goAsync();
        try {
            SmsTelephony.WORK.execute(() -> {
                try {
                    Uri row = MmsStore.persistIncomingSms(app, from, text, at, subscription);
                    try {
                        ThinSmsAccess.notifyIncoming(app, config, row, from, text);
                    } catch (RuntimeException unconfirmed) {
                        Log.e(TAG, "Incoming SMS stored; notice publication unconfirmed", unconfirmed);
                    }
                } catch (RuntimeException refused) {
                    Log.e(TAG, "Incoming SMS could not be stored", refused);
                } finally {
                    pending.finish();
                }
            });
        } catch (RejectedExecutionException closed) {
            pending.finish();
        }
    }
}
