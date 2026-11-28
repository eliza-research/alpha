package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code AlphaAssistantDraft} plugin delegating cross-app assistant draft persistence to AlphaCore. */
@CapacitorPlugin(name = "AlphaAssistantDraft")
public final class RemoteAssistantDraftPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "AlphaAssistantDraft"; }

    @PluginMethod public void read(PluginCall call) { forwardToCore(call, "read"); }
    @PluginMethod public void exchange(PluginCall call) { forwardToCore(call, "exchange"); }
}
