// spec/app/account/billing.md, "Coming back from the browser, giving up on it, or waiting too long for it, confirms a checkout of this sign-in with Cloud and checks the plan; the return itself changes nothing"
package ai.alphacompute.alphaphone;

import ai.alphacompute.ipc.AlphaIpcContract;
import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Translucent, no-history trampoline receiving {@code https://cloud.alphaphone.dev/alphaphone/billing/return},
 * capturing the verified Stripe return state, broadcasting it across AlphaCore and thin apps,
 * and returning focus to whichever Alpha app initiated checkout without spawning the monolith launcher.
 */
public final class AlphaBillingReturnActivity extends Activity {
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        boolean captured = BillingReturn.capture(getIntent());
        if (captured) {
            MainActivity.notifyBillingReturn();
            String callerPkg = BillingReturn.consumeCheckoutCaller();
            if (callerPkg != null
                && !AlphaIpcContract.CORE_PACKAGE.equals(callerPkg)
                && AlphaIpcContract.hasCoreSignature(this, callerPkg)) {
                bringPackageToFront(callerPkg);
            } else if (MainActivity.isLive()) {
                bringPackageToFront(getPackageName());
            } else if (AlphaIpcContract.hasCoreSignature(this, "ai.alphacompute.settings")) {
                bringPackageToFront("ai.alphacompute.settings");
            }
        }
        finish();
        overridePendingTransition(0, 0);
    }

    private void bringPackageToFront(String packageName) {
        try {
            Intent launch = getPackageManager().getLaunchIntentForPackage(packageName);
            if (launch == null) {
                launch = new Intent(Intent.ACTION_MAIN)
                    .addCategory(Intent.CATEGORY_LAUNCHER)
                    .setPackage(packageName);
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            startActivity(launch);
        } catch (RuntimeException ignored) {
        }
    }
}
