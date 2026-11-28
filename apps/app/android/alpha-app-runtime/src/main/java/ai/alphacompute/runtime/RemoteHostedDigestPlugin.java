package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code AlphaHostedDigestDelivery} Capacitor plugin delegating digest delivery state to AlphaCore. */
@CapacitorPlugin(name = "AlphaHostedDigestDelivery")
public final class RemoteHostedDigestPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "AlphaHostedDigestDelivery"; }

    @PluginMethod public void read(PluginCall call) { forwardToCore(call, "read"); }
    @PluginMethod public void syncManual(PluginCall call) { forwardToCore(call, "syncManual"); }
    @PluginMethod public void setBackground(PluginCall call) { forwardToCore(call, "setBackground"); }
    @PluginMethod public void enableNotifications(PluginCall call) { forwardToCore(call, "enableNotifications"); }
    @PluginMethod public void peekNotice(PluginCall call) { forwardToCore(call, "peekNotice"); }
    @PluginMethod public void settleNotice(PluginCall call) { forwardToCore(call, "settleNotice"); }
}
