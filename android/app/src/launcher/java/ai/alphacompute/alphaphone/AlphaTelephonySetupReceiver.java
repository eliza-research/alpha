package ai.alphacompute.alphaphone;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/** Prepares image-only role components for the privileged fresh-image Provision app. */
public final class AlphaTelephonySetupReceiver extends BroadcastReceiver {
 private static final String ACTION = "ai.alphacompute.alphaphone.action.PREPARE_TELEPHONY_ROLES";

 @Override public void onReceive(Context context, Intent intent) {
  if (!isOrderedBroadcast()) return;
  setResultCode(Activity.RESULT_CANCELED);
  if (intent == null || !ACTION.equals(intent.getAction())) return;
  try {
   if (AlphaTelephonyRoles.prepare(context)) setResultCode(Activity.RESULT_OK);
  } catch (RuntimeException unavailable) {
   Log.w("AlphaTelephonySetup", "Role component preparation unavailable", unavailable);
  }
 }
}
