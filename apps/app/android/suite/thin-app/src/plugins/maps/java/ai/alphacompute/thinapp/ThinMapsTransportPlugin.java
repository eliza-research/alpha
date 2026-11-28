package ai.alphacompute.thinapp;

import android.app.Activity;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Standalone {@code AlphaMapsTransport} plugin managing background navigation sessions for Maps. */
@CapacitorPlugin(name = "AlphaMapsTransport")
public final class ThinMapsTransportPlugin extends Plugin {
    private volatile boolean destroyed;

    private final ThinNavigationService.StopListener navigationStops = (session, reason) -> {
        if (destroyed) return;
        notifyListeners("navigationStopped", new JSObject().put("sessionId", session).put("reason", reason));
    };

    private static String boundedText(PluginCall call, String name) {
        String value = call.getString(name, "");
        return value == null ? "" : value.length() > 200 ? value.substring(0, 200) : value;
    }

    @Override public void load() {
        super.load();
        if (getActivity() != null) {
            ThinNavigationService.offerFromIntent(getActivity().getIntent());
        }
    }

    @Override protected void handleOnNewIntent(Intent intent) {
        ThinNavigationService.offerFromIntent(intent);
        super.handleOnNewIntent(intent);
    }

    @PluginMethod public void consumeNavigationOpen(PluginCall call) {
        Activity activity = getActivity();
        boolean open = !destroyed && activity != null && !activity.isFinishing() && !activity.isDestroyed()
            && ThinNavigationService.consumeShowMaps();
        call.resolve(new JSObject().put("open", open));
    }

    @PluginMethod public void clearNavigationOpen(PluginCall call) {
        ThinNavigationService.clearShowMaps();
        call.resolve();
    }

    @PluginMethod public void navigationAvailability(PluginCall call) {
        call.resolve(new JSObject()
            .put("background", ThinNavigationService.declared(getContext()))
            .put("activeSessionId", ThinNavigationService.activeSession()));
    }

    @PluginMethod public void startNavigation(PluginCall call) {
        String session = call.getString("sessionId");
        if (session == null || !session.matches(ThinNavigationService.SESSION_PATTERN)) {
            call.reject("Invalid navigation session");
            return;
        }
        if (!ThinNavigationService.declared(getContext())) {
            call.reject("Background navigation is unavailable in this build", "unavailable");
            return;
        }
        if (!ThinNavigationService.locationGranted(getContext())) {
            call.reject("Location permission is required for background navigation", "permission-denied");
            return;
        }
        if (destroyed) {
            call.reject("Background navigation is unavailable: Alpha closed", "unavailable");
            return;
        }
        try {
            Activity activity = getActivity();
            boolean started = ThinNavigationService.start(
                getContext(),
                session,
                boundedText(call, "title"),
                boundedText(call, "text"),
                navigationStops,
                activity == null ? null : activity.getComponentName(),
                () -> !destroyed
            );
            if (!started) {
                call.reject(
                    destroyed ? "Background navigation is unavailable: Alpha closed" : "Background navigation changed",
                    "unavailable"
                );
                return;
            }
            call.resolve();
        } catch (RuntimeException refused) {
            call.reject("Background navigation could not start", "unavailable");
        }
    }

    @PluginMethod public void updateNavigation(PluginCall call) {
        String session = call.getString("sessionId");
        boolean active;
        try {
            active = session != null && ThinNavigationService.update(
                getContext(),
                session,
                boundedText(call, "title"),
                boundedText(call, "text"),
                navigationStops
            );
        } catch (RuntimeException unavailable) {
            active = false;
        }
        call.resolve(new JSObject().put("active", active));
    }

    @PluginMethod public void navigationArrived(PluginCall call) {
        boolean shown;
        try {
            shown = !destroyed && ThinNavigationService.arrived(
                getContext(),
                navigationStops,
                boundedText(call, "title"),
                boundedText(call, "text")
            );
        } catch (RuntimeException unavailable) {
            shown = false;
        }
        call.resolve(new JSObject().put("shown", shown));
    }

    @PluginMethod public void stopNavigation(PluginCall call) {
        String session = call.getString("sessionId");
        boolean stopped = session != null && ThinNavigationService.stop(getContext(), session, navigationStops, "app");
        call.resolve(new JSObject().put("stopped", stopped));
    }

    @Override protected void handleOnDestroy() {
        destroyed = true;
        ThinNavigationService.stop(getContext(), null, navigationStops, "renderer-closed");
        super.handleOnDestroy();
    }
}
