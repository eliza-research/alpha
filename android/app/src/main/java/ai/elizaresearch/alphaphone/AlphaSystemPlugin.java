package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.Intent;
import android.content.pm.LauncherApps;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import ai.eliza.plugins.system.SystemLauncherApps;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Product policy stays in Alpha; shared System behavior is unchanged for other hosts. */
@CapacitorPlugin(name="ElizaSystem",permissions={@Permission(alias="camera",strings={Manifest.permission.CAMERA})})
public final class AlphaSystemPlugin extends ai.eliza.plugins.system.SystemPlugin {
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 @Override @PluginMethod public void requestRole(PluginCall call){LateLaunch.ask(call,()->super.requestRole(call));}
 @Override @PluginMethod public void setFlashlight(PluginCall call){LateLaunch.ask(call,()->super.setFlashlight(call));}
 @Override protected boolean isRoleEnabled(String role){return AlphaImageCapabilities.roleEnabled(role);}
 /** The dial hand-off exists only in the launcher build on an admitted image: the HOME role keeps a
  * path to the stock dialer and emergency calls; a standalone APK shows no Phone entry (P-36). */
 @Override protected boolean isDefaultAppEnabled(String role){return BuildConfig.IS_LAUNCHER&&AlphaImageCapabilities.defaultAppEnabled(getContext(),role);}
 @Override protected boolean isLauncherBuild(){return BuildConfig.IS_LAUNCHER;}
 @Override protected String buildVersion(){return BuildConfig.VERSION_NAME;}
 /** ACTION_ASSIST, or AlphaAssistActivity's own marker extra. */
 @Override protected boolean isAssistantLaunch(Intent intent){return super.isAssistantLaunch(intent)||(intent!=null&&intent.getBooleanExtra(AlphaAssistActivity.EXTRA_ASSISTANT,false));}
 /** Only the launcher flavor drives Android's shade (#416, #417); the standalone app never asks. */
 @Override protected boolean canExpandNotificationShade(){return BuildConfig.IS_LAUNCHER;}
 /** Android's App info for exactly one listed launcher entry, in its profile (the Apps drawer's
  * long-press menu). Only Settings opens; nothing about the app changes. The entry is resolved as a
  * launch is, so a removed, disabled or locked one is refused with the same code and words. */
 @PluginMethod public void openAppInfo(PluginCall call){
  if(SystemLauncherApps.malformedText(call.getData(),"activityName")||SystemLauncherApps.malformedText(call.getData(),"user")){call.reject("Choose an installed app");return;}
  String name=call.getString("packageName"),activity=call.getString("activityName"),user=call.getString("user");
  try{
   if(activity!=null){
    SystemLauncherApps.Target target=SystemLauncherApps.resolve(getContext(),name,activity,user);
    if(target.user!=null){getContext().getSystemService(LauncherApps.class).startAppDetailsActivity(target.component,target.user,null,null);call.resolve();return;}
    name=target.component.getPackageName();
   }else{
    if(user!=null||name==null||name.isEmpty()||name.equals(getContext().getPackageName())){call.reject("Choose an installed app");return;}
    try{getContext().getPackageManager().getApplicationInfo(name,0);}
    catch(PackageManager.NameNotFoundException gone){call.reject("This app is no longer installed.",SystemLauncherApps.NOT_INSTALLED);return;}
   }
   getContext().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.fromParts("package",name,null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
   call.resolve();
  }
  catch(IllegalArgumentException invalid){call.reject("Choose an installed app");}
  catch(SystemLauncherApps.Refusal refusal){call.reject(refusal.getMessage(),refusal.code);}
  catch(RuntimeException error){call.reject("App info could not be opened",SystemLauncherApps.FAILED,error);}
 }
}
