package ai.alphacompute.thinapp;

import ai.eliza.plugins.system.SystemPlugin;
import ai.eliza.plugins.system.clock.ClockHandoff;
import android.Manifest;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import java.util.ArrayList;

/** Thin standalone {@code ElizaSystem} plugin adding Alpha's {@code openClock} alarm handoff. */
@CapacitorPlugin(name = "ElizaSystem", permissions = @Permission(alias = "camera", strings = { Manifest.permission.CAMERA }))
public final class ThinSystemPlugin extends SystemPlugin {
    @PluginMethod public void openClock(PluginCall call) {
        String action = call.getString("action", "");
        JSArray days = call.getArray("days");
        ArrayList<Integer> repeats = null;
        if (days != null) {
            repeats = new ArrayList<>(days.length());
            for (int index = 0; index < days.length(); index++) {
                Object value = days.opt(index);
                if (!(value instanceof Integer day)) {
                    respond(call, ClockHandoff.result(action, ClockHandoff.Status.FAILED, "Choose valid repeat days"));
                    return;
                }
                repeats.add(day);
            }
        }
        final ArrayList<Integer> reviewedDays = repeats;
        if (getActivity() == null) {
            respond(call, ClockHandoff.result(action, ClockHandoff.Status.FAILED, "Open Alpha before continuing to Clock"));
            return;
        }
        getActivity().runOnUiThread(() -> respond(call, ClockHandoff.launch(
            getActivity(),
            "Alpha Phone",
            action,
            call.getInt("hour"),
            call.getInt("minute"),
            call.getString("label"),
            call.getInt("minutes"),
            call.getBoolean("reviewed", false),
            call.getString("timeZone"),
            reviewedDays
        )));
    }

    private void respond(PluginCall call, ClockHandoff.Result result) {
        JSObject reply = new JSObject()
            .put("action", result.action)
            .put("status", result.status.wire)
            .put("message", result.message);
        if (result.receiver != null) reply.put("receiver", result.receiver);
        call.resolve(reply);
    }
}
