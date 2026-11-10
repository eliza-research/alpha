import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {app,root} from './java.mjs';

export const settingsDeviceSource=app+'AlphaDevicePlugin.java';
export const settingsCallSource='node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java';
export const settingsPagesPath='plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/SystemSettingsPages.java';

function exact(text, first, last) {
  const start=text.indexOf(first), end=text.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,`settings handoff source anchors ${first}, ${last}`);
  return text.slice(start,end);
}

export function settingsHandoffPlatform(temporary) {
  const device=readFileSync(join(root,settingsDeviceSource),'utf8');
  const calls=readFileSync(join(root,settingsCallSource),'utf8');
  const constants=[
    'ACTION_SETTINGS','ACTION_SYNC_SETTINGS','ACTION_WIFI_SETTINGS','ACTION_BLUETOOTH_SETTINGS','ACTION_DATA_ROAMING_SETTINGS',
    'ACTION_WIRELESS_SETTINGS','ACTION_AIRPLANE_MODE_SETTINGS','ACTION_LOCATION_SOURCE_SETTINGS','ACTION_DISPLAY_SETTINGS',
    'ACTION_SOUND_SETTINGS','ACTION_BATTERY_SAVER_SETTINGS','ACTION_DEVICE_INFO_SETTINGS','ACTION_APPLICATION_DEVELOPMENT_SETTINGS',
    'ACTION_APP_NOTIFICATION_SETTINGS','ACTION_APPLICATION_DETAILS_SETTINGS','ACTION_MANAGE_DEFAULT_APPS_SETTINGS',
    'ACTION_ZEN_MODE_PRIORITY_SETTINGS','ACTION_REQUEST_SET_AUTOFILL_SERVICE','EXTRA_APP_PACKAGE',
  ];
  const files={
    'ai/elizaresearch/alphaphone/AlphaDevicePlugin.java':`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.system.SystemSettingsPages;
import android.content.Intent;
import android.provider.Settings;
import com.getcapacitor.*;
public final class AlphaDevicePlugin extends Plugin {
${exact(device,' private static Intent handOff(', ' /**\n  * Asks Android')}
${exact(device,' @PluginMethod public void openSettings(', ' private final java.util.concurrent.ExecutorService diagnosticsWorker')}
}`,
    'ai/elizaresearch/alphaphone/BuildConfig.java':'package ai.elizaresearch.alphaphone;public final class BuildConfig {public static boolean IS_LAUNCHER;}',
    'android/provider/Settings.java':`package android.provider;
public final class Settings {
${constants.map(name=>` public static final String ${name}="${name}";`).join('\n')}
}`,
    'android/net/Uri.java':`package android.net;
public record Uri(String value) {
 public static Uri parse(String value){return new Uri(value);}
 @Override public String toString(){return value;}
}`,
    'android/content/Intent.java':`package android.content;
import android.net.Uri;
public final class Intent {
 public static final int FLAG_ACTIVITY_NEW_TASK=0x10000000;
 public static final String ACTION_VIEW="ACTION_VIEW";
 public final String action;
 public Uri data;
 public int flags;
 public final java.util.Map<String,String> extras=new java.util.LinkedHashMap<>();
 public Intent(String action){this(action,null);}
 public Intent(String action,Uri data){this.action=action;this.data=data;}
 public String getAction(){return action;}
 public Intent setData(Uri value){data=value;return this;}
 public Intent putExtra(String key,String value){extras.put(key,value);return this;}
 public Intent addFlags(int value){flags|=value;return this;}
}`,
    'android/content/ComponentName.java':`package android.content;
public final class ComponentName {public String getPackageName(){throw new AssertionError("Selection status outside Settings fixture");}}`,
    'android/content/ActivityNotFoundException.java':'package android.content;public final class ActivityNotFoundException extends RuntimeException {}',
    'android/content/Context.java':`package android.content;
import android.content.pm.PackageManager;
import android.view.autofill.AutofillManager;
public class Context {
 public final PackageManager packages=new PackageManager();
 public final AutofillManager autofill=new AutofillManager();
 public boolean autofillPresent=true;
 public String getPackageName(){return "fixture.alpha";}
 public PackageManager getPackageManager(){return packages;}
 public <T> T getSystemService(Class<T> type){
  if(type!=AutofillManager.class)throw new AssertionError("Unexpected service lookup");
  return autofillPresent?type.cast(autofill):null;
 }
}`,
    'android/content/pm/ApplicationInfo.java':'package android.content.pm;public final class ApplicationInfo {public boolean enabled;}',
    'android/content/pm/PackageManager.java':`package android.content.pm;
import android.content.Intent;
public final class PackageManager {
 public static final int CERT_INPUT_SHA256=1;
 public boolean trusted=true,refuse;
 public static final class NameNotFoundException extends Exception {}
 public ApplicationInfo getApplicationInfo(String name,int flags)throws NameNotFoundException{throw new AssertionError("Only certificate admission in this fixture");}
 public Intent getLaunchIntentForPackage(String name){throw new AssertionError("Provider app launch outside fixture");}
 public boolean hasSigningCertificate(String name,byte[] certificate,int input){
  if(!name.equals("proton.android.pass")||input!=CERT_INPUT_SHA256||
   !java.util.HexFormat.of().formatHex(certificate).equals("dcc9439ec1a6c6a8d0203f3423ee42bcc8b970628e53cb73a0393f398dd5b853"))
   throw new AssertionError("Exact provider publisher admission");
  if(refuse)throw new SecurityException("Synthetic package lookup refusal");
  return trusted;
 }
}`,
    'android/view/autofill/AutofillManager.java':`package android.view.autofill;
public final class AutofillManager {
 public boolean supported=true;
 public boolean isAutofillSupported(){return supported;}
 public android.content.ComponentName getAutofillServiceComponentName(){throw new AssertionError("Provider selection outside fixture");}
}`,
    'android/app/Activity.java':`package android.app;
import android.content.*;
public final class Activity extends Context {
 public record Attempt(Intent intent,String result,String phase){}
 public final java.util.Deque<Runnable> ui=new java.util.ArrayDeque<>();
 public final java.util.List<Attempt> attempts=new java.util.ArrayList<>();
 public String phase="live";
 public String first="ok",second="ok";
 public void runOnUiThread(Runnable task){ui.addLast(task);}
 public void startActivity(Intent intent){
  String result=attempts.isEmpty()?first:second;
  attempts.add(new Attempt(intent,result,phase));
  switch(result){
   case "ok" -> {}
   case "missing" -> throw new ActivityNotFoundException();
   case "security" -> throw new SecurityException("Synthetic dispatch refusal");
   default -> throw new AssertionError(result);
  }
 }
}`,
    'com/getcapacitor/Plugin.java':`package com.getcapacitor;
import android.app.Activity;
import android.content.Context;
public class Plugin {
 private Context context;
 private Activity activity;
 public void attach(Context context,Activity activity){this.context=context;this.activity=activity;}
 public Context getContext(){return context;}
 public Activity getActivity(){return activity;}
}`,
    'com/getcapacitor/JSObject.java':'package com.getcapacitor;public final class JSObject extends org.json.JSONObject {}',
    'com/getcapacitor/PluginMethod.java':'package com.getcapacitor;public @interface PluginMethod {}',
    'com/getcapacitor/PluginCall.java':`package com.getcapacitor;
public final class PluginCall {
 private final JSObject data;
 public boolean answered;
 public String error;
 public JSObject result;
 public PluginCall(JSObject data){this.data=data;}
${exact(calls,'    public String getString(String name)', '    @Nullable\n    public Integer getInt')
  .replaceAll('    @Nullable\n','').replace('@Nullable String defaultValue','String defaultValue')}
 public void resolve(JSObject value){answer();result=value;}
 public void reject(String reason){answer();error=reason;}
 private void answer(){if(answered)throw new AssertionError("Duplicate plugin response");answered=true;}
}`,
  };
  return Object.entries(files).map(([name,body])=>{
    const file=join(temporary,'driver',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);return file;
  });
}
