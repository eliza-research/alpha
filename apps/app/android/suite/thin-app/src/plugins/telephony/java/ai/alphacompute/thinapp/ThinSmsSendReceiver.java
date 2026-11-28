package ai.alphacompute.thinapp;

import ai.eliza.plugins.messages.SmsTelephony;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Receives SMS sent and delivered callbacks for thin telephony apps. */
public final class ThinSmsSendReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        SmsTelephony.handleCallback(this, context, intent, ThinTelephonyConfig.CONFIGURATION);
    }
}
