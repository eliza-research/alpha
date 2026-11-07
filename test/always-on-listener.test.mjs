import '../vendor/eliza/packages/app/test/android/sense.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('Alpha public components still compile against the common listener and preserve stored identity',()=>{
 const root=path.resolve(import.meta.dirname,'..'),shared=path.join(root,'vendor/eliza/packages/app/platforms/android/sense/src/main/java/ai/eliza/sense');
 const component=path.join(root,'android/sense/src/main/java/ai/elizaresearch/alphaphone/sense');
 const product=JSON.parse(fs.readFileSync(path.join(root,'vendor/eliza/packages/os/android/products/pixel10a-alpha.json')));
 assert.equal(product.sense.componentPackage,'ai.elizaresearch.alphaphone.sense');assert.equal(product.sense.storageName,'listener-settings');assert.deepEqual(product.sense.wakeNames,['alpha']);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-sense-compat-'));
 try {
  const config='package ai.eliza.sense; public final class BuildConfig { public static final String APPLICATION_ID="ai.elizaresearch.alphaphone.sense", SENSE_HOST_PACKAGE="ai.elizaresearch.alphaphone", SENSE_ASSIST_ACTIVITY="ai.elizaresearch.alphaphone.AlphaAssistActivity", SENSE_APP_NAME="Alpha", SENSE_WAKE_LABEL="Alpha", SENSE_WAKE_NAMES="alpha", SENSE_COMPONENT_PACKAGE="ai.elizaresearch.alphaphone.sense", SENSE_STORAGE_NAME="listener-settings"; }';
  fs.writeFileSync(path.join(temp,'BuildConfig.java'),config);
  fs.writeFileSync(path.join(temp,'R.java'),'package ai.eliza.sense; public final class R { public static final class drawable { public static final int ic_listening=1; }}');
  fs.writeFileSync(path.join(temp,'NativeAsr.java'),'package ai.eliza.voice; public interface NativeAsr extends AutoCloseable { String transcribe(float[] samples); void cancel(); void close(); }');
  fs.writeFileSync(path.join(temp,'VoiceAssets.java'),'package ai.eliza.voice; public final class VoiceAssets { public static VoiceAssets install(android.content.Context context){return null;} public NativeAsr openAsr(){return null;} }');
  const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin/javac'):'javac';
  const sources=dir=>fs.readdirSync(dir).filter(file=>file.endsWith('.java')).map(file=>path.join(dir,file));
  execFileSync(java,['--release','21','-cp',path.join(process.env.ANDROID_HOME??path.join(os.homedir(),'Android/Sdk'),'platforms/android-36/android.jar'),'-d',path.join(temp,'out'),...sources(temp),...sources(shared),...sources(component)],{timeout:60000});
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});

