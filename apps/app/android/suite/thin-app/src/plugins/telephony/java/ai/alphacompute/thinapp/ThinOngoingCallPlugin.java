package ai.alphacompute.thinapp;

import ai.eliza.plugins.phone.TelecomCallService;
import android.content.Intent;
import android.telecom.Call;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Standalone {@code AlphaOngoingCall} plugin reporting live Telecom calls from {@link ThinInCallService}. */
@CapacitorPlugin(name = "AlphaOngoingCall")
public final class ThinOngoingCallPlugin extends Plugin {
    private final Runnable changed = () -> notifyListeners("ongoingCall", snapshot());

    @Override public void load() {
        super.load();
        TelecomCallService.observe(changed);
    }

    @Override protected void handleOnDestroy() {
        TelecomCallService.unobserve(changed);
        super.handleOnDestroy();
    }

    @PluginMethod public void ongoingCall(PluginCall call) {
        call.resolve(snapshot());
    }

    @PluginMethod public void showCall(PluginCall call) {
        String id = call.getString("id");
        boolean known = id != null && TelecomCallService.call(id) != null;
        if (known) {
            getContext().startActivity(new Intent(getContext(), ThinCallActivity.class)
                .putExtra("callId", id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        }
        call.resolve(new JSObject().put("shown", known));
    }

    @PluginMethod public void endCall(PluginCall call) {
        String id = call.getString("id");
        Call current = id == null ? null : TelecomCallService.call(id);
        boolean ended = false;
        if (current != null) {
            int state = current.getState();
            ended = isRinging(state)
                ? TelecomCallService.rejectCall(id, false, null)
                : TelecomCallService.disconnectCall(id);
        }
        call.resolve(new JSObject().put("ended", ended));
    }

    private static JSObject snapshot() {
        JSArray calls = new JSArray();
        for (String id : TelecomCallService.callIds()) {
            Call call = TelecomCallService.call(id);
            if (call == null) continue;
            int telecom = call.getState();
            String state = ongoingState(telecom);
            if (state == null) continue;
            Call.Details details = call.getDetails();
            long connectTime = details == null ? 0L : details.getConnectTimeMillis();
            JSObject row = new JSObject();
            row.put("id", id);
            row.put("state", state);
            row.put("connectedAt", (telecom == Call.STATE_ACTIVE || telecom == Call.STATE_HOLDING) && connectTime > 0
                ? Long.valueOf(connectTime)
                : JSObject.NULL);
            calls.put(row);
        }
        return new JSObject().put("calls", calls);
    }

    private static boolean isRinging(int state) {
        return state == Call.STATE_RINGING || state == Call.STATE_SIMULATED_RINGING;
    }

    private static String ongoingState(int state) {
        return switch (state) {
            case Call.STATE_RINGING, Call.STATE_SIMULATED_RINGING -> "ringing";
            case Call.STATE_DIALING, Call.STATE_CONNECTING, Call.STATE_SELECT_PHONE_ACCOUNT -> "dialing";
            case Call.STATE_ACTIVE -> "active";
            case Call.STATE_HOLDING -> "holding";
            default -> null;
        };
    }
}
