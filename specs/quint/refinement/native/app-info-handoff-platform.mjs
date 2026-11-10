import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {app, root} from './java.mjs';

export const appInfoSource = app + 'AlphaSystemPlugin.java';
export const launcherPath = 'plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/SystemLauncherApps.java';
export const pluginCallSource = 'node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java';

function exact(text, first, last) {
  const start = text.indexOf(first), end = text.indexOf(last, start + first.length);
  assert.ok(start >= 0 && end > start, `App info source anchors: ${first}, ${last}`);
  return text.slice(start, end);
}

export function appInfoPlatform(temporary, stagedLauncher) {
  const launcher = readFileSync(stagedLauncher, 'utf8');
  const call = readFileSync(join(root, pluginCallSource), 'utf8');
  const constants = ['NOT_INSTALLED', 'PROFILE_UNAVAILABLE', 'FAILED'].map(name => {
    const member = launcher.match(new RegExp(`    public static final String ${name} = "[^"]+";`));
    assert.ok(member, name);
    return member[0];
  });
  const files = {
    'ai/eliza/plugins/system/SystemLauncherApps.java':`package ai.eliza.plugins.system;
public final class SystemLauncherApps {
${constants.join('\n')}
${exact(launcher, '    public static boolean malformedText(', '    /** Why the current user')}
}`,
    'ai/eliza/plugins/system/SystemPlugin.java':`package ai.eliza.plugins.system;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.PluginCall;
public class SystemPlugin {
 private Context context;
 public void attach(Context value){context=value;}
 public Context getContext(){return context;}
 public void requestPermissions(PluginCall call){throw new AssertionError("permission request outside fixture");}
 public void requestRole(PluginCall call){throw new AssertionError("role request outside fixture");}
 public void setFlashlight(PluginCall call){throw new AssertionError("flashlight request outside fixture");}
 protected boolean isRoleEnabled(String role){throw new AssertionError("role outside fixture");}
 protected boolean isDefaultAppEnabled(String role){throw new AssertionError("role outside fixture");}
 protected boolean isLauncherBuild(){throw new AssertionError("flavor outside fixture");}
 protected String buildVersion(){throw new AssertionError("version outside fixture");}
 protected boolean isAssistantLaunch(Intent intent){throw new AssertionError("assistant launch outside fixture");}
 protected boolean canExpandNotificationShade(){throw new AssertionError("shade outside fixture");}
}`,
    'ai/alphacompute/alphaphone/LateLaunch.java':`package ai.alphacompute.alphaphone;
public class LateLaunch {
 static void ask(com.getcapacitor.PluginCall call,Runnable body){throw new AssertionError("late launch outside fixture");}
}`,
    'ai/alphacompute/alphaphone/AlphaImageCapabilities.java':`package ai.alphacompute.alphaphone;
public class AlphaImageCapabilities {
 static boolean roleEnabled(String role){throw new AssertionError("role outside fixture");}
 static boolean defaultAppEnabled(android.content.Context context,String role){throw new AssertionError("role outside fixture");}
}`,
    'ai/alphacompute/alphaphone/BuildConfig.java':`package ai.alphacompute.alphaphone;
public class BuildConfig {static final boolean IS_LAUNCHER=false;static final String VERSION_NAME="fixture";}`,
    'ai/alphacompute/alphaphone/AlphaAssistActivity.java':`package ai.alphacompute.alphaphone;
public class AlphaAssistActivity {static final String EXTRA_ASSISTANT="fixture.assist";}`,
    'android/Manifest.java':`package android;
public final class Manifest {public static final class permission {public static final String CAMERA="android.permission.CAMERA";}}`,
    'android/provider/Settings.java':`package android.provider;
public final class Settings {
 public static final String ACTION_APPLICATION_DETAILS_SETTINGS="android.settings.APPLICATION_DETAILS_SETTINGS";
}`,
    'android/net/Uri.java':`package android.net;
public record Uri(String scheme,String part,String fragment) {
 public static Uri fromParts(String scheme,String part,String fragment){return new Uri(scheme,part,fragment);}
 public String toString(){return scheme+":"+part+(fragment==null?"":"#"+fragment);}
}`,
    'android/content/Intent.java':`package android.content;
public final class Intent {
 public static final int FLAG_ACTIVITY_NEW_TASK=0x10000000;
 public final String action;
 public final android.net.Uri data;
 public int flags;
 public Intent(String action,android.net.Uri data){this.action=action;this.data=data;}
 public Intent addFlags(int value){flags|=value;return this;}
 public boolean getBooleanExtra(String name,boolean fallback){throw new AssertionError("extra outside fixture");}
}`,
    'android/content/ComponentName.java':`package android.content;
public record ComponentName(String packageName,String className) {
 public String flattened(){return packageName+"/"+className;}
}`,
    'android/os/UserHandle.java':`package android.os;
public record UserHandle(int id) {}`,
    'android/os/Process.java':`package android.os;
public final class Process {public static UserHandle myUserHandle(){return new UserHandle(10);}}`,
    'android/os/UserManager.java':`package android.os;
public final class UserManager {
 public String profile="present";
 public UserHandle getUserForSerialNumber(long serial){
  if(serial==10) return Process.myUserHandle();
  if(serial==270 && !profile.equals("unmapped")) return new UserHandle(27);
  return null;
 }
 public boolean isQuietModeEnabled(UserHandle handle){return profile.equals("paused");}
 public boolean isUserUnlocked(UserHandle handle){return !profile.equals("locked");}
}`,
    'android/content/pm/ApplicationInfo.java':`package android.content.pm;
public record ApplicationInfo(boolean enabled) {}`,
    'android/content/pm/PackageManager.java':`package android.content.pm;
public final class PackageManager {
 public static final int MATCH_DISABLED_COMPONENTS=0x200;
 public static final class NameNotFoundException extends Exception {}
 public String status="enabled";
 public String name;
 public int flags;
 public ApplicationInfo getApplicationInfo(String packageName,int options)throws NameNotFoundException{
  if(name!=null)throw new AssertionError("Duplicate personal lookup");
  name=packageName;flags=options;
  if(status.equals("denied"))throw new SecurityException("Controlled lookup refusal");
  if(status.equals("removed")||status.equals("disabled")&&(flags&MATCH_DISABLED_COMPONENTS)==0)throw new NameNotFoundException();
  return new ApplicationInfo(status.equals("enabled"));
 }
}`,
    'android/content/pm/LauncherApps.java':`package android.content.pm;
import android.content.ComponentName;
import android.os.UserHandle;
import java.util.List;
public final class LauncherApps {
 public final PackageManager packages=new PackageManager();
 public String profile="present", launch="allowed";
 public UserHandle queryUser, launchUser;
 public ComponentName attempt;
 public boolean opened;
 public List<UserHandle> getProfiles(){
  if(profile.equals("denied"))throw new SecurityException("Controlled profile enumeration refusal");
  return profile.equals("removed")?List.of(new UserHandle(10),new UserHandle(28)):
      List.of(new UserHandle(10),new UserHandle(28),new UserHandle(27));
 }
 public ApplicationInfo getApplicationInfo(String name,int flags,UserHandle handle)throws PackageManager.NameNotFoundException{
  queryUser=handle;
  return packages.getApplicationInfo(name,flags);
 }
 public void startAppDetailsActivity(ComponentName component,UserHandle handle,Object sourceBounds,Object options){
  if(attempt!=null||sourceBounds!=null||options!=null)throw new AssertionError("Unexpected profile dispatch");
  attempt=component;launchUser=handle;
  switch(launch){
   case "allowed" -> opened=true;
   case "argument" -> throw new IllegalArgumentException("Controlled argument refusal");
   case "runtime" -> throw new SecurityException("Controlled dispatch refusal");
   default -> throw new AssertionError(launch);
  }
 }
}`,
    'android/content/Context.java':`package android.content;
import android.content.pm.LauncherApps;
import android.content.pm.PackageManager;
import android.os.UserManager;
public final class Context {
 public final PackageManager personal=new PackageManager();
 public final LauncherApps launcher=new LauncherApps();
 public final UserManager users=new UserManager();
 public String profile="present", launch="allowed";
 public Intent attempt;
 public boolean opened;
 public String getPackageName(){return "fixture.alpha";}
 public PackageManager getPackageManager(){return personal;}
 public <T> T getSystemService(Class<T> type){
  if(type==LauncherApps.class)return profile.equals("noLauncher")?null:type.cast(launcher);
  if(type==UserManager.class)return profile.equals("noUsers")?null:type.cast(users);
  throw new AssertionError("Unexpected service");
 }
 public void startActivity(Intent intent){
  if(attempt!=null)throw new AssertionError("Duplicate personal dispatch");
  attempt=intent;
  switch(launch){
   case "allowed" -> opened=true;
   case "argument" -> throw new IllegalArgumentException("Controlled argument refusal");
   case "runtime" -> throw new SecurityException("Controlled dispatch refusal");
   default -> throw new AssertionError(launch);
  }
 }
}`,
    'com/getcapacitor/JSObject.java':'package com.getcapacitor;public final class JSObject extends org.json.JSONObject {}',
    'com/getcapacitor/PluginMethod.java':'package com.getcapacitor;public @interface PluginMethod {}',
    'com/getcapacitor/annotation/Permission.java':'package com.getcapacitor.annotation;public @interface Permission {String alias();String[] strings();}',
    'com/getcapacitor/annotation/CapacitorPlugin.java':'package com.getcapacitor.annotation;public @interface CapacitorPlugin {String name();Permission[] permissions();}',
    'com/getcapacitor/PluginCall.java':`package com.getcapacitor;
public final class PluginCall {
 private final JSObject data;
 public boolean answered, resolved;
 public String reason,code;
 public Exception failure;
 public PluginCall(JSObject data){this.data=data;}
${exact(call, '    public JSObject getData()', '    @Nullable\n    public Integer getInt')
  .replaceAll('    @Nullable\n','').replace('@Nullable String defaultValue','String defaultValue')}
 public void resolve(){answer();resolved=true;}
 public void reject(String message){reject(message,null,null);}
 public void reject(String message,String code){reject(message,code,null);}
 public void reject(String message,String code,Exception failure){
  answer();reason=message;this.code=code;this.failure=failure;
 }
 private void answer(){if(answered)throw new AssertionError("Duplicate native reply");answered=true;}
}`,
  };
  return Object.entries(files).map(([name, body]) => {
    const file = join(temporary, 'driver', name);
    mkdirSync(dirname(file), {recursive:true});
    writeFileSync(file, body);
    return file;
  });
}
