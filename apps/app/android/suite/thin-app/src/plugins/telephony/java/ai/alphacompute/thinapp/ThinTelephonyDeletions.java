package ai.alphacompute.thinapp;

import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import ai.eliza.plugins.contacts.ContactsEditor;
import ai.eliza.plugins.messages.MessageDeletion;
import ai.eliza.plugins.messages.TelephonyPlugin;
import ai.eliza.plugins.messages.ThreadDeletion;
import ai.eliza.plugins.messages.VoicemailStore;
import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.SystemClock;
import android.os.UserManager;
import android.provider.Settings;
import java.util.Map;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import org.json.JSONArray;
import org.json.JSONObject;

/** Durable per-owner deferred deletion Undo coordinator for thin Phone, Messages, and Contacts apps. */
final class ThinTelephonyDeletions {
    private static final String PREFS_NAME = "alpha-thin-deletion-journal";
    private static final String KEY_ALIAS = "alpha-thin-deletion-journal-v1";
    private static final String JOURNAL = "native-delete-journal:v1";
    private static final String INSTALLATION = "native-delete-installation:v1";
    private static final String UNKNOWN_BOOT = "unknown:" + UUID.randomUUID();

    private static DeferredDeletionCoordinator coordinator;

    private ThinTelephonyDeletions() {}

    static synchronized DeferredDeletionCoordinator get(Context context) {
        if (coordinator == null) {
            coordinator = create(context.getApplicationContext());
        }
        return coordinator;
    }

    static JSONObject stage(Context context, String kind, JSONObject target) throws Exception {
        if (refusal(context, kind) != null) {
            throw new SecurityException("Telephony deletion access changed.");
        }
        return get(context).stageRecord(kind, target);
    }

    private static DeferredDeletionCoordinator create(Context context) {
        ThinEncryptedSlots slots = new ThinEncryptedSlots(context, PREFS_NAME, KEY_ALIAS);
        return new DeferredDeletionCoordinator(
            new DeferredDeletionCoordinator.Configuration(JOURNAL, INSTALLATION),
            new DeferredDeletionCoordinator.Slots() {
                @Override public String read(String slot) throws Exception { return slots.read(slot); }
                @Override public void write(String slot, String value) throws Exception { slots.write(slot, value); }
            },
            new DeferredDeletionCoordinator.Clock() {
                @Override public String continuity() {
                    try {
                        return "boot:" + Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT);
                    } catch (Settings.SettingNotFoundException | SecurityException unavailable) {
                        return UNKNOWN_BOOT;
                    }
                }
                @Override public long elapsed() { return SystemClock.elapsedRealtime(); }
                @Override public long wall() { return System.currentTimeMillis(); }
            },
            new DeferredDeletionCoordinator.Owners() {
                @Override public JSONObject identity() { throw unsupported(); }
                @Override public String reviewFence(JSONObject identity) { throw unsupported(); }
            },
            new DeferredDeletionCoordinator.Reminders() {
                @Override public JSONArray pendingDeletions() { return new JSONArray(); }
                @Override public JSONObject stageDeletion(String id, String owner, JSONObject target, JSONObject clock, JSONObject binding) { throw unsupported(); }
                @Override public JSONObject settleDeletion(String id, String owner, JSONObject clock, boolean undo) { throw unsupported(); }
                @Override public void pauseDeletion(String id, String owner, String reason) { throw unsupported(); }
                @Override public JSONObject reminder(String id) { throw unsupported(); }
            },
            new DeferredDeletionCoordinator.CalendarDeletions() {
                @Override public String refusal(JSONObject owner, JSONObject target) { return "access-changed"; }
                @Override public JSONObject dispatch(JSONObject target) { throw unsupported(); }
                @Override public boolean targets(JSONObject target, long sourceId, long eventId) { return false; }
            },
            new DeferredDeletionCoordinator.Records() {
                @Override public String refusal(String kind, JSONObject owner, JSONObject target) {
                    return ThinTelephonyDeletions.refusal(context, kind);
                }

                @Override public JSONObject dispatch(String kind, JSONObject target) {
                    BooleanSupplier allowed = () -> ThinTelephonyDeletions.refusal(context, kind) == null;
                    return switch (kind) {
                        case "message" -> MessageDeletion.dispatch(context, target, allowed);
                        case "thread" -> ThreadDeletion.dispatch(context, target, allowed);
                        case "voicemail" -> VoicemailStore.dispatchDeletion(context, target, allowed);
                        case "contact" -> allowed.getAsBoolean()
                            ? ContactsEditor.dispatchRemoval(context, target)
                            : new JSONObject(Map.of("status", "conflict"));
                        default -> throw unsupported();
                    };
                }
            },
            delay -> ThinTelephonyDeletionWakeup.schedule(context, delay)
        );
    }

    private static String refusal(Context context, String kind) {
        UserManager users = context.getSystemService(UserManager.class);
        if (users == null || !users.isUserUnlocked() || (Build.VERSION.SDK_INT >= 31 && !users.isUserForeground())) {
            return "owner-unavailable";
        }
        return switch (kind) {
            case "message", "thread" -> MessageDeletion.roleGuard(context).getAsBoolean() ? null : "access-changed";
            case "voicemail" -> TelephonyPlugin.voicemailDeletable(context) ? null : "access-changed";
            case "contact" -> context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED
                && context.checkSelfPermission(Manifest.permission.WRITE_CONTACTS) == PackageManager.PERMISSION_GRANTED
                ? null : "permission-required";
            default -> "access-changed";
        };
    }

    private static UnsupportedOperationException unsupported() {
        return new UnsupportedOperationException("Only manual telephony deletions are configured.");
    }
}
