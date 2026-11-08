// Executes the actual native-only Power pin policy and credential-store commits on the host JVM,
// with slot and Android inputs modeled. No secrets, no device. Not Android evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {javaBinary,jsonJar,jvmSkip,jvmTimeout,nativeSource,upstreamAgentRuntime} from './fixtures/jvm-tools.mjs';

const plugin=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
const between=(start,end)=>plugin.slice(plugin.indexOf(start),plugin.indexOf(end));
const policy=()=>between(' private static long powerAuthorizationMutationEpoch;',' private final java.util.Set<String> cancelledStarts');
const mutation=()=>between(' interface CredentialMutation<T>',' static boolean providerAdmissionReadable()');
// On CI the SDK must come from the environment; locally the default SDK location also counts.
const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME||(process.env.CI?'':join(homedir(),process.platform==='darwin'?'Library/Android/sdk':'Android/Sdk'));
const androidJar=sdk?join(sdk,'platforms/android-36/android.jar'):'';

function workspace(prefix){
 const dir=mkdtempSync(join(tmpdir(),prefix));
 const put=(name,text)=>{const file=join(dir,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);};
 const sources=()=>readdirSync(dir,{recursive:true}).filter(name=>name.endsWith('.java')).map(name=>join(dir,name));
 return {dir,put,sources};
}
const javac=(args)=>spawnSync(javaBinary('javac'),['--release','17',...args],{encoding:'utf8',timeout:jvmTimeout});

