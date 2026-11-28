// spec/app/clock/index.md, "Story: Hear and prioritize ringing alerts"
package ai.alphacompute.alphaphone.clock;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ClockAlertReceiver extends BroadcastReceiver {
    static final ExecutorService WORK = Executors.newSingleThreadExecutor();

    @Override public void onReceive(Context context, Intent intent) {
        dispatch(context, intent, goAsync());
    }

    static void dispatch(Context context, Intent intent, PendingResult result) {
        WORK.execute(() -> {
            try { new ClockAlerts(context).receive(intent); }
            catch (Exception failure) { Log.e("AlphaClockAlerts", "Clock alert delivery failed", failure); }
            finally { result.finish(); }
        });
    }
}
