import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary,jsonJar,jsonJarSkip} from './fixtures/jvm-tools.mjs';
// Alpha's reset step (ResetBeforeDispatch) binds the shared bounded revocation
// (ai.eliza.auth.cloud.CloudKeyRevocation.resetStep, behavior tested upstream in packages/auth) to its
// live registration, its pre-attach credential slots and a retained pre-namespace production key.
// Host JVM only: the real ResetBeforeDispatch and shared step with a recording transport and stubbed
// slots; no Android, Calendar provider, Cloud request or credential.
const root=resolve(import.meta.dirname,'..');
const system=resolve(root,'vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system');
test('the reset step revokes each saved key once, a distinct legacy key too, best effort and bounded',{skip:jsonJarSkip},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-reset-revoke-')),files=[];
 const put=(name,text)=>{const file=join(dir,'src',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);files.push(file);};
 const sdk=join(process.env.ANDROID_HOME??join(homedir(),'Android/Sdk'),'platforms/android-36/android.jar');
 const auth=resolve(root,'vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud');
 const shared=readdirSync(auth).filter(name=>name.endsWith('.java')&&!['CloudSignInPlugin.java','NativeGoogleCredential.java'].includes(name)).map(name=>join(auth,name));
 try{
  put('ai/alphacompute/alphaphone/AlphaCalendarPlugin.java','package ai.alphacompute.alphaphone; final class AlphaCalendarPlugin {static ai.eliza.plugins.calendar.CalendarConfiguration CONFIGURATION;}');
  put('ai/alphacompute/alphaphone/AlphaCredentialStore.java',`package ai.alphacompute.alphaphone;
final class AlphaCredentialStore {
 static boolean unreadable;static java.util.Map<String,String> current=new java.util.HashMap<>(),legacy=new java.util.HashMap<>();
 static String readSlotBeforeAttach(android.content.Context c,String n)throws Exception{if(unreadable)throw new Exception("locked");return current.get(n);}
 static String readLegacySlotBeforeAttach(android.content.Context c,String n)throws Exception{if(unreadable)throw new Exception("locked");return legacy.get(n);}
}`);
  // Not final here so a case can move the build to another deployment; the real one is a constant.
  put('ai/alphacompute/alphaphone/LegacyCloudRecovery.java','package ai.alphacompute.alphaphone; final class LegacyCloudRecovery {static String LEGACY_NAMESPACE=CloudDeployment.STORAGE_NAMESPACE;}');
  put('ai/alphacompute/alphaphone/AlphaCloudSignInPlugin.java',`package ai.alphacompute.alphaphone;
import ai.eliza.auth.cloud.*;
final class AlphaCloudSignInPlugin {static final CloudSignInConfig REGISTRATION=CloudSignInConfig.builder().clientId("ai.alphacompute.alphaphone").deviceName("Alpha Phone").productName("Alpha Phone").googleClientId("alpha-phone").environment(new CloudSignInEnvironment("production","api.eliza.app","eliza.app","elizacloud","Eliza Cloud","/alphaphone/auth/callback")).build();}`);
  put('ai/alphacompute/alphaphone/Fixture.java',`package ai.alphacompute.alphaphone;
import ai.eliza.plugins.system.reset.DataReset;
public class Fixture {
 static java.util.List<String> revoked=new java.util.ArrayList<>();static boolean block;
 static String key(String id,String token)throws Exception{return new org.json.JSONObject().put("credentialId",id).put("token",token).toString();}
 static void reset(){revoked.clear();AlphaCredentialStore.current.clear();AlphaCredentialStore.legacy.clear();}
 public static void main(String[] args)throws Exception{
  // Alpha's composed step with a recording transport in place of HTTP. A null context leaves the
  // Calendar step to fail inside its own best-effort catch, as a missing provider would.
  DataReset.BeforeDispatch step=ResetBeforeDispatch.create((config,environment,token)->{if(block)try{Thread.sleep(10000);}catch(InterruptedException expected){}revoked.add(environment.name+"="+token);return true;});
  AlphaCredentialStore.current.put("cloud:production",key("current","eliza_mobile_current"));
  step.run(null,1000);check(revoked.equals(java.util.List.of("production=eliza_mobile_current")),"namespaced key revoked");
  reset();AlphaCredentialStore.current.put("cloud:production",key("current","eliza_mobile_current"));AlphaCredentialStore.legacy.put("cloud:production",key("legacy","eliza_mobile_legacy"));
  step.run(null,1000);check(revoked.equals(java.util.List.of("production=eliza_mobile_current","production=eliza_mobile_legacy")),"a distinct legacy key is revoked after the current one");
  reset();AlphaCredentialStore.current.put("cloud:production",key("same","eliza_mobile_same"));AlphaCredentialStore.legacy.put("cloud:production",key("same","eliza_mobile_same"));
  step.run(null,1000);check(revoked.equals(java.util.List.of("production=eliza_mobile_same")),"the same key is revoked once");
  reset();AlphaCredentialStore.legacy.put("cloud:production",key("legacy","eliza_mobile_legacy"));
  step.run(null,1000);check(revoked.equals(java.util.List.of("production=eliza_mobile_legacy")),"a legacy key alone is revoked");
  reset();AlphaCredentialStore.legacy.put("cloud:production",key("legacy","eliza_mobile_legacy"));LegacyCloudRecovery.LEGACY_NAMESPACE="cloud-deployment:other:";
  step.run(null,1000);check(revoked.isEmpty(),"a legacy key from another deployment is never sent");LegacyCloudRecovery.LEGACY_NAMESPACE=CloudDeployment.STORAGE_NAMESPACE;
  reset();AlphaCredentialStore.current.put("cloud:production",key("current","eliza_mobile_current"));AlphaCredentialStore.unreadable=true;
  step.run(null,1000);check(revoked.isEmpty(),"an unreadable store skips revocation");AlphaCredentialStore.unreadable=false;
  reset();AlphaCredentialStore.current.put("cloud:production",key("current","eliza_mobile_current"));AlphaCredentialStore.legacy.put("cloud:production",key("legacy","eliza_mobile_legacy"));
  block=true;long start=System.nanoTime();step.run(null,300);check((System.nanoTime()-start)/1000000<2000,"the whole step stays within the coordinator's budget");
  System.out.println("PASS Alpha reset revocation binding");}
 static void check(boolean ok,String why){if(!ok)throw new AssertionError(why+": "+revoked);}}
`);
  const reset=['reset/DataReset','reset/DataResetCopy','reset/DataResetRecoveryActivity','reset/ResetAuthorization','SenseListenerClient','SenseInvocation'].map(name=>join(system,`${name}.java`));
  const calendar=resolve(root,'vendor/eliza/plugins/plugin-native-calendar/android/src/main/java/ai/eliza/plugins/calendar/CalendarConfiguration.java');
  const alpha=['ResetBeforeDispatch','CloudDeployment'].map(name=>resolve(root,`android/app/src/main/java/ai/alphacompute/alphaphone/${name}.java`));
  // org.json comes from the real jar ahead of android.jar's stubs.
  execFileSync(javaBinary('javac'),['--release','17','-proc:none','-cp',`${jsonJar}:${sdk}`,'-d',join(dir,'classes'),...files,...shared,...reset,calendar,...alpha],{timeout:scaledTimeout(120000)});
  assert.match(execFileSync(javaBinary('java'),['-cp',`${join(dir,'classes')}:${jsonJar}:${sdk}`,'ai.alphacompute.alphaphone.Fixture'],{encoding:'utf8',timeout:scaledTimeout(60000)}),/PASS Alpha reset revocation binding/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
