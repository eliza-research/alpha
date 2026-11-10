import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {app,root} from './java.mjs';
import {mainActivityPlatform} from './main-activity-platform.mjs';

export const assistantAgent=app+'AlphaLocalAgentPlugin.java';
export const senseFixtures='vendor/eliza/plugins/plugin-native-system/test/sense-client-stubs.json';
export const systemModule='plugins/plugin-native-system/android';
export const assistantShared=['SenseInvocation','SenseListenerClient','AssistantEntryTile'].map(name=>
  systemModule+'/src/main/java/ai/eliza/plugins/system/'+name+'.java');

function exact(text, first, last) {
  const start=text.indexOf(first), end=text.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,`assistant source anchors ${first}, ${last}`);
  return text.slice(start,end);
}

export function assistantEntryPlatform() {
  const fixture=mainActivityPlatform();
  try {
    const files=fixture.sources;
    function put(path, text) {
      if(!Object.hasOwn(files,path))fixture.paths.push(join(fixture.directory,path));
      files[path]=text;
      const file=join(fixture.directory,path);
      mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);
    }
    function edit(path, from, to) {
      assert.equal(files[path].split(from).length,2,`fixture anchor ${from}`);
      put(path,files[path].replace(from,()=>to));
    }
    const sense=JSON.parse(readFileSync(join(root,senseFixtures),'utf8'));
    for(const name of ['android/app/KeyguardManager.java','android/os/SystemClock.java','android/os/Bundle.java',
      'android/net/Uri.java','android/content/pm/ApplicationInfo.java','android/content/pm/ActivityInfo.java'])
      put(name,sense[name]);
    put('android/content/ContentResolver.java',`package android.content;
public final class ContentResolver {
 public android.os.Bundle call(android.net.Uri uri,String name,String arg,android.os.Bundle extras){throw new AssertionError("Provider is outside assistant entry");}
}`);
    put('android/content/Context.java',`package android.content;
import android.app.KeyguardManager;
import android.content.pm.PackageManager;
public class Context {
 public static final Context APP=new Context();
 public static final PackageManager packages=new PackageManager();
 public static KeyguardManager keyguard=new KeyguardManager();
 public static boolean mic=true;
 public Context getApplicationContext(){return APP;}
 public String getPackageName(){return "fixture.alpha";}
 public PackageManager getPackageManager(){return packages;}
 public int checkSelfPermission(String permission){if(!permission.equals("record-audio"))throw new AssertionError(permission);return mic?0:-1;}
 public ContentResolver getContentResolver(){return new ContentResolver();}
 public <T>T getSystemService(Class<T> type){if(type!=KeyguardManager.class)throw new AssertionError(type);return type.cast(keyguard);}
 public String getString(int id){return "resource-"+id;}
}`);
    put('android/content/pm/PackageManager.java',`package android.content.pm;
import android.content.ComponentName;
public final class PackageManager {
 public static final int MATCH_DEFAULT_ONLY=1,SIGNATURE_MATCH=0,PERMISSION_GRANTED=0,GET_META_DATA=128;
 public boolean listener=true,system=true,protectedPower=true;
 public static final class NameNotFoundException extends Exception {}
 public ApplicationInfo getApplicationInfo(String name,int flags)throws NameNotFoundException{throw new AssertionError("Listener discovery outside fixture");}
 public int checkSignatures(String a,String b){
  if(a.equals("fixture.alpha")&&b.equals("fixture.alpha.sense"))return listener?0:-1;
  if(a.equals("android")&&b.equals("com.android.systemui"))return system?0:-1;
  return -1;
 }
 public ActivityInfo getActivityInfo(ComponentName name,int flags)throws NameNotFoundException{
  ActivityInfo info=new ActivityInfo();info.name=name.getClassName();info.packageName=name.getPackageName();info.applicationInfo=new ApplicationInfo();info.applicationInfo.enabled=true;info.exported=true;info.enabled=true;
  info.permission=protectedPower&&info.name.endsWith(".AlphaPowerVoiceActivity")?"android.permission.STATUS_BAR_SERVICE":null;
  return info;
 }
 public boolean resolves(String action){return ai.elizaresearch.alphaphone.MainActivityPorts.settings.contains(action);}
 public ResolveInfo resolveActivity(android.content.Intent intent,int flags){return null;}
}`);
    put('android/app/Activity.java',`package android.app;
import android.content.*;
public class Activity extends Context {
 public boolean focused;
 public boolean hasWindowFocus(){return focused;}
 public boolean isFinishing(){return false;}
 public boolean isDestroyed(){return false;}
 public ComponentName getComponentName(){return new ComponentName(getPackageName(),getClass().getName());}
 public Intent getIntent(){throw new AssertionError("Only a hosted Activity may expose its intent");}
}`);
    put('android/app/ComponentCaller.java','package android.app;public record ComponentCaller(String name) {public String getPackage(){return name;}}');
    put('android/Manifest.java','package android;public final class Manifest {public static final class permission {public static final String RECORD_AUDIO="record-audio";}}');
    put('android/annotation/TargetApi.java','package android.annotation;public @interface TargetApi {int value();}');
    put('android/annotation/SuppressLint.java','package android.annotation;public @interface SuppressLint {String[] value();}');
    put('androidx/annotation/RequiresApi.java','package androidx.annotation;public @interface RequiresApi {int value();}');
    put('android/graphics/drawable/Icon.java',`package android.graphics.drawable;
public record Icon(int id) {public static Icon createWithResource(android.content.Context context,int id){return new Icon(id);}}`);
    edit('android/os/Build.java','  public static class VERSION {',`  public static final class VERSION_CODES {public static final int N=24,Q=29,UPSIDE_DOWN_CAKE=34,VANILLA_ICE_CREAM=35;}
  public static class VERSION {`);
    const intent='android/content/Intent.java';
    edit(intent,'  private String action, type, packageName;',`  public static final int FLAG_ACTIVITY_CLEAR_TOP=0x04000000;
  public static final String ACTION_VIEW="android.intent.action.VIEW";
  public static final String ACTION_ASSIST="android.intent.action.ASSIST";
  public Class<?> target;
  public int flags;
  public ComponentName component;
  private String action, type, packageName;`);
    edit(intent,'    action = "explicit:" + target.getName();','    action = "explicit:" + target.getName(); this.target=target;');
    edit(intent,'    action = other.action;','    action = other.action; target=other.target; flags=other.flags; component=other.component;');
    edit(intent,'  public String getAction() {',`  public Intent setAction(String value){action=value;return this;}
  public Intent setComponent(ComponentName value){component=value;return this;}
  public java.util.Set<String> extraKeys(){return extras.keySet();}
  public String getAction() {`);
    edit(intent,'  public Intent addFlags(int flags) {\n    return this;', '  public Intent addFlags(int flags) {\n    this.flags|=flags;return this;');
    const activity='com/getcapacitor/BridgeActivity.java';
    edit(activity,'public class BridgeActivity {',`public class BridgeActivity extends android.app.Activity {
  public String launchedFrom;
  public boolean copyLoadIntent;
  public String getLaunchedFromPackage(){return launchedFrom;}
  public void onPause(){}
  public void onNewIntent(android.content.Intent intent,android.app.ComponentCaller caller){onNewIntent(intent);}`);
    edit(activity,'    onNewIntent(getIntent());',`    ai.elizaresearch.alphaphone.AssistantEntryTraces.beforeBridgeReentry(this);
    onNewIntent(copyLoadIntent ? new android.content.Intent(getIntent()) : getIntent());`);
    edit(activity,'  public void onNewIntent(android.content.Intent value) {}',`  public void onNewIntent(android.content.Intent value) {
    if(bridge!=null&&value!=null)bridge.intentDeliveries.add(value);
  }`);
    edit(activity,'  public void onWindowFocusChanged(boolean value) {}','  public void onWindowFocusChanged(boolean value) {focused=value;}');
    edit(activity,'    return new android.content.pm.PackageManager();','    return super.getPackageManager();');
    edit(activity,'    return "ai.elizaresearch.alphaphone";','    return super.getPackageName();');
    edit(activity,'    return kind.cast(new android.app.ActivityManager());','    return kind==android.app.ActivityManager.class?kind.cast(new android.app.ActivityManager()):super.getSystemService(kind);');
    edit('com/getcapacitor/Bridge.java','public class Bridge {',`public class Bridge {
  public final java.util.List<android.content.Intent> intentDeliveries=new java.util.ArrayList<>();
  public final java.util.List<String> windowEvents=new java.util.ArrayList<>();
  public void triggerWindowJSEvent(String event){windowEvents.add(event);}`);
    put('com/getcapacitor/Plugin.java',`package com.getcapacitor;
public class Plugin {
 private android.app.Activity activity;
 public void attach(android.app.Activity owner){activity=owner;}
 public android.app.Activity getActivity(){return activity;}
 public android.content.Context getContext(){return activity.getApplicationContext();}
}`);
    put('com/getcapacitor/PluginCall.java',`package com.getcapacitor;
public final class PluginCall {
 public JSObject result;
 public void resolve(JSObject value){if(result!=null)throw new AssertionError("Duplicate result");result=value;}
}`);
    put('com/getcapacitor/PluginMethod.java','package com.getcapacitor;public @interface PluginMethod {}');
    put('com/getcapacitor/JSObject.java',`package com.getcapacitor;
public final class JSObject extends org.json.JSONObject {
 @Override public JSObject put(String key,boolean value){super.put(key,value);return this;}
 @Override public JSObject put(String key,Object value){super.put(key,value);return this;}
}`);
    const agent=readFileSync(join(root,assistantAgent),'utf8');
    put('ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java',`package ai.elizaresearch.alphaphone;
import android.content.Context;
import com.getcapacitor.*;
import org.json.JSONObject;
public final class AlphaLocalAgentPlugin extends Plugin {
 static final Object lifecycleLock=new Object();
 static long powerAuthorizationMutationEpoch,credentialMutationEpoch=-1,credentialShutdownRequest=-1;
 static boolean stopping;
${exact(agent,' static final class PowerLaunchPin', ' private final java.util.Set<String> cancelledStarts')}
${exact(agent,' @PluginMethod public void launchSurface(', ' /** Read-only: may this surface')}
}
final class AlphaCredentialStore {
 AlphaCredentialStore(Context context){}
 static String account="account-a",generation="generation-a";
 static boolean available=true,production=true;
 JSONObject providerAdmissionSnapshot()throws Exception{
  if(!available)throw new java.io.IOException("Synthetic vault refusal");
  return new JSONObject().put("provider","elizacloud").put("environment",production?"production":"other").put("accountRef",account).put("sessionGeneration",generation);
 }
}`);
    put('ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java',`package ai.eliza.plugins.securestore.nativeonly;
public final class JsonCredentialSlots {public static final Object LOCK=new Object();}`);
    const res='ai/elizaresearch/alphaphone/R.java';
    put(res,`package ai.elizaresearch.alphaphone;
public final class R {
 public static final class string {
  public static final int alpha_quick_settings_label=201,alpha_quick_settings_locked=202,
    alpha_quick_settings_open=203,alpha_quick_settings_description=204;
 }
 public static final class drawable {public static final int notification_icon=205;}
}`);
    put('android/app/PendingIntent.java',`package android.app;
import android.content.*;
public record PendingIntent(Intent intent,int code,int flags) {
 public static final int FLAG_UPDATE_CURRENT=0x08000000,FLAG_IMMUTABLE=0x04000000;
 public static PendingIntent getActivity(Context context,int code,Intent intent,int flags){return new PendingIntent(new Intent(intent),code,flags);}
}`);
    put('android/service/quicksettings/Tile.java',`package android.service.quicksettings;
public final class Tile {
 public static final int STATE_INACTIVE=1;
 public int state,updates;
 public android.graphics.drawable.Icon icon;
 public CharSequence label,subtitle,description;
 public void setIcon(android.graphics.drawable.Icon value){icon=value;}
 public void setLabel(CharSequence value){label=value;}
 public void setSubtitle(CharSequence value){subtitle=value;}
 public void setContentDescription(CharSequence value){description=value;}
 public void setState(int value){state=value;}
 public void updateTile(){updates++;}
}`);
    put('android/service/quicksettings/TileService.java',`package android.service.quicksettings;
import android.app.PendingIntent;
import android.content.*;
public class TileService extends Context {
 public Tile tile=new Tile();
 public boolean locked;
 public Runnable unlock;
 public Intent entry;
 public PendingIntent pendingEntry;
 public int launches;
 public Tile getQsTile(){return tile;}
 public boolean isLocked(){return locked;}
 public void onStartListening(){}
 public void onClick(){}
 public void unlockAndRun(Runnable callback){unlock=callback;}
 public void startActivityAndCollapse(Intent intent){entry=intent;pendingEntry=null;launches++;}
 public void startActivityAndCollapse(PendingIntent pending){entry=pending.intent();pendingEntry=pending;launches++;}
}`);
    return fixture;
  } catch(error) {
    fixture.close();
    throw error;
  }
}