test('actual pin refuses ABA, account, provider, permission and pending changes',{skip:jvmSkip('javac')},()=>{
 const {dir,put,sources}=workspace('alpha-power-pin-');
 try{
  put('android/Manifest.java','package android;public class Manifest{public static class permission{public static final String RECORD_AUDIO="mic";}}');
  put('android/content/pm/PackageManager.java','package android.content.pm;public class PackageManager{public static final int PERMISSION_GRANTED=0;}');
  put('android/content/Context.java','package android.content;public class Context{public int permission=0;public Context getApplicationContext(){return this;}public int checkSelfPermission(String s){return permission;}}');
  put('org/json/JSONObject.java','package org.json;public class JSONObject{private final java.util.Map<String,String> m=new java.util.HashMap<>();public JSONObject put(String k,String v){m.put(k,v);return this;}public String getString(String k){if(!m.containsKey(k))throw new IllegalStateException();return m.get(k);}public String optString(String k){return m.getOrDefault(k,"");}}');
  put('ai/eliza/plugins/system/SenseListenerClient.java','package ai.eliza.plugins.system;public class SenseListenerClient{public interface PowerLaunchValidator{boolean isCurrent();boolean authorize(String accountRef,java.util.function.BooleanSupplier consume);}}');
  put('ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java','package ai.eliza.plugins.securestore.nativeonly;public class JsonCredentialSlots{public static final Object LOCK=new Object();}');
  put('ai/elizaresearch/alphaphone/AlphaCredentialStore.java','package ai.elizaresearch.alphaphone;import org.json.JSONObject;public class AlphaCredentialStore{static JSONObject admission;AlphaCredentialStore(android.content.Context c){}JSONObject providerAdmissionSnapshot(){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){if(admission==null)throw new IllegalStateException();return admission;}}}');
  const prefix='package ai.elizaresearch.alphaphone;import android.content.Context;import org.json.JSONObject;public class AlphaLocalAgentPlugin{static final Object lifecycleLock=new Object();static boolean stopping;static long lifecycleEpoch,credentialMutationEpoch=-1,credentialShutdownRequest=-1;';
  put('ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java',prefix+policy()+`
    static JSONObject admitted(String account,String generation){return new JSONObject().put("provider","elizacloud").put("environment","production").put("accountRef",account).put("sessionGeneration",generation);}
    static void check(boolean value){if(!value)throw new AssertionError();}
    public static void main(String[] args){
     Context context=new Context();AlphaCredentialStore.admission=admitted("account-A","generation-A");
     PowerLaunchPin pin=capturePowerLaunchPin(context);check(pin!=null&&pin.isCurrent()&&pin.authorize("account-A",()->true)&&!pin.authorize("account-B",()->{throw new AssertionError("foreign account callback");}));
     lifecycleEpoch++;check(pin.isCurrent()); // ordinary startup is not an account mutation
     AlphaCredentialStore.admission=admitted("account-B","generation-A");check(!pin.isCurrent());
     AlphaCredentialStore.admission=admitted("account-A","generation-B");check(!pin.isCurrent());
     AlphaCredentialStore.admission=admitted("account-A","generation-A");
     boolean refused=false;try{powerAuthorizationChanged();}catch(IllegalStateException expected){refused=true;}check(refused);
     synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){powerAuthorizationChanged();powerAuthorizationChanged();}}
     check(!pin.isCurrent()); // A -> B -> A never resurrects a prior launch
     pin=capturePowerLaunchPin(context);check(pin!=null);
     credentialMutationEpoch=1;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);credentialMutationEpoch=-1;
     credentialShutdownRequest=2;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);credentialShutdownRequest=-1;
     stopping=true;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);stopping=false;
     context.permission=-1;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);context.permission=0;
     AlphaCredentialStore.admission=null;check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);
     AlphaCredentialStore.admission=admitted("account-A","generation-A").put("provider","cerebras");check(!pin.isCurrent()&&capturePowerLaunchPin(context)==null);
     System.out.println("PASS native pin exact account/generation, normal startup, ABA, lock ownership, mutation/shutdown, permission, missing/nonCloud admission");
    }
   }`);
  const compiled=javac(['-d',dir,...sources()]);
  assert.equal(compiled.status,0,compiled.stderr);
  assert.match(execFileSync(javaBinary('java'),['-cp',dir,'ai.elizaresearch.alphaphone.AlphaLocalAgentPlugin'],{encoding:'utf8',timeout:jvmTimeout}),/PASS native pin/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

/** Writes the modeled host classes and the commit harness; returns them with the actual store sources. */
function commitSources({dir,put,sources:modeled}){
 const admission=upstreamAgentRuntime('NativeProviderAdmission.java');
 assert.ok(existsSync(admission),'The pinned SDK must provide NativeProviderAdmission');
 put('android/content/Context.java','package android.content;public class Context{public Context getApplicationContext(){return this;}public int checkSelfPermission(String permission){return 0;}public java.io.File getNoBackupFilesDir(){return new java.io.File("fixture");}}');
 put('android/Manifest.java','package android;public class Manifest{public static class permission{public static final String RECORD_AUDIO="mic";}}');
 put('android/content/pm/PackageManager.java','package android.content.pm;public class PackageManager{public static final int PERMISSION_GRANTED=0;}');
 put('ai/eliza/plugins/system/SenseListenerClient.java','package ai.eliza.plugins.system;public class SenseListenerClient{public interface PowerLaunchValidator{boolean isCurrent();boolean authorize(String accountRef,java.util.function.BooleanSupplier consume);}}');
 put('android/util/AtomicFile.java','package android.util;public class AtomicFile{}');
 put('android/os/SystemClock.java','package android.os;public class SystemClock{public static long elapsedRealtime(){return 1;}}');
 put('ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java',`package ai.eliza.plugins.securestore.nativeonly;
import java.io.File;import android.util.AtomicFile;public class JsonCredentialSlots{
 public static final Object LOCK=new Object();private static final java.util.Map<String,String> values=new java.util.HashMap<>();
 public interface Limits{int limit(String name);}public static class CapacityException extends IllegalArgumentException{}
 public JsonCredentialSlots(File d,String alias,Limits l){}public JsonCredentialSlots(File d,String alias,Limits l,Limits retained){}
 public static String failWrite;public String read(String n){return values.get(n);}public void write(String n,String v){if(n.equals(failWrite)){failWrite=null;throw new IllegalStateException("synthetic write refusal");}values.put(n,v);}public void remove(String n){values.remove(n);}
 public String slotHash(String n){return n;}public AtomicFile slotFile(String hash){return new AtomicFile();}
}`);
 put('ai/elizaresearch/alphaphone/CloudDeployment.java','package ai.elizaresearch.alphaphone;class CloudDeployment{static final String STORAGE_NAMESPACE="";static String storageSlot(String name){return name;}}');
 put('ai/elizaresearch/alphaphone/GoogleWorkspaceReturn.java','package ai.elizaresearch.alphaphone;class GoogleWorkspaceReturn{static final String SLOT="google-workspace-return:v1:pending";}');
 put('ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java','package ai.elizaresearch.alphaphone;class AlphaConnectionPlugin{static org.json.JSONObject readCloudIdentity(String token){throw new IllegalStateException("no network");}}');
 put('ai/elizaresearch/alphaphone/AlphaCanonicalNotifications.java','package ai.elizaresearch.alphaphone;class AlphaCanonicalNotifications{static void forget(android.content.Context c){}}');
 put('ai/elizaresearch/alphaphone/ElizaAgentService.java','package ai.elizaresearch.alphaphone;class ElizaAgentService{static long reserveCredentialShutdown(){return 1;}static void retryCredentialShutdown(android.content.Context c,long request){}static void abandonCredentialShutdown(long request){}static void releaseCredentialShutdown(long request){}static org.json.JSONObject getLocalAgentBootState(android.content.Context c){return new org.json.JSONObject();}static boolean isCredentialShutdownConfirmed(long request){return true;}}');
 const fields='package ai.elizaresearch.alphaphone;import android.content.Context;import org.json.JSONObject;class AlphaLocalAgentPlugin{static final Object lifecycleLock=new Object();static long lifecycleEpoch,credentialMutationEpoch=-1,credentialShutdownRequest=-1,uncertainCommitRequest=-1,startRequestEpoch,intent;static String startRequestId;static boolean startOwnsLaunch,accepting=true,stopping;static class Superseded extends Exception{}static final class Owner{void invalidate(){}}static final Owner INVOCATION_OWNER=new Owner();static void invalidateCalls(){}static void clearEnrollment(){}static boolean shutdownConfirmed(JSONObject state){return true;}static long currentCredentialIntent(){return intent;}static long reserveCredentialIntent(){return ++intent;}static void requireCredentialIntent(long value){if(value!=intent)throw new IllegalStateException();}static boolean providerAdmissionReadable(){return credentialMutationEpoch<0;}';
 put('ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java',fields+policy()+mutation()+'}');
 put('ai/elizaresearch/alphaphone/CommitTest.java',`package ai.elizaresearch.alphaphone;
import org.json.JSONObject;public class CommitTest{
 static int checks;static void check(boolean b){checks++;if(!b)throw new AssertionError("check "+checks);}
 static long epoch(){try{java.lang.reflect.Field f=AlphaLocalAgentPlugin.class.getDeclaredField("powerAuthorizationMutationEpoch");f.setAccessible(true);return f.getLong(null);}catch(Exception error){throw new AssertionError(error);}}
 static JSONObject selection(){return new JSONObject().put("provider","elizacloud").put("credentialId","33333333-3333-4333-8333-333333333333").put("model",LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL);}
 public static void main(String[]args)throws Exception{
 AlphaCredentialStore s=new AlphaCredentialStore(new android.content.Context());String slot=LocalAgentProviderAdmission.PROVIDER_SLOT;
 String a=new JSONObject().put("credentialId","33333333-3333-4333-8333-333333333333").put("token","synthetic-A-token").toString(),b=new JSONObject(a).put("token","synthetic-B-token").toString();
 long e=epoch();s.writeCredentialSlot("cloud:production",a);check(epoch()==++e); // no-provider/no-shutdown commit
 s.writeCredentialSlot("cloud:production",a);check(epoch()==e); // exact no-op
 check(!s.compareExchangeCredentialSlot("cloud:production","wrong",b));check(epoch()==e); // CAS refusal
 check(s.compareExchangeCredentialSlot("cloud:production",a,b));check(epoch()==++e);
 s.writeCredentialSlot("cloud:production",a);check(epoch()==++e); // A-B-A cannot reuse epoch
 s.removeCredentialSlot("cloud:production");check(epoch()==++e);s.writeCredentialSlot("cloud:production",a);check(epoch()==++e);
 String selected=selection().toString();s.writeCredentialSlot(slot,selected);check(epoch()==++e);
 JSONObject identity=LocalAgentProviderAdmission.verifiedCloudIdentity(new JSONObject().put("id","11111111-1111-4111-8111-111111111111"));
 String admitted=s.compareExchangeProviderAdmission(selected,selected,"cloud:production",a,identity);check(admitted!=null&&epoch()==++e);
 // A new Android process sees an already admitted account before normal resident startup.
 AlphaLocalAgentPlugin.stopping=false;AlphaLocalAgentPlugin.credentialShutdownRequest=-1;
 AlphaLocalAgentPlugin.PowerLaunchPin initial=AlphaLocalAgentPlugin.capturePowerLaunchPin(new android.content.Context());check(initial!=null&&initial.isCurrent());
 final String validCredential=a;final JSONObject validIdentity=identity;
 String rebound=LocalAgentProviderAdmission.bindCloudProvider(new LocalAgentProviderAdmission.CloudBindingStore(){
  public String readProvider()throws Exception{return s.readCredentialSlot(slot);}public String readCloud()throws Exception{return s.readCredentialSlot("cloud:production");}public void assertCurrent(){}public JSONObject identity(String token){return validIdentity;}
  public String admit(String previous,String selection,String cloud,JSONObject verified)throws Exception{return s.compareExchangeProviderAdmission(previous,selection,"cloud:production",cloud,verified);}public void rollback(String binding,String previous)throws Exception{s.rollbackProviderAdmission(binding,previous);}
 },selection().getString("credentialId"),LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL,System::currentTimeMillis);
 check(!rebound.equals(admitted));check(epoch()==e);check(initial.isCurrent()); // random revision changed, authority did not
 admitted=rebound;
 String metadata=new JSONObject(a).put("expiresAt",System.currentTimeMillis()+600000).put("displayLabel","benign").toString();
 s.writeCredentialSlot("cloud:production",metadata);check(epoch()==e&&initial.isCurrent());
 s.writeCredentialSlot("cloud:production",a);check(epoch()==e&&initial.isCurrent());
 JSONObject otherIdentity=LocalAgentProviderAdmission.verifiedCloudIdentity(new JSONObject().put("id","44444444-4444-4444-8444-444444444444"));
 String other=s.compareExchangeProviderAdmission(admitted,selection().toString(),"cloud:production",a,otherIdentity);check(epoch()==++e&&!initial.isCurrent());
 admitted=s.compareExchangeProviderAdmission(other,selection().toString(),"cloud:production",a,identity);check(epoch()==++e&&!initial.isCurrent()); // account A-B-A never resurrects grant
 AlphaLocalAgentPlugin.stopping=false;AlphaLocalAgentPlugin.credentialShutdownRequest=-1;
 AlphaLocalAgentPlugin.PowerLaunchPin current=AlphaLocalAgentPlugin.capturePowerLaunchPin(new android.content.Context());check(current!=null&&current.isCurrent());
 ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.failWrite=slot; // the provider write itself, not the legacy-recovery block before it
 boolean writeFailed=false;try{s.writeCredentialSlot(slot,admitted);}catch(IllegalStateException expectedFailure){writeFailed=true;}
 check(writeFailed&&epoch()==++e&&!current.isCurrent());check(admitted.equals(s.readCredentialSlot(slot))); // uncertain/failed write fails closed
 // Same raw value still strips admission when persisted: this previously missed the mutation marker.
 s.writeCredentialSlot(slot,admitted);check(epoch()==++e);check(!s.readCredentialSlot(slot).equals(admitted));
 String stripped=s.readCredentialSlot(slot);admitted=s.compareExchangeProviderAdmission(stripped,selected,"cloud:production",a,identity);check(epoch()==++e);
 check(s.compareExchangeProviderAdmission("foreign",selected,"cloud:production",a,identity)==null);check(epoch()==e);
 s.rollbackProviderAdmission(admitted,null);check(epoch()==++e&&s.readCredentialSlot(slot)==null);
 s.writeCredentialSlot(slot,selected);check(epoch()==++e);admitted=s.compareExchangeProviderAdmission(selected,selected,"cloud:production",a,identity);check(epoch()==++e);
 s.writeCredentialSlot("cloud:production",b);check(epoch()==++e); // shutdown path + nested admission invalidation, one epoch
 check(s.providerAdmissionGeneration()==null);s.removeCredentialSlot(slot);check(epoch()==++e);
 s.rollbackProviderAdmission(admitted,null);check(epoch()==e); // no foreign replay
 s.writeCredentialSlot(slot,selection().put("model","different-model").toString());check(epoch()==++e);
 s.writeCredentialSlot(slot,selection().put("provider","cerebras").put("key","synthetic-direct-key").toString());check(epoch()==++e);
 s.writeCredentialSlot(slot,selection().put("environment","staging").toString());check(epoch()==++e);
 s.removeCredentialSlot(slot);check(epoch()==++e);
 System.out.println("PASS actual credential-store commits: "+checks+" checks; no-shutdown/write/remove/CAS/ABA/admission/rollback/stripping/shutdown paths");
 }
}`);
 const actual=['LocalAgentProviderAdmission.java','AlphaCredentialStore.java','LegacyCloudRecovery.java'].map(nativeSource);
 return [...modeled(),admission,...actual];
}

test('actual store commits advance the authority epoch for every authority mutation and no other write',{skip:jvmSkip('javac','json')},()=>{
 const work=workspace('alpha-power-commit-');
 try{
  const compiled=javac(['-cp',jsonJar,'-d',work.dir,...commitSources(work)]);
  assert.equal(compiled.status,0,compiled.stderr);
  assert.match(execFileSync(javaBinary('java'),['-cp',work.dir+':'+jsonJar,'ai.elizaresearch.alphaphone.CommitTest'],{encoding:'utf8',timeout:jvmTimeout}),/PASS actual credential-store commits/);
 }finally{rmSync(work.dir,{recursive:true,force:true});}
});

// Off CI a missing SDK skips only this compile; on CI it fails.
const noAndroidJar=process.env.CI||(androidJar&&existsSync(androidJar))?false:'Android 36 android.jar not found: set ANDROID_HOME or ANDROID_SDK_ROOT';
test('actual store, admission and extracted plugin methods compile against Android 36',{skip:jvmSkip('javac','json')||noAndroidJar},()=>{
 assert.ok(androidJar&&existsSync(androidJar),'Android 36 android.jar is required on CI: set ANDROID_HOME or ANDROID_SDK_ROOT');
 const work=workspace('alpha-power-api36-');
 try{
  const sources=commitSources(work);
  const slots=join(work.dir,'ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java');
  writeFileSync(slots,readFileSync(slots,'utf8').replace('return new AtomicFile();','return null;'));
  // The real android.jar replaces the modeled android classes; the host harness is not compiled.
  const api=sources.filter(name=>!name.startsWith(join(work.dir,'android')+'/')&&!name.endsWith('/CommitTest.java'));
  const compiled=javac(['-cp',androidJar+':'+jsonJar,'-d',join(work.dir,'out'),...api]);
  assert.equal(compiled.status,0,compiled.stderr);
 }finally{rmSync(work.dir,{recursive:true,force:true});}
});
