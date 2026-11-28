package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code ElizaReset} Capacitor plugin delegating device data reset review to AlphaCore. */
@CapacitorPlugin(name = "ElizaReset")
public final class RemoteResetPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "ElizaReset"; }

    @PluginMethod public void review(PluginCall call) { forwardToCore(call, "review"); }
}
