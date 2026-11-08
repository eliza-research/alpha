package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.telephony.SubscriptionInfo;
import android.telephony.SubscriptionManager;
import androidx.core.content.ContextCompat;
import java.util.List;
import java.util.Collections;

/** SIM access is available only in the verified Alpha image launcher. */
final class AlphaSubscriptions {
 static List<SubscriptionInfo> active(Context context) {
  if (!AlphaImageCapability.verified(context) || ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) != PackageManager.PERMISSION_GRANTED) return null;
  SubscriptionManager manager = context.getSystemService(SubscriptionManager.class);
  if (manager == null) return null;
  try {
   List<SubscriptionInfo> active = manager.getActiveSubscriptionInfoList();
   return active == null ? Collections.emptyList() : active;
  }
  catch (SecurityException denied) { return null; }
 }
}
