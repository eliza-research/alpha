package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.telephony.SubscriptionInfo;
import java.util.List;

/** Standalone installs do not request or expose Alpha image SIM access. */
final class AlphaSubscriptions {
 static List<SubscriptionInfo> active(Context context) { return null; }
}
