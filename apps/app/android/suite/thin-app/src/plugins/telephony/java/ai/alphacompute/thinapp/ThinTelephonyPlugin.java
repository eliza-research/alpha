package ai.alphacompute.thinapp;

import ai.eliza.plugins.messages.SmsRoleConfiguration;
import ai.eliza.plugins.messages.SmsTelephonyConfiguration;
import ai.eliza.plugins.messages.TelephonyPlugin;
import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.telephony.TelephonyManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;

/** Thin standalone {@code ElizaTelephony} plugin exposing calls, SMS/MMS, Undo deletions, and intent handoffs. */
@CapacitorPlugin(name = "ElizaTelephony", permissions = {
    @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS }),
    @Permission(alias = "phoneState", strings = { Manifest.permission.READ_PHONE_STATE }),
    @Permission(alias = "sms", strings = { Manifest.permission.READ_SMS }),
    @Permission(alias = "sendSms", strings = { Manifest.permission.SEND_SMS }),
    @Permission(alias = "callLog", strings = { Manifest.permission.READ_CALL_LOG })
})
public final class ThinTelephonyPlugin extends TelephonyPlugin {
    private volatile String pendingNoticeThread;
    private volatile String pendingNoticeToken;
    private volatile String pendingDraftToken;
    private volatile List<String> pendingDraftRecipients = List.of();
    private volatile String pendingDraftBody = "";

    @Override public void load() {
        super.load();
        ThinDeletionBridge.register(ThinTelephonyDeletions::stage);
        if (getActivity() != null) {
            captureTelephonyIntent(getActivity().getIntent());
        }
    }

    @Override protected void handleOnNewIntent(Intent intent) {
        captureTelephonyIntent(intent);
        super.handleOnNewIntent(intent);
    }

    @Override protected SmsTelephonyConfiguration configuration() {
        return ThinTelephonyConfig.CONFIGURATION;
    }

    @Override protected DeletionWindow deletionWindow() {
        return (kind, target) -> ThinTelephonyDeletions.stage(getContext(), kind, target);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod public void classifyDialNumber(PluginCall call) {
        String number = call.getString("number", "");
        if (number == null || !NUMBER.matcher(number).matches()) {
            call.reject("Not a dialable phone number", "invalid");
            return;
        }
        String kind;
        try {
            TelephonyManager phone = getContext().getSystemService(TelephonyManager.class);
            kind = phone == null ? "unknown" : phone.isEmergencyNumber(number) ? "emergency" : "ordinary";
        } catch (RuntimeException unreadable) {
            kind = "unknown";
        }
        call.resolve(new JSObject().put("kind", kind));
    }

    @PluginMethod public void ownerDialScreen(PluginCall call) {
        super.dial(call);
    }

    @PluginMethod public void smsDraftPending(PluginCall call) {
        String token = pendingDraftToken;
        JSObject result = new JSObject();
        if (token != null) {
            result.put("token", token);
            result.put("recipients", new JSONArray(pendingDraftRecipients));
            result.put("body", pendingDraftBody);
        }
        call.resolve(result);
    }

    @PluginMethod public void acknowledgeSmsDraft(PluginCall call) {
        String token = call.getString("token");
        if (token != null && token.equals(pendingDraftToken)) {
            pendingDraftToken = null;
            pendingDraftRecipients = List.of();
            pendingDraftBody = "";
        }
        call.resolve();
    }

    @PluginMethod public void smsNoticePending(PluginCall call) {
        String token = pendingNoticeToken;
        String threadId = pendingNoticeThread;
        JSObject result = new JSObject();
        if (token != null && threadId != null) {
            result.put("threadId", threadId);
            result.put("token", token);
        }
        call.resolve(result);
    }

    @PluginMethod public void acknowledgeSmsNotice(PluginCall call) {
        String token = call.getString("token");
        if (token != null && token.equals(pendingNoticeToken)) {
            pendingNoticeToken = null;
            pendingNoticeThread = null;
        }
        call.resolve();
    }

    private void captureTelephonyIntent(Intent intent) {
        if (intent == null) return;
        String threadId = intent.getStringExtra(SmsRoleConfiguration.EXTRA_THREAD_ID);
        if (threadId != null && !threadId.isBlank()) {
            pendingNoticeThread = threadId;
            pendingNoticeToken = UUID.randomUUID().toString();
            notifyListeners("smsNotice", new JSObject(), true);
        }
        String action = intent.getAction();
        if (Intent.ACTION_SENDTO.equals(action)) {
            Uri data = intent.getData();
            String scheme = data == null ? null : data.getScheme();
            if ("sms".equals(scheme) || "smsto".equals(scheme) || "mms".equals(scheme) || "mmsto".equals(scheme)) {
                String rawPart = data.getSchemeSpecificPart();
                List<String> recipients = new ArrayList<>();
                if (rawPart != null) {
                    int query = rawPart.indexOf('?');
                    String clean = query >= 0 ? rawPart.substring(0, query) : rawPart;
                    for (String piece : clean.split("[,;]")) {
                        String trimmed = piece.trim();
                        if (!trimmed.isEmpty()) recipients.add(trimmed);
                    }
                }
                String body = intent.getStringExtra("sms_body");
                if (body == null) body = intent.getStringExtra(Intent.EXTRA_TEXT);
                pendingDraftRecipients = recipients;
                pendingDraftBody = body == null ? "" : body;
                pendingDraftToken = UUID.randomUUID().toString();
                notifyListeners("smsDraft", new JSObject(), true);
            }
        }
    }
}
