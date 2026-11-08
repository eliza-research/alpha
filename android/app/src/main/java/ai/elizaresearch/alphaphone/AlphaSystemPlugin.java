package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.LauncherApps;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Process;
import android.os.UserHandle;
import android.os.UserManager;
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
  * long-press menu). Only Settings opens; nothing about the app changes. App info needs only the
  * package in that profile: a disabled app, or one in a paused or locked work profile, still opens
  * it (that is where it is enabled again); a removed app or profile is refused. */
 @PluginMethod public void openAppInfo(PluginCall call){
  if(SystemLauncherApps.malformedText(call.getData(),"packageName")||SystemLauncherApps.malformedText(call.getData(),"activityName")||SystemLauncherApps.malformedText(call.getData(),"user")){call.reject("Choose an installed app");return;}
  String name=call.getString("packageName"),activity=call.getString("activityName"),user=call.getString("user");
  if(name==null||name.isEmpty()||name.equals(getContext().getPackageName())){call.reject("Choose an installed app");return;}
  try{
   if(user==null){
    try{getContext().getPackageManager().getApplicationInfo(name,PackageManager.MATCH_DISABLED_COMPONENTS);}
    catch(PackageManager.NameNotFoundException gone){call.reject("This app is no longer installed.",SystemLauncherApps.NOT_INSTALLED);return;}
    getContext().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.fromParts("package",name,null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    call.resolve();return;
   }
   long serial;try{serial=Long.parseLong(user);}catch(NumberFormatException invalid){call.reject("Choose an installed app");return;}
   LauncherApps launcher=getContext().getSystemService(LauncherApps.class);UserManager users=getContext().getSystemService(UserManager.class);
   UserHandle handle=users==null?null:users.getUserForSerialNumber(serial);
   if(launcher==null||handle==null||handle.equals(Process.myUserHandle())||!launcher.getProfiles().contains(handle)){call.reject("This profile is no longer on the phone.",SystemLauncherApps.PROFILE_UNAVAILABLE);return;}
   try{launcher.getApplicationInfo(name,PackageManager.MATCH_DISABLED_COMPONENTS,handle);}
   catch(PackageManager.NameNotFoundException gone){call.reject("This app is no longer available in that profile.",SystemLauncherApps.NOT_INSTALLED);return;}
   launcher.startAppDetailsActivity(new ComponentName(name,activity==null||activity.isEmpty()?name:activity),handle,null,null);
   call.resolve();
  }
  catch(IllegalArgumentException invalid){call.reject("Choose an installed app");}
  catch(RuntimeException error){call.reject("App info could not be opened",SystemLauncherApps.FAILED,error);}
 }
}
