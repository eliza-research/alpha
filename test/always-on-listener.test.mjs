import '../vendor/eliza/packages/app/test/android/sense.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary} from './fixtures/jvm-tools.mjs';
test('Alpha public components still compile against the common listener and preserve stored identity',()=>{
 const root=path.resolve(import.meta.dirname,'..'),shared=path.join(root,'vendor/eliza/packages/app/platforms/android/sense/src/main/java/ai/eliza/sense');
 const component=path.join(root,'android/sense/src/main/java/ai/alphacompute/alphaphone/sense');
 const product=JSON.parse(fs.readFileSync(path.join(root,'android/aosp/pixel10a-composition.json')));
 assert.equal(product.sense.componentPackage,'ai.alphacompute.alphaphone.sense');assert.equal(product.sense.storageName,'listener-settings');assert.deepEqual(product.sense.wakeNames,['alpha']);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-sense-compat-'));
 try {
  // Same fields consumer.gradle derives from the product profile.
  const sense=product.sense,host='ai.alphacompute.alphaphone';
  const config=`package ai.eliza.sense; public final class BuildConfig { public static final String APPLICATION_ID=${JSON.stringify(`${host}.sense`)}, SENSE_HOST_PACKAGE=${JSON.stringify(host)}, SENSE_ASSIST_ACTIVITY=${JSON.stringify(sense.assistActivity)}, SENSE_APP_NAME=${JSON.stringify(sense.appName)}, SENSE_WAKE_LABEL=${JSON.stringify(sense.wakeNames[0])}, SENSE_WAKE_NAMES=${JSON.stringify(sense.wakeNames.join(','))}, SENSE_COMPONENT_PACKAGE=${JSON.stringify(sense.componentPackage)}, SENSE_STORAGE_NAME=${JSON.stringify(sense.storageName)}; }`;
  fs.writeFileSync(path.join(temp,'BuildConfig.java'),config);
  fs.writeFileSync(path.join(temp,'R.java'),'package ai.eliza.sense; public final class R { public static final class drawable { public static final int ic_listening=1; }}');
  fs.writeFileSync(path.join(temp,'NativeAsr.java'),'package ai.eliza.voice; public interface NativeAsr extends AutoCloseable { String transcribe(float[] samples); void cancel(); void close(); }');
  fs.writeFileSync(path.join(temp,'VoiceAssets.java'),'package ai.eliza.voice; public final class VoiceAssets { public static VoiceAssets install(android.content.Context context){return null;} public NativeAsr openAsr(){return null;} }');
  const java=javaBinary('javac');
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
  execFileSync(javaBinary('javac'),['--release','21','-cp',sdk,'-d',path.join(temp,'out'),...files,...['SenseInvocation','SenseListenerClient','SensePlugin'].map(name=>path.join(source,`${name}.java`)),path.join(root,'android/app/src/main/java/ai/alphacompute/alphaphone/AlphaListenerPlugin.java')],{timeout:60000});
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
