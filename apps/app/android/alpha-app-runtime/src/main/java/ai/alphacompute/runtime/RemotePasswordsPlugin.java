package ai.alphacompute.runtime;

import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Core-proxied {@code ElizaPasswords} Capacitor plugin delegating vault operations to AlphaCore. */
@CapacitorPlugin(name = "ElizaPasswords")
public final class RemotePasswordsPlugin extends CorePluginProxy {
    @Override protected String corePluginName() { return "ElizaPasswords"; }

    @PluginMethod public void status(PluginCall call) { forwardToCore(call, "status"); }
    @PluginMethod public void unlock(PluginCall call) { forwardToCore(call, "unlock"); }
    @PluginMethod public void lock(PluginCall call) { forwardToCore(call, "lock"); }
    @PluginMethod public void list(PluginCall call) { forwardToCore(call, "list"); }
    @PluginMethod public void anySaved(PluginCall call) { forwardToCore(call, "anySaved"); }
    @PluginMethod public void save(PluginCall call) { forwardToCore(call, "save"); }
    @PluginMethod public void openEditor(PluginCall call) { forwardToCore(call, "openEditor"); }
    @PluginMethod public void remove(PluginCall call) { forwardToCore(call, "remove"); }
    @PluginMethod public void reset(PluginCall call) { forwardToCore(call, "reset"); }
    @PluginMethod public void reveal(PluginCall call) { forwardToCore(call, "reveal"); }
    @PluginMethod public void copy(PluginCall call) { forwardToCore(call, "copy"); }
    @PluginMethod public void openAutofillSettings(PluginCall call) { forwardToCore(call, "openAutofillSettings"); }
}
