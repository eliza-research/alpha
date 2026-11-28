package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code AlphaCarrierSetup} plugin delegating carrier and eSIM setup queries to AlphaCore. */
@CapacitorPlugin(name = "AlphaCarrierSetup")
public final class RemoteCarrierSetupPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "AlphaCarrierSetup"; }

    @PluginMethod public void read(PluginCall call) { forwardToCore(call, "read"); }
    @PluginMethod public void readEid(PluginCall call) { forwardToCore(call, "readEid"); }
    @PluginMethod public void openSettings(PluginCall call) { forwardToCore(call, "openSettings"); }
}
