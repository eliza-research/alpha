package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code AlphaCallState} plugin delegating live telecom call state snapshots to AlphaCore. */
@CapacitorPlugin(name = "AlphaCallState")
public final class RemoteCallStatePlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "AlphaCallState"; }

    @PluginMethod public void callState(PluginCall call) { forwardToCore(call, "callState"); }
}
