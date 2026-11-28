package ai.alphacompute.thinapp;

import ai.eliza.plugins.reminders.ReminderConfiguration;
import ai.eliza.plugins.reminders.ReminderPlugin;
import android.Manifest;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Thin standalone {@code ElizaReminders} plugin scheduling and tracking durable reminder alarms. */
@CapacitorPlugin(name = "ElizaReminders", permissions = {
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public final class ThinRemindersPlugin extends ReminderPlugin {
    static final ReminderConfiguration CONFIGURATION = new ReminderConfiguration(
        "alpha-reminders-envelope",
        "alpha-reminders-legacy",
        "alpha-reminder-taps:v1",
        "alpha_reminders",
        "Reminders",
        "Scheduled Alpha reminders",
        "Reminder",
        "ai.alphacompute.reminders.REMIND",
        "ai.alphacompute.reminders.DECISION",
        "ai.alphacompute.reminders.OPEN",
        "alpha-reminder-alarm:",
        "alpha-reminder-decision:",
        "alpha-reminder-tap:",
        "reminderId",
        "occurrenceId",
        "decision",
        "alpha-reminder:",
        ThinReminderReceiver.class,
        ThinAppActivity.class,
        "Ask Alpha"
    );

    public ThinRemindersPlugin() {
        super(CONFIGURATION, KeystoreReminderStore.FACTORY);
    }
}
