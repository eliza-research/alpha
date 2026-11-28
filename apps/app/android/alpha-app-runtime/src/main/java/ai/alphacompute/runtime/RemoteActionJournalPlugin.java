package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code ElizaActionJournal} Capacitor plugin delegating device execution journal operations to AlphaCore. */
@CapacitorPlugin(name = "ElizaActionJournal")
public class RemoteActionJournalPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "ElizaActionJournal"; }

    @PluginMethod public void reserve(PluginCall call) { forwardToCore(call, "reserve"); }
    @PluginMethod public void markApplying(PluginCall call) { forwardToCore(call, "markApplying"); }
    @PluginMethod public void finish(PluginCall call) { forwardToCore(call, "finish"); }
    @PluginMethod public void pending(PluginCall call) { forwardToCore(call, "pending"); }
    @PluginMethod public void undo(PluginCall call) { forwardToCore(call, "undo"); }
    @PluginMethod public void dismiss(PluginCall call) { forwardToCore(call, "dismiss"); }
    @PluginMethod public void get(PluginCall call) { forwardToCore(call, "get"); }
    @PluginMethod public void list(PluginCall call) { forwardToCore(call, "list"); }
    @PluginMethod public void edit(PluginCall call) { forwardToCore(call, "edit"); }
    @PluginMethod public void telephonyDeletionReceipt(PluginCall call) { forwardToCore(call, "telephonyDeletionReceipt"); }
}
