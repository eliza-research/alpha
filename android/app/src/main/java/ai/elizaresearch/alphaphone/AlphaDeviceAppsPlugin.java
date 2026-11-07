package ai.elizaresearch.alphaphone;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Alpha's product-only image admission. Installed-app listing, launching, default-handler
 * hand-offs and the build, launch and locale reads are the shared ElizaSystem plugin
 * ({@link AlphaSystemPlugin}); Alpha lists and launches nothing itself. */
@CapacitorPlugin(name="DeviceApps")
public final class AlphaDeviceAppsPlugin extends Plugin {
 @PluginMethod public void platformCapabilities(PluginCall call){
  JSObject result=new JSObject();result.put("aospImage",AlphaImageCapabilities.aospImage(getContext()));
  result.put("phone",false);result.put("contacts",AlphaImageCapabilities.aospImage(getContext()));result.put("sms",false);call.resolve(result);
 }
}
