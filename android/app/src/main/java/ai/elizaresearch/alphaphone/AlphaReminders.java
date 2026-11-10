package ai.elizaresearch.alphaphone;

import android.content.Context;
import ai.eliza.plugins.reminders.ReminderConfiguration;
import ai.eliza.plugins.reminders.ReminderEngine;
import ai.eliza.plugins.reminders.SecureStringStore;

/** Product identity and existing encrypted storage for the shared reminder engine. */
public final class AlphaReminders {
 private AlphaReminders() {}
 public static final ReminderConfiguration CONFIGURATION = new ReminderConfiguration(
  "alpha-reminder-envelope-v1", "alpha-local-reminders-v1", "reminder-taps:v1",
  "alpha-local-reminders", "Reminders",
  "Reminders you set on this phone. Android may delay them.",
  "Alpha Phone reminder", "ai.elizaresearch.alphaphone.REMIND",
  "ai.elizaresearch.alphaphone.REMINDER_DECISION", "ai.elizaresearch.alphaphone.OPEN_REMINDER",
  "alpha-reminder:", "alpha-reminder-decision:", "alpha-reminder-tap:",
  "alpha.reminder.id", "alpha.reminder.occurrence", "decision", "",
  ReminderReceiver.class, MainActivity.class, "Ask Alpha");
 public static final SecureStringStore.Factory STORAGE = context -> {
  AlphaCredentialStore storage = new AlphaCredentialStore(context);
  return new SecureStringStore() {
   public String identity() { return "alpha-credential-slots-v1"; }
   public String read(String key) throws Exception { return storage.readCredentialSlot(key); }
   public void write(String key, String value) throws Exception { storage.writeCredentialSlot(key, value); }
  };
 };
 public static ReminderEngine engine(Context context) {
  return ReminderEngine.get(context, CONFIGURATION, STORAGE);
 }
}
