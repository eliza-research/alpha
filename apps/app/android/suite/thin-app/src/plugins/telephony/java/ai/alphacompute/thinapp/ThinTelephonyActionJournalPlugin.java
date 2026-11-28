package ai.alphacompute.thinapp;

import ai.alphacompute.runtime.AlphaBaseActivity;
import ai.alphacompute.runtime.RemoteActionJournalPlugin;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** Role-aware {@code ElizaActionJournal} plugin handling local telephony Undo windows while forwarding core journal ops. */
@CapacitorPlugin(name = "ElizaActionJournal")
public final class ThinTelephonyActionJournalPlugin extends RemoteActionJournalPlugin {
    private static final Pattern DELETION_ID = Pattern.compile("[A-Za-z0-9_-]{1,128}");

    @Override public void load() {
        super.load();
        ThinDeletionBridge.register(ThinTelephonyDeletions::stage);
    }

    @Override @PluginMethod public void pending(PluginCall call) {
        runOnWorker(call, () -> {
            try {
                call.resolve(JSObject.fromJSONObject(deletions().pendingWithOrigins()));
            } catch (Exception error) {
                call.reject("Action journal unavailable or transition rejected");
            }
        });
    }

    @Override @PluginMethod public void undo(PluginCall call) {
        runOnWorker(call, () -> {
            try {
                call.resolve(JSObject.fromJSONObject(deletions().undo(call.getString("kind"), call.getString("id"))));
            } catch (Exception error) {
                call.reject("Action journal unavailable or transition rejected");
            }
        });
    }

    @Override @PluginMethod public void dismiss(PluginCall call) {
        runOnWorker(call, () -> {
            try {
                call.resolve(JSObject.fromJSONObject(deletions().dismiss(call.getString("kind"), call.getString("id"))));
            } catch (Exception error) {
                call.reject("Action journal unavailable or transition rejected");
            }
        });
    }

    @Override @PluginMethod public void telephonyDeletionReceipt(PluginCall call) {
        runOnWorker(call, () -> {
            try {
                String kind = call.getString("kind", "");
                String id = call.getString("id", "");
                if (!("message".equals(kind) || "voicemail".equals(kind) || "contact".equals(kind))
                    || id == null || !DELETION_ID.matcher(id).matches()) {
                    call.reject("Invalid telephony deletion identity");
                    return;
                }
                DeferredDeletionCoordinator coordinator = deletions();
                JSONObject row = coordinator.receipt(kind, id);
                if (row == null || !DeferredDeletionJournal.same(row.getJSONObject("owner"), coordinator.manualOwner())) {
                    call.resolve(new JSObject());
                    return;
                }
                deletions();
                String phase = row.getString("phase");
                JSObject reply = switch (phase) {
                    case "deleted", "undone", "conflict", "unknown" -> new JSObject()
                        .put("kind", kind)
                        .put("id", id)
                        .put("phase", phase);
                    default -> new JSObject();
                };
                call.resolve(reply);
            } catch (SecurityException | IllegalArgumentException error) {
                String msg = error.getMessage();
                call.reject(msg != null && !msg.isBlank() ? msg : "Action journal unavailable or transition rejected");
            } catch (Exception error) {
                call.reject("Action journal unavailable or transition rejected");
            }
        });
    }

    private DeferredDeletionCoordinator deletions() {
        if (!AlphaBaseActivity.shareForeground(getActivity())) {
            throw new SecurityException("Open and unlock Alpha to review pending deletions.");
        }
        return ThinTelephonyDeletions.get(getContext());
    }
}
