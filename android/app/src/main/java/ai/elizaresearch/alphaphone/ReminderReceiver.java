package ai.elizaresearch.alphaphone;
import android.content.Context;
import ai.eliza.plugins.reminders.ReminderEngine;

/** Preserve the installed receiver identity and its PendingIntent routes. */
public final class ReminderReceiver extends ai.eliza.plugins.reminders.ReminderReceiver {
 @Override protected ReminderEngine engine(Context context) { return AlphaReminders.engine(context); }
}
