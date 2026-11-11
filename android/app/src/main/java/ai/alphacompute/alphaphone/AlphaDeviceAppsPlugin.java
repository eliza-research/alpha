package ai.alphacompute.alphaphone;

import android.content.Intent;
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
  result.put("sense",AlphaSenseAdmission.available(getContext()));
  result.put("phone",false);result.put("contacts",AlphaImageCapabilities.aospImage(getContext()));result.put("sms",false);call.resolve(result);
 }
 /** The recovery screen's way out of Alpha as HOME (launcher builds): the stock Home picker, else
  * default apps, else Settings itself, never one of Alpha's own activities. Only from a user tap. */
 @PluginMethod public void openHomeChooser(PluginCall call){
  if(!BuildConfig.IS_LAUNCHER){call.reject("Not a launcher build");return;}
  java.util.function.Predicate<String> resolves=candidate->new Intent(candidate).resolveActivity(getContext().getPackageManager())!=null;
  String action=RendererRecoveryBudget.homeChoiceAction(resolves);
  if(action==null){call.reject("No Home or Settings screen");return;}
  LateLaunch.ask(call,()->{try{getContext().startActivity(new Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));call.resolve();}
  catch(RuntimeException unavailable){call.reject("Home chooser unavailable: "+unavailable.getClass().getSimpleName());}});
 }
}
