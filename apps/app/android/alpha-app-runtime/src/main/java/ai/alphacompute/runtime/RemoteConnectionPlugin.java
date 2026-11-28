package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code AlphaConnection} Capacitor plugin delegating secure connection custody to AlphaCore. */
@CapacitorPlugin(name = "AlphaConnection")
public final class RemoteConnectionPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "AlphaConnection"; }

    @PluginMethod public void secureRead(PluginCall call) { forwardToCore(call, "secureRead"); }
    @PluginMethod public void secureCompareExchange(PluginCall call) { forwardToCore(call, "secureCompareExchange"); }
}
