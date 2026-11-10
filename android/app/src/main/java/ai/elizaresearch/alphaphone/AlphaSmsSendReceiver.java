package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.messages.SmsTelephony;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Receives the sent and delivery PendingIntents of reviewed native SMS sends (issue #421). Declared,
 * not exported, only in the launcher manifest; the shared handler ignores every broadcast unless the
 * AOSP image capability holds. Being in the manifest, callbacks still reach the journal after Alpha's
 * process has been stopped, so a send is not misreported because the app was closed. The component
 * name is installed identity: PendingIntents already handed to the platform name it.
 */
public final class AlphaSmsSendReceiver extends BroadcastReceiver {
 @Override public void onReceive(Context context, Intent intent) {
  SmsTelephony.handleCallback(this, context, intent, AlphaTelephony.CONFIGURATION);
 }
}