test('legacy AlphaListener is a thin alias of the shared native control bridge',()=>{
 const root=path.resolve(import.meta.dirname,'..'),source=path.join(root,'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-sense-control-'));
 try {
  const stubs={
   'Plugin.java':'package com.getcapacitor; public class Plugin { public void load(){} protected void handleOnPause(){} protected void handleOnDestroy(){} public android.content.Context getContext(){return null;} public android.app.Activity getActivity(){return null;} }',
   'PluginCall.java':'package com.getcapacitor; public class PluginCall { public void resolve(JSObject value){} public void resolve(){} public void reject(String value){} public String getString(String value){return null;} public Integer getInt(String value){return null;} }',
   'JSObject.java':'package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object> {}',
   'PluginMethod.java':'package com.getcapacitor; @java.lang.annotation.Target(java.lang.annotation.ElementType.METHOD) public @interface PluginMethod {}',
   'CapacitorPlugin.java':'package com.getcapacitor.annotation; @java.lang.annotation.Target(java.lang.annotation.ElementType.TYPE) public @interface CapacitorPlugin {String name();}',
  };
  const files=Object.entries(stubs).map(([name,text])=>{const file=path.join(temp,name);fs.writeFileSync(file,text);return file;});
  const sdk=path.join(process.env.ANDROID_HOME??path.join(os.homedir(),'Android/Sdk'),'platforms/android-36/android.jar');
  const java=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin/javac'):'javac';
  execFileSync(java,['--release','21','-cp',sdk,'-d',path.join(temp,'out'),...files,...['SenseInvocation','SenseListenerClient','SensePlugin'].map(name=>path.join(source,`${name}.java`)),path.join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaListenerPlugin.java')]);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test('a cold listener wake is bound to Alpha native owner state, never renderer input',()=>{
 const root=path.resolve(import.meta.dirname,'..'),strip=text=>text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
 const app=strip(fs.readFileSync(path.join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaApplication.java'),'utf8'));
 const agent=strip(fs.readFileSync(path.join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java'),'utf8'));
 // Registered once in the main process, after the isolated/secondary-process return, before any activity records a wake.
 const admission=app.indexOf('admitOwner(()->AlphaLocalAgentPlugin.invocationOwner(this))'),mainOnly=app.indexOf('if(android.os.Process.isIsolated()||!getPackageName().equals(getProcessName()))return;');
 assert.ok(admission>mainOnly&&mainOnly>0,'admission is registered in the main process only');
 // The owner is the stored provider admission generation (a UUID or no-provider), never a token.
 assert.match(agent,/static String invocationOwner\(Context context\)\{return INVOCATION_OWNER\.get\(\(\)->readProviderOwner\(new AlphaCredentialStore\(context\)\),System\.currentTimeMillis\(\)\);\}/);
 const shared=strip(fs.readFileSync(path.join(root,'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/SenseInvocation.java'),'utf8'));
 assert.match(shared,/COLD_WINDOW_MS = 15000/);
 assert.match(shared,/if \(!waitingOwner\.equals\(admittedOwner\(\)\)\) \{ clear\(\); return; \}/);
 // The assist surface still records only Android caller identity; no extra or deep link reaches it.
 const assist=strip(fs.readFileSync(path.join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaAssistActivity.java'),'utf8'));
 // An ordinary assist records the caller; a protected Power entry records no caller package.
 assert.match(assist,/new ai\.eliza\.plugins\.system\.SenseListenerClient\(this\);/);
 assert.match(assist,/sense\.recordInvocation\(isProtectedPowerEntry\(\) \? null : caller\);/);
 assert.doesNotMatch(assist,/getStringExtra|getData\(\)|getExtras\(\)/);
});
test('press-and-hold power starts voice only through SystemUI identity that Android reports',()=>{
 const root=path.resolve(import.meta.dirname,'..'),strip=text=>text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,'');
 // The image routes press-and-hold power to the assistant role holder (Alpha's ACTION_ASSIST surface).
 const overlay=fs.readFileSync(path.join(root,'vendor/eliza/packages/os/android/sense/config.xml'),'utf8');
 assert.match(overlay,/<integer name="config_longPressOnPowerBehavior">5<\/integer>/);
 // Alpha records only Android's caller APIs: the launching package on create and ComponentCaller on new intents.
 const assist=strip(fs.readFileSync(path.join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaAssistActivity.java'),'utf8'));
 assert.match(assist,/state == null && Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE \? getLaunchedFromPackage\(\) : null/);
 assert.match(assist,/newIntentCaller = caller == null \? null : caller\.getPackage\(\);/);
 // Shared Sense marks a system gesture only for the platform-signed system UI; the shared renderer policy starts voice for it.
 const client=strip(fs.readFileSync(path.join(root,'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/SenseListenerClient.java'),'utf8'));
 assert.match(client,/SYSTEM_UI_PACKAGE = "com\.android\.systemui"/);
 assert.match(client,/checkSignatures\("android", callerPackage\) == PackageManager\.SIGNATURE_MATCH/);
 const policy=fs.readFileSync(path.join(root,'vendor/eliza/plugins/plugin-native-system/src/sense.ts'),'utf8');
 // Voice origins are the listener wake, the system gesture and the warm protected Power receipt; anything else only opens the assistant.
 assert.match(policy,/const VOICE_INVOCATIONS: ReadonlySet<AssistantInvocation> = new Set\(\[\s*"listener",\s*"system",\s*"power",?\s*\]\);/);
 assert.match(policy,/VOICE_INVOCATIONS\.has\(input\.invocation\) &&/);
 // SystemUI shares its identity only with the reviewed assist bundle applied to the exact pinned preimage.
 const bundle=JSON.parse(fs.readFileSync(path.join(root,'vendor/eliza/packages/os/android/sense/systemui/assist/manifest.json'),'utf8'));
 assert.deepEqual(bundle.files.map(file=>file.path),['packages/SystemUI/src/com/android/systemui/assist/AssistManager.java']);
 assert.equal(bundle.imageBuilt,false);
 const patch=fs.readFileSync(path.join(root,'vendor/eliza/packages/os/android/sense/systemui/assist',bundle.patch),'utf8');
 assert.deepEqual(patch.split('\n').filter(line=>/^\+[^+]/.test(line)&&!/^\+\s*\/\//.test(line)).map(line=>line.slice(1).trim()),['opts.setShareIdentityEnabled(true);']);
});
