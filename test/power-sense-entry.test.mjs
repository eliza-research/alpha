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

test('the Power child ships disabled, unexported, platform-protected and without an intent filter',()=>{
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
});

test('actual activity: warm same instance offers Power once; cold, restored and ordinary entry fail closed',{skip:jvmSkip('javac')},()=>{
 const {dir,put,sources}=workspace('alpha-power-sense-jvm-');
 try{
  put('android/os/Bundle.java','package android.os; public class Bundle {}');
  put('android/os/Build.java','package android.os; public class Build {public static class VERSION {public static int SDK_INT=36;}public static class VERSION_CODES {public static final int UPSIDE_DOWN_CAKE=34,VANILLA_ICE_CREAM=35;}}');
  put('android/content/Intent.java','package android.content; public class Intent {public static final String ACTION_ASSIST="android.intent.action.ASSIST";public Class<?> target;public String action;public int extras;public Intent(Object c,Class<?> t){target=t;}public Intent setAction(String a){action=a;return this;}public Intent putExtra(String k,boolean v){extras++;return this;}}');
  put('android/app/ComponentCaller.java','package android.app;public class ComponentCaller {private final String name;public ComponentCaller(String n){name=n;}public String getPackage(){return name;}}');
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
  put('ai/alphacompute/alphaphone/MainActivity.java',`package ai.alphacompute.alphaphone;
import android.os.Bundle;import android.content.Intent;import android.app.ComponentCaller;
public class MainActivity {
 public static class Bridge {public int events;public void triggerWindowJSEvent(String name){events++;}}
 public Bridge bridge;public Intent intent;public int superNew;public String caller="foreign.package";
 protected boolean isAssistantSurface(){return false;}public Bridge getBridge(){return bridge;}
 public void onWindowFocusChanged(boolean f){}public void onPause(){}public void onDestroy(){}
 public void onCreate(Bundle b){}public void onNewIntent(Intent i){superNew++;}public void onNewIntent(Intent i,ComponentCaller c){onNewIntent(i);}
 protected void load(){onNewIntent(getIntent());}
 public void setIntent(Intent i){intent=i;}public Intent getIntent(){return intent;}public String getLaunchedFromPackage(){return caller;}
}`);
  for(const name of ['AlphaAssistActivity.java','AlphaPowerVoiceActivity.java'])put('ai/alphacompute/alphaphone/'+name,readFileSync(nativeSource(name),'utf8'));
  put('ai/alphacompute/alphaphone/PowerEntryTest.java',`package ai.alphacompute.alphaphone;
import ai.eliza.plugins.system.SenseListenerClient;import android.content.Intent;import android.app.ComponentCaller;import android.os.Bundle;
public final class PowerEntryTest {
 static void check(boolean b){if(!b)throw new AssertionError();}
 public static void main(String[]args){SenseListenerClient.reset();AlphaPowerVoiceActivity p=new AlphaPowerVoiceActivity();
  // Even an unrelated activity's established package lease cannot turn cold creation into Power.
  SenseListenerClient.bound=true;p.onCreate(null);check(SenseListenerClient.powerAttempts==0);check(SenseListenerClient.caller==null);check(p.intent.target==AlphaPowerVoiceActivity.class&&p.intent.extras==1);
  p.bridge=new MainActivity.Bridge();p.onNewIntent(new Intent(p,AlphaPowerVoiceActivity.class));check(SenseListenerClient.powerAttempts==1&&SenseListenerClient.powerAccepted==1);check(p.bridge.events==1&&p.superNew==1);check(p.intent.target==AlphaPowerVoiceActivity.class&&p.intent.extras==1);
  // API35's two-argument callback delegates once through the actual override, not twice.
  p.onNewIntent(new Intent(p,AlphaPowerVoiceActivity.class),new ComponentCaller("foreign.package"));check(SenseListenerClient.powerAttempts==2&&p.bridge.events==2&&p.superNew==2);
  // Capacitor's load bounce forwards the sanitized intent, never a second Power offer.
  int beforeLoad=SenseListenerClient.powerAttempts;p.load();check(SenseListenerClient.powerAttempts==beforeLoad&&SenseListenerClient.origin.equals("power"));check(p.bridge.events==3&&p.superNew==3);
  // Session/owner reset makes the shared offer fail; no queued Power survives for a later bind.
  SenseListenerClient.bound=false;p.onNewIntent(new Intent(p,AlphaPowerVoiceActivity.class));check(SenseListenerClient.powerAccepted==2&&SenseListenerClient.origin==null);
  // Another Activity owns a newer valid listener lease. Stale child rejection has no foreign effect.
  SenseListenerClient.bound=true;SenseListenerClient.ownsActivity=false;SenseListenerClient.origin="listener";int ordinaryBefore=SenseListenerClient.ordinary;p.onNewIntent(new Intent(p,AlphaPowerVoiceActivity.class));check(SenseListenerClient.origin.equals("listener")&&SenseListenerClient.ordinary==ordinaryBefore);SenseListenerClient.ownsActivity=true;
  AlphaPowerVoiceActivity restored=new AlphaPowerVoiceActivity();SenseListenerClient.bound=true;int offered=SenseListenerClient.powerAttempts;restored.onCreate(new Bundle());check(SenseListenerClient.powerAttempts==offered&&SenseListenerClient.origin.equals("assist"));
  restored.onNewIntent(new Intent(restored,AlphaPowerVoiceActivity.class));check(SenseListenerClient.powerAttempts==offered); // no bridge
  AlphaAssistActivity ordinary=new AlphaAssistActivity();ordinary.bridge=new MainActivity.Bridge();ordinary.onCreate(null);
  Intent admitted=ordinary.getIntent();int recorded=SenseListenerClient.ordinary;ordinary.load();
  check(ordinary.getIntent()==admitted&&SenseListenerClient.ordinary==recorded);
  ordinary.onNewIntent(new Intent(ordinary,AlphaAssistActivity.class),new ComponentCaller("foreign.package"));check(SenseListenerClient.powerAttempts==offered);check(ordinary.intent.target==AlphaAssistActivity.class&&ordinary.intent.extras==1);check(ordinary.takeInvocation().equals("assist")&&p.takeInvocation().equals("assist"));
  AlphaLocalAgentPlugin.pin=new AlphaLocalAgentPlugin.PowerLaunchPin();AlphaPowerVoiceActivity fresh=new AlphaPowerVoiceActivity();fresh.onCreate(null);check(SenseListenerClient.coldBegins==1);fresh.onWindowFocusChanged(true);fresh.onWindowFocusChanged(false);check(SenseListenerClient.focusChanges==2);fresh.onPause();fresh.onDestroy();check(SenseListenerClient.cancels==2);
  AlphaPowerVoiceActivity recreated=new AlphaPowerVoiceActivity();recreated.onCreate(new Bundle());check(SenseListenerClient.coldBegins==1);new AlphaAssistActivity().onCreate(null);check(SenseListenerClient.coldBegins==1);
  System.out.println("PASS actual Power shell: cold/restored/no-bridge/ordinary fail closed; same-bound-instance callback once; owner reset clears offer");
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
  put('ai/alphacompute/alphaphone/MainActivity.java','package ai.alphacompute.alphaphone;public class MainActivity extends android.app.Activity {protected boolean isAssistantSurface(){return false;}protected void load(){}public static class Bridge {public void triggerWindowJSEvent(String n){}}public Bridge getBridge(){return null;}@Override public void onCreate(android.os.Bundle b){super.onCreate(b);}@Override public void onNewIntent(android.content.Intent i){super.onNewIntent(i);}}');
  const compiled=javac(['-cp',androidJar,'-d',join(dir,'out'),...sources(),...['AlphaAssistActivity.java','AlphaPowerVoiceActivity.java'].map(nativeSource)]);
  assert.equal(compiled.status,0,compiled.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
