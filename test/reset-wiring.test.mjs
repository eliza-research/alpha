import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
// Alpha registers the shared reset (plugin-native-system reset.*) under its installed names; the
// authorization, disclosure, recording, dispatch and recovery behavior are tested upstream.
const root=resolve(import.meta.dirname,'..');
const upstream=resolve(root,'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system');
const alpha=name=>resolve(root,`android/app/src/main/java/ai/elizaresearch/alphaphone/${name}.java`);
test('Alpha reset is the shared native review, coordinator and recovery under Alpha names and copy',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-reset-wiring-')),files=[];
 const put=(name,text)=>{const file=join(dir,'src',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);files.push(file);};
 const bin=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name):name;
 const sdk=join(process.env.ANDROID_HOME??join(homedir(),'Android/Sdk'),'platforms/android-36/android.jar');
 try{
  put('com/getcapacitor/Plugin.java','package com.getcapacitor; public class Plugin { protected void handleOnDestroy(){} public android.content.Context getContext(){return null;} public android.app.Activity getActivity(){return null;} public void startActivityForResult(PluginCall call,android.content.Intent intent,String callback){} }');
  put('com/getcapacitor/PluginCall.java','package com.getcapacitor; public class PluginCall { public void resolve(JSObject value){} }');
  put('com/getcapacitor/JSObject.java','package com.getcapacitor; public class JSObject extends java.util.HashMap<String,Object> { public JSObject put(String k,String v){super.put(k,v);return this;} }');
  put('com/getcapacitor/PluginMethod.java','package com.getcapacitor; @java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.RUNTIME) public @interface PluginMethod {}');
  put('com/getcapacitor/annotation/CapacitorPlugin.java','package com.getcapacitor.annotation; @java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.RUNTIME) public @interface CapacitorPlugin {String name();}');
  put('com/getcapacitor/annotation/ActivityCallback.java','package com.getcapacitor.annotation; @java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.RUNTIME) public @interface ActivityCallback {}');
  put('androidx/activity/result/ActivityResult.java','package androidx.activity.result; public class ActivityResult { public int getResultCode(){return 0;} }');
  put('ai/elizaresearch/alphaphone/AlphaCloudSignInPlugin.java','package ai.elizaresearch.alphaphone; final class AlphaCloudSignInPlugin {static ai.eliza.auth.cloud.CloudSignInConfig REGISTRATION;}');
  put('ai/elizaresearch/alphaphone/AlphaCredentialStore.java','package ai.elizaresearch.alphaphone; final class AlphaCredentialStore {static String readSlotBeforeAttach(android.content.Context c,String n)throws Exception{return null;}}');
  put('ai/elizaresearch/alphaphone/WiringCheck.java',`package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.system.reset.*;
public final class WiringCheck {
 static void check(boolean ok,String why){if(!ok)throw new AssertionError(why);}
 public static void main(String[] args){
  check(DataResetPlugin.class.isAssignableFrom(AlphaResetPlugin.class),"shared native review");
  check("AlphaReset".equals(AlphaResetPlugin.class.getAnnotation(com.getcapacitor.annotation.CapacitorPlugin.class).name()),"installed plugin name");
  check(DataResetRecoveryActivity.class.isAssignableFrom(ResetRecoveryActivity.class),"shared recovery surface");
  check(AlphaDataReset.RESET.recoveryProcessSuffix().equals(":reset_recovery"),"installed recovery process");
  DataResetCopy copy=AlphaDataReset.COPY;
  check(copy.reviewTitle.equals("Reset Alpha data?")&&copy.continueLabel.equals("Continue to unlock"),"review text");
  check(copy.disclosure.contains("There is no backup or undo")&&copy.disclosure.contains("not deleted or cancelled")&&copy.disclosure.contains("Other apps are not reset"),"disclosure scope");
  check(copy.credentialDescription.equals("Unlock to permanently erase Alpha's local data."),"credential prompt");
  check(copy.progressMessage.startsWith("Signing out of Cloud"),"progress covers the Cloud revocation window");
  for(DataReset.Outcome last:new DataReset.Outcome[]{null,DataReset.Outcome.ANDROID_REFUSED,DataReset.Outcome.LISTENER_UNACKNOWLEDGED})for(boolean installed:new boolean[]{false,true})for(boolean controllable:new boolean[]{false,true}){
   String body=copy.recoveryBody(last,installed,controllable);
   check(body.contains("Alpha's local data has not been deleted yet. (Alpha may already have asked Cloud to revoke this phone's sign-in.)"),"recovery never claims deletion");
   check(!body.matches("(?is).*(reset (is )?complete|data (was|has been) deleted\\\\.).*"),"no completion claim");
  }
  System.out.println("PASS Alpha reset wiring");
 }
}`);
  const shared=['reset/DataReset','reset/DataResetCopy','reset/DataResetPlugin','reset/DataResetRecoveryActivity','reset/ResetAuthorization','SenseListenerClient','SenseInvocation'].map(name=>join(upstream,`${name}.java`));
  // The real shared Cloud reset step: Alpha's binding must compile against its exact signature.
  const authDir=resolve(root,'vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud');
  const auth=readdirSync(authDir).filter(name=>name.endsWith('.java')&&!['CloudSignInPlugin.java','NativeGoogleCredential.java'].includes(name)).map(name=>join(authDir,name));
  execFileSync(bin('javac'),['--release','17','-proc:none','-cp',sdk,'-d',join(dir,'classes'),...files,...shared,...auth,...['AlphaDataReset','AlphaResetPlugin','ResetRecoveryActivity'].map(alpha)],{timeout:120000});
  assert.match(execFileSync(bin('java'),['-cp',`${join(dir,'classes')}:${sdk}`,'ai.elizaresearch.alphaphone.WiringCheck'],{encoding:'utf8',timeout:30000}),/PASS Alpha reset wiring/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Settings opens only the native review; Application admission runs before providers',()=>{
 const settings=readFileSync(resolve(root,'apps/app/src/prototype/settings-adapter.ts'),'utf8');
 assert.match(settings,/reviewDataReset\(registerPlugin<DataResetPlugin>\('AlphaReset'\)\)/,'the renderer passes no reset arguments');
 const application=readFileSync(alpha('AlphaApplication'),'utf8');
 const attach=application.slice(application.indexOf('attachBaseContext('),application.indexOf('public void onCreate'));
 assert.ok(attach.indexOf('super.attachBaseContext(base);')<attach.indexOf('AlphaDataReset.RESET.admitBeforeStartup(base,getProcessName());'),'admission right after attach, before providers');
 assert.match(application,/if\(resetRecoveryProcess\(\)\)return;/,'the recovery process starts no runtime');
 assert.match(readFileSync(alpha('MainActivity'),'utf8'),/registerPlugin\(AlphaResetPlugin\.class\);/);
});
