import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
// Alpha binds the shared bounded reset step (ai.eliza.auth.cloud.CloudKeyRevocation.resetStep, behavior
// tested upstream in packages/auth) to its live registration and its pre-attach credential slots. Host
// JVM only: the real shared step with Alpha's registration and a recording transport; no Android, Cloud
// request or credential.
const root=resolve(import.meta.dirname,'..');
const binding='.beforeDispatch(ai.eliza.auth.cloud.CloudKeyRevocation.resetStep(()->AlphaCloudSignInPlugin.REGISTRATION,AlphaCredentialStore::readSlotBeforeAttach)::run)';
test('Alpha reset binds the shared Cloud revocation step to its registration and pre-attach slots',()=>{
 const registration=readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaDataReset.java'),'utf8');
 assert.ok(registration.includes(binding),'AlphaDataReset passes the shared step, not a local copy');
 assert.match(readFileSync(join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaCredentialStore.java'),'utf8'),/static String readSlotBeforeAttach\(Context base,String name\)throws Exception\{/,'the slot reader works before the credential store attaches (startup resume)');
});
test('the bound step revokes each environment this build registers, best effort and bounded',{skip:jsonJarSkip},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-reset-revoke-')),files=[];
 const put=(name,text)=>{const file=join(dir,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);files.push(file);};
 const auth=resolve(root,'vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud');
 const shared=readdirSync(auth).filter(name=>name.endsWith('.java')&&!['CloudSignInPlugin.java','NativeGoogleCredential.java'].includes(name)).map(name=>join(auth,name));
 try{
  put('android/content/Context.java','package android.content; public class Context {}');
  put('ai/elizaresearch/alphaphone/Fixture.java',`package ai.elizaresearch.alphaphone;
import ai.eliza.auth.cloud.*;
class AlphaCredentialStore {static boolean unreadable;static java.util.List<String> slots=new java.util.ArrayList<>();static String readSlotBeforeAttach(android.content.Context c,String n)throws Exception{if(unreadable)throw new Exception("locked");slots.add(n);return new org.json.JSONObject().put("token","eliza_mobile_"+n.replace(':','_')).toString();}}
class AlphaCloudSignInPlugin {static CloudSignInConfig REGISTRATION=registration(false);
 static CloudSignInConfig registration(boolean mocks){CloudSignInConfig.Builder b=CloudSignInConfig.builder().clientId("ai.elizaresearch.alphaphone").deviceName("Alpha Phone").productName("Alpha Phone").googleClientId("alpha-phone").environment(new CloudSignInEnvironment("production","api.eliza.app","eliza.app","elizacloud","Eliza Cloud","/alphaphone/auth/callback"));if(mocks)b.environment(new CloudSignInEnvironment("staging","api-staging.eliza.app","staging.eliza.app","elizacloud-staging","Eliza Cloud","/alphaphone/auth/callback"));return b.build();}}
public class Fixture {
 static java.util.List<String> revoked=new java.util.ArrayList<>();static boolean block;
 public static void main(String[] args){
  // The exact binding expression from AlphaDataReset, with a recording transport in place of HTTP.
  CloudKeyRevocation.ResetStep<android.content.Context> step=CloudKeyRevocation.resetStep(()->AlphaCloudSignInPlugin.REGISTRATION,AlphaCredentialStore::readSlotBeforeAttach,(config,environment,token)->{if(block)try{Thread.sleep(10000);}catch(InterruptedException expected){}revoked.add(environment.name+"="+token);return true;});
  android.content.Context c=new android.content.Context();
  step.run(c,1000);check(AlphaCredentialStore.slots.equals(java.util.List.of("cloud:production"))&&revoked.equals(java.util.List.of("production=eliza_mobile_cloud_production")));
  AlphaCloudSignInPlugin.REGISTRATION=AlphaCloudSignInPlugin.registration(true);step.run(c,1000);check(revoked.size()==3&&revoked.contains("staging=eliza_mobile_cloud_staging"));
  AlphaCredentialStore.unreadable=true;step.run(c,1000);check(revoked.size()==3);AlphaCredentialStore.unreadable=false;
  block=true;long start=System.nanoTime();step.run(c,30);check((System.nanoTime()-start)/1000000<2000);
  System.out.println("PASS Alpha reset revocation binding");}
 static void check(boolean ok){if(!ok)throw new AssertionError();}}
`);
  assert.match(runJvm([...files,...shared],'ai.elizaresearch.alphaphone.Fixture',{json:true}),/PASS Alpha reset revocation binding/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
