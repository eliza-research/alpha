// The shared-Sense Power shell: actual activity methods on the host JVM with modeled host and Sense
// dependencies, the shipped manifest entry and an Android 36 API compile. No device, permission
// grant, microphone or provider use; none of this proves the APK, permission enforcement or Binder.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {javaBinary,jvmSkip,jvmTimeout,nativeSource,root} from './fixtures/jvm-tools.mjs';

// On CI the SDK must come from the environment; locally the default SDK location also counts.
const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME||(process.env.CI?'':join(homedir(),process.platform==='darwin'?'Library/Android/sdk':'Android/Sdk'));
const androidJar=sdk?join(sdk,'platforms/android-36/android.jar'):'';
const noAndroidJar=process.env.CI||(androidJar&&existsSync(androidJar))?false:'Android 36 android.jar not found: set ANDROID_HOME or ANDROID_SDK_ROOT';

function workspace(prefix){
 const dir=mkdtempSync(join(tmpdir(),prefix));
 const put=(name,text)=>{const file=join(dir,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
 const sources=()=>readdirSync(dir,{recursive:true}).filter(name=>name.endsWith('.java')).map(name=>join(dir,name));
 return {dir,put,sources};
}
const javac=args=>spawnSync(javaBinary('javac'),['--release','17',...args],{encoding:'utf8',timeout:jvmTimeout});

test('the Power child ships disabled and platform-protected, with image-selectable launcher exports',()=>{
 const manifest=readFileSync(join(root,'android/app/src/main/AndroidManifest.xml'),'utf8');
 const power=manifest.match(/<activity android:name="\.AlphaPowerVoiceActivity"[^>]*>/)?.[0];
 assert.ok(power,'AlphaPowerVoiceActivity entry');
 // Self-closing: no intent-filter or other child can route a launch to it.
 assert.match(power,/\/>$/);
 for(const attribute of ['android:enabled="false"','android:exported="false"','android:permission="android.permission.STATUS_BAR_SERVICE"','android:launchMode="singleTask"'])assert.ok(power.includes(attribute),attribute);
 const ordinary=manifest.match(/<activity android:name="\.AlphaAssistActivity"[\s\S]*?<\/activity>/)?.[0];
 assert.ok(ordinary,'AlphaAssistActivity entry');
 assert.doesNotMatch(ordinary,/android:permission=/);
 assert.match(ordinary,/<intent-filter><action android:name="android.intent.action.ASSIST"\/>/);
 const launcher=readFileSync(join(root,'android/app/src/launcher/AndroidManifest.xml'),'utf8');
 for(const name of ['AlphaAssistActivity','AlphaPowerVoiceActivity']){
  const entry=launcher.match(new RegExp(`<activity android:name="\\.${name}"[^>]*>`))?.[0];
  assert.match(entry,/android:enabled="false" android:exported="true"/);
  assert.match(entry,/tools:replace="android:exported,android:screenOrientation"/);
 }
 assert.match(launcher,/<package android:name="com\.android\.systemui"\s*\/>/);
});

test('actual Sense admission requires the qualified companion and Android caller on cold and warm entry',{skip:jvmSkip('javac')},()=>{
 const {dir,put,sources}=workspace('alpha-power-sense-jvm-');
 try{
  put('android/os/Bundle.java','package android.os; public class Bundle {}');
  put('android/os/Build.java','package android.os; public class Build {public static class VERSION {public static int SDK_INT=36;}public static class VERSION_CODES {public static final int UPSIDE_DOWN_CAKE=34,VANILLA_ICE_CREAM=35;}}');
  put('android/content/Intent.java','package android.content; public class Intent {public static final String ACTION_ASSIST="android.intent.action.ASSIST";public Class<?> target;public String action;public int extras;public Intent(Object c,Class<?> t){target=t;}public Intent setAction(String a){action=a;return this;}public Intent putExtra(String k,boolean v){extras++;return this;}}');
  put('android/content/Context.java',`package android.content;
import android.content.pm.PackageManager;
public class Context {
 public final PackageManager packages=new PackageManager(); public boolean image,control=true;
 public PackageManager getPackageManager(){return packages;}
 public int checkSelfPermission(String permission){return control&&permission.equals("ai.alphacompute.alphaphone.sense.permission.LISTENER_CONTROL")?0:-1;}
}`);
  put('android/content/pm/ApplicationInfo.java','package android.content.pm;public class ApplicationInfo {public static final int FLAG_SYSTEM=1;public int flags,uid;public boolean enabled=true;public String packageName,sourceDir;}');
  put('android/content/pm/Signature.java','package android.content.pm;public record Signature(String certificate) {}');
  put('android/content/pm/SigningInfo.java','package android.content.pm;public class SigningInfo {public Signature[] signers;public Signature[] getApkContentsSigners(){return signers;}}');
  put('android/content/pm/PackageInfo.java','package android.content.pm;public class PackageInfo {public SigningInfo signingInfo=new SigningInfo();}');
  put('android/content/pm/PackageManager.java',`package android.content.pm;
import java.util.HashMap;import java.util.Map;
public class PackageManager {
 public static final int GET_SIGNING_CERTIFICATES=1,PERMISSION_GRANTED=0;
 public static class NameNotFoundException extends Exception {}
 public boolean feature,hotword=true;public final Map<String,ApplicationInfo> apps=new HashMap<>();public final Map<String,PackageInfo> info=new HashMap<>();
 public void install(String name,int uid,String source,String signer){ApplicationInfo app=new ApplicationInfo();app.packageName=name;app.flags=ApplicationInfo.FLAG_SYSTEM;app.uid=uid;app.sourceDir=source;apps.put(name,app);PackageInfo p=new PackageInfo();p.signingInfo.signers=new Signature[]{new Signature(signer)};info.put(name,p);}
 public ApplicationInfo getApplicationInfo(String name,int flags)throws NameNotFoundException{ApplicationInfo app=apps.get(name);if(app==null)throw new NameNotFoundException();return app;}
 public PackageInfo getPackageInfo(String name,int flags)throws NameNotFoundException{PackageInfo p=info.get(name);if(p==null)throw new NameNotFoundException();return p;}
 public boolean hasSystemFeature(String name){return feature&&name.equals("ai.alphacompute.alphaphone.feature.SENSE");}
 public int checkPermission(String permission,String name){return hotword&&permission.equals("android.permission.CAPTURE_AUDIO_HOTWORD")&&name.equals("ai.alphacompute.alphaphone.sense")?0:-1;}
}`);
  put('android/app/ComponentCaller.java','package android.app;public record ComponentCaller(String name,int uid) {public String getPackage(){return name;}public int getUid(){return uid;}}');
  put('androidx/annotation/RequiresApi.java','package androidx.annotation;public @interface RequiresApi {int value();}');
  put('ai/eliza/plugins/system/SenseListenerClient.java',`package ai.eliza.plugins.system;
public class SenseListenerClient {
 public static int ordinary,powerAttempts,powerAccepted;public static String caller,origin;public static boolean bound,ownsActivity=true;
 public SenseListenerClient(Object context){}
 public static int coldBegins,cancels,focusChanges;public boolean beginProtectedPowerLaunch(Object pin){coldBegins++;return true;}public void protectedPowerWindowFocusChanged(boolean focus){focusChanges++;}public void cancelProtectedPowerLaunch(){cancels++;}
 public static void reset(){ordinary=powerAttempts=powerAccepted=0;caller=origin=null;bound=false;ownsActivity=true;}
 public void recordInvocation(String from){ordinary++;caller=from;origin="assist";}
 public boolean recordProtectedPower(){powerAttempts++;if(!ownsActivity)return false;if(!bound){origin=null;return false;}origin="power";powerAccepted++;return true;}
}`);
  put('ai/alphacompute/alphaphone/AlphaLocalAgentPlugin.java','package ai.alphacompute.alphaphone;class AlphaLocalAgentPlugin {static class PowerLaunchPin {}static PowerLaunchPin pin;static PowerLaunchPin capturePowerLaunchPin(Object context){return pin;}}');
  put('ai/alphacompute/alphaphone/BuildConfig.java','package ai.alphacompute.alphaphone;class BuildConfig {static final String APPLICATION_ID="ai.alphacompute.alphaphone";}');
  put('ai/alphacompute/alphaphone/AlphaImageCapabilities.java','package ai.alphacompute.alphaphone;class AlphaImageCapabilities {static boolean aospImage(android.content.Context context){return context.image;}}');
  put('ai/alphacompute/alphaphone/MainActivity.java',`package ai.alphacompute.alphaphone;
import android.os.Bundle;import android.content.Intent;import android.app.ComponentCaller;
public class MainActivity extends android.content.Context {
 public static class Bridge {public int events;public void triggerWindowJSEvent(String name){events++;}}
 public Bridge bridge;public Intent intent;public int superNew,callerUid=-1;public String caller="foreign.package";
 protected boolean isAssistantSurface(){return false;}public Bridge getBridge(){return bridge;}
 public void onWindowFocusChanged(boolean f){}public void onPause(){}public void onDestroy(){}
 public void onCreate(Bundle b){}public void onNewIntent(Intent i){superNew++;}public void onNewIntent(Intent i,ComponentCaller c){onNewIntent(i);}
 protected void load(){onNewIntent(getIntent());}
 public void setIntent(Intent i){intent=i;}public Intent getIntent(){return intent;}public String getLaunchedFromPackage(){return caller;}public int getLaunchedFromUid(){return callerUid;}
}`);
  for(const name of ['AlphaAssistActivity.java','AlphaPowerVoiceActivity.java','AlphaSenseAdmission.java'])put('ai/alphacompute/alphaphone/'+name,readFileSync(nativeSource(name),'utf8'));
  put('ai/alphacompute/alphaphone/PowerEntryTest.java',`package ai.alphacompute.alphaphone;
import ai.eliza.plugins.system.SenseListenerClient;import android.content.Context;import android.content.Intent;import android.content.pm.Signature;import android.app.ComponentCaller;import android.os.Bundle;
public final class PowerEntryTest {
 static final String HOST="ai.alphacompute.alphaphone", SENSE=HOST+".sense", SYSTEM_UI="com.android.systemui";
 static final String SENSE_APK="/system_ext/priv-app/AlphaSense/AlphaSense.apk";
 static final int SENSE_UID=12001, SYSTEM_UI_UID=1000;
 static final ComponentCaller POWER=new ComponentCaller(SYSTEM_UI,SYSTEM_UI_UID), LISTENER=new ComponentCaller(SENSE,SENSE_UID);
 static void check(boolean b){if(!b)throw new AssertionError();}
 static void qualify(Context context){
  context.image=context.packages.feature=true;
  context.packages.install(HOST,12000,"launcher.apk","alpha");
  context.packages.install(SENSE,SENSE_UID,SENSE_APK,"alpha");
  context.packages.install(SYSTEM_UI,SYSTEM_UI_UID,"systemui.apk","platform");
  context.packages.install("android",1000,"framework.apk","platform");
 }
 static void checkImageAndCaller(Context context){
  check(AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));
  check(AlphaSenseAdmission.protectedPowerCaller(context,SYSTEM_UI,SYSTEM_UI_UID));
  check(!AlphaSenseAdmission.listenerCaller(context,SENSE,9999));
  check(!AlphaSenseAdmission.protectedPowerCaller(context,SYSTEM_UI,9999));
  context.image=false;
  check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));
  check(!AlphaSenseAdmission.protectedPowerCaller(context,SYSTEM_UI,SYSTEM_UI_UID));
  context.image=true;context.packages.feature=false;
  check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));
  check(!AlphaSenseAdmission.protectedPowerCaller(context,SYSTEM_UI,SYSTEM_UI_UID));
  context.packages.feature=true;
  var companion=context.packages.apps.remove(SENSE);
  check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));
  check(!AlphaSenseAdmission.protectedPowerCaller(context,SYSTEM_UI,SYSTEM_UI_UID));
  context.packages.apps.put(SENSE,companion);
  companion.enabled=false;check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));companion.enabled=true;
  companion.flags=0;check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));companion.flags=1;
  companion.sourceDir="/data/app/AlphaSense.apk";check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));companion.sourceDir=SENSE_APK;
  var signer=context.packages.info.get(SENSE).signingInfo;
  signer.signers=new Signature[]{new Signature("old")};check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));
  signer.signers=new Signature[]{new Signature("alpha"),new Signature("other")};check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));
  signer.signers=new Signature[]{new Signature("alpha")};
  context.packages.hotword=false;check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));context.packages.hotword=true;
  context.control=false;check(!AlphaSenseAdmission.listenerCaller(context,SENSE,SENSE_UID));context.control=true;
  var systemSigner=context.packages.info.get(SYSTEM_UI).signingInfo;
  systemSigner.signers=new Signature[]{new Signature("untrusted")};check(!AlphaSenseAdmission.protectedPowerCaller(context,SYSTEM_UI,SYSTEM_UI_UID));
  systemSigner.signers=new Signature[]{new Signature("platform")};
 }
 public static void main(String[]args){
  SenseListenerClient.reset();AlphaPowerVoiceActivity power=new AlphaPowerVoiceActivity();qualify(power);checkImageAndCaller(power);
  AlphaLocalAgentPlugin.pin=new AlphaLocalAgentPlugin.PowerLaunchPin();
  SenseListenerClient.bound=true;power.onCreate(null);
  check(SenseListenerClient.coldBegins==0&&SenseListenerClient.caller==null);
  check(power.intent.target==AlphaPowerVoiceActivity.class&&power.intent.extras==1);
  power.bridge=new MainActivity.Bridge();
  Intent fresh=new Intent(power,AlphaPowerVoiceActivity.class);
  power.onNewIntent(fresh);power.onNewIntent(fresh,new ComponentCaller(SYSTEM_UI,9999));
  check(SenseListenerClient.powerAttempts==0);
  power.onNewIntent(fresh,POWER);
  check(SenseListenerClient.powerAttempts==1&&SenseListenerClient.powerAccepted==1&&power.bridge.events==3&&power.superNew==3);
  power.load();power.onNewIntent(fresh);
  check(SenseListenerClient.powerAttempts==1&&SenseListenerClient.origin.equals("power"));
  SenseListenerClient.bound=false;power.onNewIntent(fresh,POWER);
  check(SenseListenerClient.powerAccepted==1&&SenseListenerClient.origin==null);
  SenseListenerClient.bound=true;SenseListenerClient.ownsActivity=false;SenseListenerClient.origin="listener";
  int ordinaryBefore=SenseListenerClient.ordinary;power.onNewIntent(fresh,POWER);
  check(SenseListenerClient.origin.equals("listener")&&SenseListenerClient.ordinary==ordinaryBefore);
  SenseListenerClient.ownsActivity=true;

  AlphaAssistActivity ordinary=new AlphaAssistActivity();qualify(ordinary);ordinary.bridge=new MainActivity.Bridge();
  ordinary.caller=SYSTEM_UI;ordinary.callerUid=SYSTEM_UI_UID;ordinary.onCreate(null);check(SenseListenerClient.caller==null);
  Intent admitted=ordinary.getIntent();int recorded=SenseListenerClient.ordinary;ordinary.load();
  check(ordinary.getIntent()==admitted&&SenseListenerClient.ordinary==recorded);
  Intent generic=new Intent(ordinary,AlphaAssistActivity.class);
  ordinary.onNewIntent(generic,POWER);check(SenseListenerClient.caller==null);
  ordinary.onNewIntent(generic,new ComponentCaller(SENSE,9999));check(SenseListenerClient.caller==null);
  ordinary.onNewIntent(generic,LISTENER);check(SenseListenerClient.caller.equals(SENSE));
  ordinary.onNewIntent(generic);check(SenseListenerClient.caller==null);
  ordinary.caller=SENSE;ordinary.callerUid=SENSE_UID;ordinary.onCreate(null);check(SenseListenerClient.caller.equals(SENSE));
  ordinary.onCreate(new Bundle());check(SenseListenerClient.caller==null);
  check(ordinary.intent.target==AlphaAssistActivity.class&&ordinary.intent.extras==1&&ordinary.takeInvocation().equals("assist"));

  AlphaPowerVoiceActivity cold=new AlphaPowerVoiceActivity();qualify(cold);cold.caller=SYSTEM_UI;cold.callerUid=SYSTEM_UI_UID;
  cold.onCreate(new Bundle());check(SenseListenerClient.coldBegins==0);
  android.os.Build.VERSION.SDK_INT=33;cold.onCreate(null);check(SenseListenerClient.coldBegins==0);android.os.Build.VERSION.SDK_INT=36;
  cold.image=false;cold.onCreate(null);check(SenseListenerClient.coldBegins==0);cold.image=true;
  cold.onCreate(null);check(SenseListenerClient.coldBegins==1);
  cold.onWindowFocusChanged(true);cold.onWindowFocusChanged(false);check(SenseListenerClient.focusChanges==2);
  cold.onPause();cold.onDestroy();check(SenseListenerClient.cancels==2);
  System.out.println("PASS actual Power shell and companion admission");
 }
}`);
  const compiled=javac(['-d',dir,...sources()]);
  assert.equal(compiled.status,0,compiled.stderr);
  assert.match(execFileSync(javaBinary('java'),['-cp',dir,'ai.alphacompute.alphaphone.PowerEntryTest'],{encoding:'utf8',timeout:jvmTimeout}),/PASS actual Power shell/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

// Off CI a missing SDK skips only this compile; on CI it fails.
test('the Power and Assist activities compile against Android 36',{skip:jvmSkip('javac')||noAndroidJar},()=>{
 assert.ok(androidJar&&existsSync(androidJar),'Android 36 android.jar is required on CI: set ANDROID_HOME or ANDROID_SDK_ROOT');
 const {dir,put,sources}=workspace('alpha-power-sense-api36-');
 try{
  put('androidx/annotation/RequiresApi.java','package androidx.annotation;public @interface RequiresApi {int value();}');
  put('ai/eliza/plugins/system/SenseListenerClient.java','package ai.eliza.plugins.system;public class SenseListenerClient {public SenseListenerClient(android.content.Context c){}public void recordInvocation(String c){}public boolean recordProtectedPower(){return false;}public boolean beginProtectedPowerLaunch(Object pin){return false;}public void protectedPowerWindowFocusChanged(boolean f){}public void cancelProtectedPowerLaunch(){}}');
  put('ai/alphacompute/alphaphone/AlphaLocalAgentPlugin.java','package ai.alphacompute.alphaphone;class AlphaLocalAgentPlugin {static class PowerLaunchPin {}static PowerLaunchPin capturePowerLaunchPin(Object context){return null;}}');
  put('ai/alphacompute/alphaphone/BuildConfig.java','package ai.alphacompute.alphaphone;class BuildConfig {static final String APPLICATION_ID="ai.alphacompute.alphaphone";}');
  put('ai/alphacompute/alphaphone/AlphaImageCapabilities.java','package ai.alphacompute.alphaphone;class AlphaImageCapabilities {static boolean aospImage(android.content.Context context){return false;}}');
  put('ai/alphacompute/alphaphone/MainActivity.java','package ai.alphacompute.alphaphone;public class MainActivity extends android.app.Activity {protected boolean isAssistantSurface(){return false;}protected void load(){}public static class Bridge {public void triggerWindowJSEvent(String n){}}public Bridge getBridge(){return null;}@Override public void onCreate(android.os.Bundle b){super.onCreate(b);}@Override public void onNewIntent(android.content.Intent i){super.onNewIntent(i);}}');
  const compiled=javac(['-cp',androidJar,'-d',join(dir,'out'),...sources(),...['AlphaAssistActivity.java','AlphaPowerVoiceActivity.java','AlphaSenseAdmission.java'].map(nativeSource)]);
  assert.equal(compiled.status,0,compiled.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
