package ai.alphacompute.thinapp;

import ai.eliza.plugins.reminders.ReminderEngine;
import ai.eliza.plugins.reminders.ReminderReceiver;
import android.content.Context;

/** Broadcast receiver restoring and dispatching scheduled thin-app reminder alarms. */
public final class ThinReminderReceiver extends ReminderReceiver {
    @Override protected ReminderEngine engine(Context context) {
        return ReminderEngine.get(context, ThinRemindersPlugin.CONFIGURATION, KeystoreReminderStore.FACTORY);
    }
}
