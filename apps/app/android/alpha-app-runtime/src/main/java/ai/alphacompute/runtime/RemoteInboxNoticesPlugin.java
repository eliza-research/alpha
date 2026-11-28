package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code AlphaInboxNotices} Capacitor plugin delegating inbox notification policy to AlphaCore. */
@CapacitorPlugin(name = "AlphaInboxNotices")
public final class RemoteInboxNoticesPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "AlphaInboxNotices"; }

    @PluginMethod public void configure(PluginCall call) { forwardToCore(call, "configure"); }
    @PluginMethod public void withdraw(PluginCall call) { forwardToCore(call, "withdraw"); }
    @PluginMethod public void status(PluginCall call) { forwardToCore(call, "status"); }
    @PluginMethod public void pending(PluginCall call) { forwardToCore(call, "pending"); }
    @PluginMethod public void consume(PluginCall call) { forwardToCore(call, "consume"); }
    @PluginMethod public void releaseQuestion(PluginCall call) { forwardToCore(call, "releaseQuestion"); }
    @PluginMethod public void notificationSettings(PluginCall call) { forwardToCore(call, "notificationSettings"); }
}
