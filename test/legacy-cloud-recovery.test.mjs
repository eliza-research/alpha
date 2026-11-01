import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {root,nativeSource,upstreamAgentRuntime,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
test('explicit native legacy recovery uses real encrypted slots and current token validation',{skip:jsonJarSkip},()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-legacy-recovery-'));
 try{
  const relative='plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java';
  const manifest=JSON.parse(readFileSync(join(root,'patches/eliza/native-manifest.json'),'utf8'));
  assert.deepEqual(manifest.patches,[],'this fixture requires the unpatched canonical slot implementation');
  assert.match(manifest.baseCommit,/^[a-f0-9]{40}$/);
  const prepared=join(root,'vendor/eliza');
  const pinned=execFileSync('git',['-C',prepared,'-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','show',manifest.baseCommit+':'+relative],{env:{...process.env,GIT_NO_LAZY_FETCH:'1',GIT_NO_REPLACE_OBJECTS:'1'}});
  assert.ok(readFileSync(join(prepared,relative)).equals(pinned),'current slot source must equal the manifest-pinned bytes; this does not qualify the broader native packaging pin');
  let source=readFileSync(join(prepared,relative),'utf8').replace('import android.security.keystore.KeyGenParameterSpec;','').replace('import android.security.keystore.KeyProperties;','');
  const start=source.indexOf(' private SecretKey key()'),end=source.indexOf(' private static Object parseJson',start);assert.ok(start>0&&end>start);
  // Host-only key acquisition adapter. AES-GCM/AAD, parsing, hashing, committed readback and CAS remain real.
  source=source.slice(0,start)+' private SecretKey key(){return new javax.crypto.spec.SecretKeySpec(new byte[32],"AES");}\n'+source.slice(end);
  const store=join(dir,'JsonCredentialSlots.java');writeFileSync(store,source);
  const atomic=join(dir,'AtomicFile.java');
  writeFileSync(atomic,readFileSync(join(root,'test/fixtures/secure-store-memory/android/util/AtomicFile.java'),'utf8').replace('public static int corruptNextCommit;','public static int corruptNextCommit; public static int failAfterStarts=-1;').replace('return new FileOutputStream(file);','if(failAfterStarts==0){failAfterStarts=-1;throw new IOException("synthetic write failure");}if(failAfterStarts>0)failAfterStarts--;return new FileOutputStream(file);'));
  const context=join(dir,'Context.java');writeFileSync(context,`package android.content;public class Context {private final java.io.File directory;public Context(java.io.File directory){this.directory=directory;}public Context getApplicationContext(){return this;}public java.io.File getNoBackupFilesDir(){return directory;}}`);
  const nativeLifecycle=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
  const powerEpoch=nativeLifecycle.match(/^ private static long powerAuthorizationMutationEpoch;$/m)?.[0];
  const authorityGetter=nativeLifecycle.match(/^ static long credentialAuthorityEpoch\(\).*$/m)?.[0];
  // The authority range also carries the shared sign-in read hook, which refuses during a mutation.
  const mutationEpoch=nativeLifecycle.match(/^ private static volatile long credentialMutationEpoch=-1;$/m)?.[0];
  const powerStart=nativeLifecycle.indexOf(' static <T> T withCredentialAuthority('),powerEnd=nativeLifecycle.indexOf(' /** A protected launch constraint',powerStart);
  assert.ok(powerEpoch&&authorityGetter&&mutationEpoch&&powerStart>0&&powerEnd>powerStart);
  const fastStart=nativeLifecycle.indexOf(' static <T> T mutateCredentials('),fastEnd=nativeLifecycle.indexOf('   startRequestId=',fastStart);
  // The fast path commits through the actual listener-owner invalidation (InvocationOwnerCache).
  const ownerCache=nativeLifecycle.match(/^ private static final InvocationOwnerCache INVOCATION_OWNER=new InvocationOwnerCache\(\);$/m)?.[0];
  const commitStart=nativeLifecycle.indexOf(' private static <T> T commitCredentials('),commitEnd=nativeLifecycle.indexOf('\n',commitStart);
  assert.ok(ownerCache&&commitStart>0&&commitEnd>commitStart);
  const intentStart=nativeLifecycle.indexOf(' static void requireCredentialIntent('),intentEnd=nativeLifecycle.indexOf('\n',intentStart);
  const bindingStart=nativeLifecycle.indexOf(' static String bindCloudProvider('),bindingEnd=nativeLifecycle.indexOf(' // The provider rules live in',bindingStart);
  assert.ok(bindingStart>0&&bindingEnd>bindingStart);
  const clearStart=nativeLifecycle.indexOf(' static NativeProviderSlot.Store providerSlot('),clearEnd=nativeLifecycle.indexOf(' /** Which surface',clearStart);
  const identityStart=nativeLifecycle.indexOf(' static JSObject providerIdentity('),identityEnd=nativeLifecycle.indexOf(' @PluginMethod public void providerStatus(',identityStart);
  assert.ok(clearStart>0&&clearEnd>clearStart&&identityStart>0&&identityEnd>identityStart);
  const jsObject=join(dir,'JSObject.java');writeFileSync(jsObject,'package com.getcapacitor;public class JSObject extends org.json.JSONObject {public JSObject(String text){super(text);}}');
  assert.ok(fastStart>0&&fastEnd>fastStart&&intentStart>0);
  // Use the actual lifecycle→vault fast path and the ACTUAL synchronized intent check.
  // Process shutdown is fixture-only; these tests do not launch or stop an Android service.
  const lifecycle=join(dir,'AlphaLocalAgentPlugin.java');writeFileSync(lifecycle,`package ai.elizaresearch.alphaphone;import android.content.Context;import org.json.JSONObject;import com.getcapacitor.JSObject;import ai.eliza.plugins.agent.runtime.NativeProviderSlot;class AlphaLocalAgentPlugin {
   static final Object lifecycleLock=new Object();static final ai.eliza.plugins.agent.runtime.CredentialIntentFence credentialIntents=new ai.eliza.plugins.agent.runtime.CredentialIntentFence(lifecycleLock);static{credentialIntents.reserve();}
   ${powerEpoch}
   ${mutationEpoch}
   ${authorityGetter}
   static long currentCredentialIntent(){return credentialIntents.current();}
   static long reserveCredentialIntent(){return credentialIntents.reserve();}
   static Runnable beforeCommit=()->{};
   ${nativeLifecycle.slice(powerStart,powerEnd)}
   ${nativeLifecycle.slice(intentStart,intentEnd)}
   interface CredentialMutation<T>{boolean requiresShutdown()throws Exception;T commit()throws Exception;}
   ${ownerCache}
   ${nativeLifecycle.slice(commitStart,commitEnd)}
   ${nativeLifecycle.slice(fastStart,fastEnd)}
    beforeCommit.run();synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){ownerBoundary(assertOwner);return mutation.commit();}
   }}
   static void ownerBoundary(Runnable owner){owner.run();}static boolean providerAdmissionReadable(){return true;}
   ${nativeLifecycle.slice(bindingStart,bindingEnd)}
   ${nativeLifecycle.slice(clearStart,clearEnd)}
   ${nativeLifecycle.slice(identityStart,identityEnd)}
  }`);
  const identity=join(dir,'AlphaConnectionPlugin.java');writeFileSync(identity,`package ai.elizaresearch.alphaphone;class AlphaConnectionPlugin {static int verified;static org.json.JSONObject readCloudIdentity(String token)throws Exception{if(Thread.holdsLock(AlphaLocalAgentPlugin.lifecycleLock)||Thread.holdsLock(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK))throw new AssertionError("HTTP held a credential lock");if(!token.equals("synthetic-test-token"))throw new AssertionError();verified++;return LocalAgentProviderAdmission.verifiedCloudIdentity(new org.json.JSONObject().put("id","22222222-2222-4222-8222-222222222222"));}}`);
  const sources=[upstreamAgentRuntime('CredentialIntentFence.java'),join(root,'vendor/eliza/plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/CredentialIntentFence.java'),upstreamAgentRuntime('NativeProviderSlot.java'),upstreamAgentRuntime('NativeRuntimeEmbeddings.java'),join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/connection/SecureSlotPolicy.java'),store,atomic,jsObject,context,lifecycle,identity,nativeSource('RendererCredentialSlots.java'),join(root,'test/fixtures/legacy-cloud-recovery/RendererRecoverySlotsTest.java'),nativeSource('GoogleWorkspaceReturn.java'),nativeSource('GoogleWorkspaceReturnFlow.java'),nativeSource('AlphaCredentialStore.java'),nativeSource('CloudDeployment.java'),join(root,'test/fixtures/legacy-cloud-recovery/StoreIntegrationTest.java'),join(root,'test/fixtures/legacy-cloud-recovery/ProviderConditionalClearTest.java'),join(root,'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java'),nativeSource('LocalAgentProviderAdmission.java'),nativeSource('LegacyCloudRecovery.java'),nativeSource('InvocationOwnerCache.java'),join(root,'test/fixtures/legacy-cloud-recovery/LegacyCloudRecoveryTest.java')];
  const result=runJvm(sources,'ai.elizaresearch.alphaphone.LegacyCloudRecoveryTest',{json:true,args:[join(dir,'slots')]});
  assert.match(result,/PASS actual AlphaCredentialStore/);
  assert.match(result,/PASS Workspace credential lifecycle and native-slot isolation/);
  assert.match(result,/PASS renderer logical and physical recovery slot isolation/);
  assert.match(result,/PASS \d+ real encrypted-slot recovery assertions/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('all explicit scoped credential and provider mutations durably suppress legacy reuse',()=>{
 const source=readFileSync(nativeSource('AlphaCredentialStore.java'),'utf8');
 const mutate=source.slice(source.indexOf('private boolean mutateSlotOnce'),source.indexOf(' void assertCurrent'));
 assert.match(mutate,/if\(conflict\)return false;\s+legacyRecovery\(\)\.block\(\);/);
 const admission=source.slice(source.indexOf(' String compareExchangeProviderAdmission'),source.indexOf(' void rollbackProviderAdmission'));
 assert.match(admission,/if\(conflict\)return false;\s+legacyRecovery\(\)\.block\(\);/);
 assert.match(source,/Snapshot before=recoveryStep\(\(\)->legacyRecovery\(\)\.snapshot\(\)\)/);
 assert.match(source,/AlphaConnectionPlugin\.readCloudIdentity\(before\.token\(\)\);[\s\S]*legacyRecovery\(\)\.commit\(before\)/);
});
test('chooser recovery continues through normal resident admission only after native success',async()=>{
 const {transformSync}=await import('esbuild');
 const source=readFileSync(join(root,'apps/app/src/runtime/connection-ui.tsx'),'utf8');
 const start=source.indexOf('  async restoreSavedSignIn()'),end=source.indexOf('  async startLocal()',start);assert.ok(start>0&&end>start);
 const method=transformSync('({'+source.slice(start,end)+'})',{loader:'ts',format:'cjs'}).code.trim().replace(/;$/,'');
 // Exercise the exact controller method, with only native and resident boundaries stubbed.
 const make=new Function('flags',`let isAndroid=flags.android??true,operation=flags.operation??null;const state={cloudAccount:flags.account??null,signIn:flags.view?{environment:flags.view}:null};let nativeCalls=0,starts=0,nativeCancels=0;const updates=[];const controller=new AbortController();const cloudSignIn={async cancel(){nativeCancels++;},async restoreSavedSignIn(){nativeCalls++;if(flags.cancel)controller.abort();if(flags.failure)throw Error('transport');return {restored:flags.restored??true};}};const residentCloudFlow=()=>true,residentEnvironment=()=>flags.environment??'production';let active={};const residentAlwaysPresent=true;const retire=()=>{active=null;};const connectResident=async signal=>{signal.throwIfAborted();starts++;active={};};const residentRecoveryMessage=()=> 'Recovery required';const update=x=>updates.push(x);const work=async(_,fn)=>{try{await fn(controller.signal)}catch{}};const subject=${method};return {subject,abort:()=>controller.abort(),read:()=>({nativeCalls,starts,nativeCancels,updates})};`);
 for(const flags of [{},{restored:false},{cancel:true},{failure:true},{android:false},{operation:{}},{account:{}},{environment:'staging'},{view:'staging'}]){
  const h=make(flags);await h.subject.restoreSavedSignIn();const result=h.read();
  assert.equal(result.starts,Object.keys(flags).length?0:1,JSON.stringify(flags));
  if(flags.android===false||flags.operation||flags.account||flags.environment||flags.view)assert.equal(result.nativeCalls,0);
  assert.equal(result.nativeCancels,flags.cancel?1:0,'UI cancellation reaches native recovery epoch');
  h.abort();await Promise.resolve();assert.equal(h.read().nativeCancels,result.nativeCancels,'finished operation removes its native cancellation listener');
 }
 assert.match(source,/snapshot\.legacySignInRecovery&&requiredSignInView\.step==='choose'/);
 assert.match(source,/current=false/);
});
test('native recovery metadata stays private and cancellation invalidates its continuation',()=>{
 const source=readFileSync(nativeSource('AlphaCloudSignInPlugin.java'),'utf8');
 const start=source.indexOf('@PluginMethod public void savedSignInRecoveryStatus'),end=source.indexOf('@Override @PluginMethod public void startGoogle',start);assert.ok(start>0&&end>start);
 const methods=source.slice(start,end);
 assert.match(methods,/\.put\("eligible",\s*store\.legacyCloudRecoveryEligible\(\)\)/);
 assert.match(methods,/AlphaLocalAgentPlugin\.reserveCredentialIntent\(\)/);
 assert.match(methods,/recoveryEpoch\s*!=\s*owner/);assert.match(methods,/AlphaLocalAgentPlugin\.requireCredentialIntent\(intent\)/);
 assert.match(methods,/\.put\("restored",\s*kept\.restoreLegacyCloudCredential\(\)\)/);
 assert.doesNotMatch(methods,/put\("(?:token|credentialId|userId|organizationId|value)"/);
 // Every shared sign-in entry point, the cancel, a browser return and each shared commit supersede a restore.
 for(const entry of ['startGoogle','startEmail','startPhone','cancel'])assert.match(source,new RegExp(`@Override @PluginMethod public void ${entry}\\(PluginCall call\\) \\{ supersedeRecovery\\(\\); super\\.${entry}\\(call\\); \\}`),entry);
 assert.match(source,/if\(pending\.sameState\(callback\)\)supersedeRecovery\(\);/);
 assert.match(source,/protected Runnable reserveCredentialCommit\(\) \{\s+supersedeRecovery\(\);/);
 const slots=readFileSync(nativeSource('RendererCredentialSlots.java'),'utf8');assert.doesNotMatch(slots,/legacy-recovery|JOURNAL/);
});
test('Restore saved sign-in around the shared sign-in client: eligible restore, cancellation, account change and retained data',()=>{
 // Host JVM: the ACTUAL AlphaCloudSignInPlugin and PluginWorkers, and the actual credential-intent
 // methods of AlphaLocalAgentPlugin, against stubs of Capacitor, the shared CloudSignInPlugin
 // (vendor/eliza packages/auth/android) and the encrypted store. No Android, Cloud or credentials.
 const dir=mkdtempSync(join(tmpdir(),'alpha-recovery-plugin-'));
 const file=(name,text)=>{const path=join(dir,name);writeFileSync(path,text);return path;};
 try{
  const lifecycle=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
  const intent=lifecycle.match(/^ static long reserveCredentialIntent\(\)\{.*\}$/m)?.[0],require=lifecycle.match(/^ static void requireCredentialIntent\(long intent\)\{.*\}$/m)?.[0];
  assert.ok(intent&&require,'actual credential-intent methods');
  const sources=[
   upstreamAgentRuntime('CredentialIntentFence.java'),join(root,'vendor/eliza/plugins/plugin-native-secure-store/android/src/main/java/ai/eliza/plugins/securestore/nativeonly/CredentialIntentFence.java'),nativeSource('AlphaCloudSignInPlugin.java'),nativeSource('PluginWorkers.java'),nativeSource('CloudDeployment.java'),
   file('Capacitor.java',`package com.getcapacitor;public class Capacitor{}`),
   file('Plugin.java',`package com.getcapacitor;public class Plugin{public android.content.Context getContext(){return new android.content.Context();}protected void handleOnNewIntent(android.content.Intent intent){}protected void handleOnDestroy(){}}`),
   file('PluginMethod.java',`package com.getcapacitor;@java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.RUNTIME)public @interface PluginMethod{}`),
   file('CapacitorPlugin.java',`package com.getcapacitor.annotation;public @interface CapacitorPlugin{String name();}`),
   file('JSObject.java',`package com.getcapacitor;public class JSObject extends java.util.HashMap<String,Object>{public JSObject put(String k,Object v){super.put(k,v);return this;}}`),
   file('PluginCall.java',`package com.getcapacitor;public class PluginCall{public final java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);public volatile JSObject result;public volatile String code;public void resolve(JSObject v){result=v;done.countDown();}public void resolve(){done.countDown();}public void reject(String message,String c){code=c;done.countDown();}}`),
   file('Context.java',`package android.content;public class Context{}`),
   file('Intent.java',`package android.content;public class Intent{private java.net.URI data;public Intent(){}public Intent(String uri){data=java.net.URI.create(uri);}public java.net.URI getData(){return data;}}`),
   file('CloudCredentialSlots.java',`package ai.eliza.auth.cloud;public interface CloudCredentialSlots{String read(String s)throws Exception;void write(String s,String v)throws Exception;void remove(String s)throws Exception;}`),
   ...['CloudSignInEnvironment.java','CloudSignInConfig.java','CloudSignInFlow.java','CloudEmailCode.java','CloudSmsCode.java'].map(name=>join(root,'vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud',name)),
   file('CloudSignInPlugin.java',`package ai.eliza.auth.cloud;import com.getcapacitor.*;public abstract class CloudSignInPlugin extends Plugin{public final java.util.List<String> calls=new java.util.concurrent.CopyOnWriteArrayList<>();
    protected abstract CloudSignInConfig registration();protected abstract CloudCredentialSlots credentials(Runnable guard);protected abstract <T> T withCredentialRead(java.util.concurrent.Callable<T> read) throws Exception;protected Runnable reserveCredentialCommit(){return()->{};}
    /** Stands in for the shared client's commit of a minted key: reserve, then write under the guard. */
    public void commitSignIn()throws Exception{Runnable check=reserveCredentialCommit();credentials(check).write("cloud:production","minted");}
    @PluginMethod public void startGoogle(PluginCall c){calls.add("startGoogle");c.resolve();}@PluginMethod public void startEmail(PluginCall c){calls.add("startEmail");c.resolve();}@PluginMethod public void startPhone(PluginCall c){calls.add("startPhone");c.resolve();}@PluginMethod public void cancel(PluginCall c){calls.add("cancel");c.resolve();}
    @Override protected void handleOnNewIntent(android.content.Intent i){calls.add("intent");}@Override protected void handleOnDestroy(){calls.add("destroy");}}`),
   file('BuildConfig.java',`package ai.elizaresearch.alphaphone;final class BuildConfig{static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=false;}`),
   file('AlphaLocalAgentPlugin.java',`package ai.elizaresearch.alphaphone;final class AlphaLocalAgentPlugin{static final Object lifecycleLock=new Object();static final ai.eliza.plugins.agent.runtime.CredentialIntentFence credentialIntents=new ai.eliza.plugins.agent.runtime.CredentialIntentFence(lifecycleLock);\n${intent}\n${require}\nstatic <T> T withCredentialRead(java.util.concurrent.Callable<T> read)throws Exception{synchronized(lifecycleLock){return read.call();}}\n}`),
   file('AlphaCredentialStore.java',`package ai.elizaresearch.alphaphone;import java.util.concurrent.*;final class AlphaCredentialStore{
    /** Synthetic encrypted vault: a retained legacy credential, and the scoped slot a restore copies it to. */
    static volatile boolean legacy=true,failRestore;static final java.util.Map<String,String> slots=new ConcurrentHashMap<>();static volatile CountDownLatch entered,release;
    final Runnable guard;AlphaCredentialStore(android.content.Context c){this(c,()->{});}AlphaCredentialStore(android.content.Context c,Runnable guard){this.guard=guard;}
    boolean legacyCloudRecoveryEligible(){guard.run();return legacy&&!slots.containsKey("cloud:production");}
    boolean restoreLegacyCloudCredential()throws Exception{if(entered!=null)entered.countDown();if(release!=null&&!release.await(5,TimeUnit.SECONDS))throw new AssertionError("release");if(failRestore)throw new Exception("identity unconfirmed");if(!legacy)return false;guard.run();slots.put("cloud:production","legacy");legacy=false;return true;}
    String readCredentialSlot(String s){return slots.get(s);}void writeCredentialSlot(String s,String v){guard.run();slots.put(s,v);}void removeCredentialSlot(String s){guard.run();slots.remove(s);}}`),
   file('RecoveryHarness.java',`package ai.elizaresearch.alphaphone;import com.getcapacitor.*;import java.util.concurrent.*;public class RecoveryHarness{
    static void check(boolean v,String why){if(!v)throw new AssertionError(why);}
    static PluginCall await(PluginCall c)throws Exception{check(c.done.await(5,TimeUnit.SECONDS),"call answered");return c;}
    static void reset(){AlphaCredentialStore.slots.clear();AlphaCredentialStore.legacy=true;AlphaCredentialStore.failRestore=false;AlphaCredentialStore.entered=new CountDownLatch(1);AlphaCredentialStore.release=new CountDownLatch(1);}
    interface Step{void run(AlphaCloudSignInPlugin p)throws Exception;}
    /** Starts a restore, holds it inside the store before its write, runs the step, then releases it. */
    static PluginCall interrupted(AlphaCloudSignInPlugin p,Step step)throws Exception{reset();PluginCall restore=new PluginCall();p.restoreSavedSignIn(restore);check(AlphaCredentialStore.entered.await(5,TimeUnit.SECONDS),"restore started");step.run(p);AlphaCredentialStore.release.countDown();return await(restore);}
    public static void main(String[] a)throws Exception{AlphaCloudSignInPlugin p=new AlphaCloudSignInPlugin();
     // The recovery worker is a non-daemon thread: always shut it down so a failed assertion ends the JVM instead of hanging it.
     try{run(p);}finally{p.handleOnDestroy();}}
    static void run(AlphaCloudSignInPlugin p)throws Exception{int n=0;
     reset();AlphaCredentialStore.release=null;PluginCall status=await(newCall(p::savedSignInRecoveryStatus));check(Boolean.TRUE.equals(status.result.get("eligible"))&&status.result.size()==1,"eligible metadata only");n++;
     PluginCall restored=await(newCall(p::restoreSavedSignIn));check(Boolean.TRUE.equals(restored.result.get("restored"))&&restored.result.size()==1,"eligible restore resolves restored only");check("legacy".equals(AlphaCredentialStore.slots.get("cloud:production"))&&!AlphaCredentialStore.legacy,"eligible saved sign-in restored");n++;
     check(Boolean.FALSE.equals(await(newCall(p::savedSignInRecoveryStatus)).result.get("eligible")),"no longer eligible after restore");n++;
     for(String entry:new String[]{"cancel","startEmail","startGoogle","startPhone"}){
      PluginCall r=interrupted(p,x->{if(entry.equals("intent"))x.handleOnNewIntent(new android.content.Intent());else{PluginCall c=new PluginCall();AlphaCloudSignInPlugin.class.getMethod(entry,PluginCall.class).invoke(x,c);await(c);}});
      check("unavailable".equals(r.code)&&r.result==null,entry+" supersedes the restore");check(AlphaCredentialStore.legacy&&AlphaCredentialStore.slots.isEmpty(),entry+": saved data retained, nothing written");check(p.calls.contains(entry),entry+" still reaches the shared client");n++;}
     for(String uri:new String[]{"https://alphacompute.ai/alphaphone/gmail/callback#state="+"A".repeat(43)+"&result=connected&connectionId=owned","https://alphacompute.ai/alphaphone/gmail/callback#state=foreign&result=failed","https://evil.test/","https://eliza.app/alphaphone/auth/callback?state="+"B".repeat(43)+"&code=foreign"}){
      String[] kept={null};PluginCall r=interrupted(p,x->{ai.eliza.auth.cloud.CloudSignInFlow.Pending waiting=ai.eliza.auth.cloud.CloudSignInFlow.Pending.create(AlphaCloudSignInPlugin.REGISTRATION.defaultEnvironment(),System.currentTimeMillis());kept[0]=waiting.serialize();AlphaCredentialStore.slots.put(AlphaCloudSignInPlugin.PENDING_SLOT,kept[0]);x.handleOnNewIntent(new android.content.Intent(uri));});
      check(Boolean.TRUE.equals(r.result.get("restored")),"foreign/Workspace intent does not supersede restore");check(kept[0].equals(AlphaCredentialStore.slots.get(AlphaCloudSignInPlugin.PENDING_SLOT)),"separate pending sign-in retained");n++;
     }
     PluginCall matching=interrupted(p,x->{ai.eliza.auth.cloud.CloudSignInFlow.Pending waiting=ai.eliza.auth.cloud.CloudSignInFlow.Pending.create(AlphaCloudSignInPlugin.REGISTRATION.defaultEnvironment(),System.currentTimeMillis());AlphaCredentialStore.slots.put(AlphaCloudSignInPlugin.PENDING_SLOT,waiting.serialize());x.handleOnNewIntent(new android.content.Intent("https://eliza.app/alphaphone/auth/callback#code=owned&state="+waiting.state));});
     check("unavailable".equals(matching.code),"own matching Cloud sign-in still supersedes restore");n++;
     PluginCall committed=interrupted(p,x->x.commitSignIn());check("unavailable".equals(committed.code),"a newer shared sign-in commit wins");check("minted".equals(AlphaCredentialStore.slots.get("cloud:production"))&&AlphaCredentialStore.legacy,"newer account kept, saved data retained");n++;
     PluginCall rebound=interrupted(p,x->AlphaLocalAgentPlugin.reserveCredentialIntent());check("unavailable".equals(rebound.code)&&AlphaCredentialStore.legacy&&AlphaCredentialStore.slots.isEmpty(),"another credential writer (resident rebind) supersedes the restore");n++;
     PluginCall[] second=new PluginCall[1];PluginCall first=interrupted(p,x->{second[0]=new PluginCall();x.restoreSavedSignIn(second[0]);await(second[0]);});check("login-active".equals(second[0].code),"one restore at a time");check(Boolean.TRUE.equals(first.result.get("restored")),"the first restore completes");n++;
     reset();AlphaCredentialStore.release=null;AlphaCredentialStore.failRestore=true;PluginCall failed=await(newCall(p::restoreSavedSignIn));check("unavailable".equals(failed.code)&&AlphaCredentialStore.legacy&&AlphaCredentialStore.slots.isEmpty(),"unconfirmed recovery retains the saved data");n++;
     AlphaCredentialStore.failRestore=false;check(Boolean.TRUE.equals(await(newCall(p::restoreSavedSignIn)).result.get("restored")),"a failed restore releases the single-flight guard");n++;
     // A caller that retries from inside the answer itself (resolve or reject) must not be refused by the restore that just finished.
     for(boolean fail:new boolean[]{true,false}){reset();AlphaCredentialStore.release=null;AlphaCredentialStore.failRestore=fail;String[] immediate={"unset"};PluginCall[] retry=new PluginCall[1];
      PluginCall chained=new PluginCall(){void again(){retry[0]=new PluginCall();p.restoreSavedSignIn(retry[0]);immediate[0]=retry[0].code;}
       @Override public void resolve(JSObject v){again();super.resolve(v);}@Override public void reject(String m,String c){again();super.reject(m,c);}};
      p.restoreSavedSignIn(chained);await(chained);check(immediate[0]==null,(fail?"a failed":"a completed")+" restore releases the single-flight guard before it answers");await(retry[0]);AlphaCredentialStore.failRestore=false;n++;}
     p.handleOnDestroy();reset();PluginCall closed=await(newCall(p::restoreSavedSignIn));check("login-active".equals(closed.code)&&AlphaCredentialStore.legacy,"closed plugin refuses restore");PluginCall closedStatus=await(newCall(p::savedSignInRecoveryStatus));check("unavailable".equals(closedStatus.code),"closed plugin answers status");n++;
     System.out.println("PASS "+n+" Restore saved sign-in assertions around the shared client");}
    interface Method{void call(PluginCall c);}static PluginCall newCall(Method m){PluginCall c=new PluginCall();m.call(c);return c;}}`),
  ];
  const result=runJvm(sources,'ai.elizaresearch.alphaphone.RecoveryHarness',{json:true});
  assert.match(result,/^PASS \d+ Restore saved sign-in assertions/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('automatic startup requests presence-only unbind; explicit provider clear retains default semantics',async()=>{
 const {transformSync}=await import('esbuild');
 const source=readFileSync(join(root,'apps/app/src/runtime/local-agent.ts'),'utf8');
 const start=source.indexOf('export async function clearLocalProvider('),end=source.indexOf('/** True only when native',start);assert.ok(start>0&&end>start);
 const code=transformSync(source.slice(start,end).replace('export ',''),{loader:'ts',format:'cjs'}).code;
 const calls=[],native={async clearProvider(input){calls.push(input);return {configured:false};}};
 const run=new Function('native',`const browserCloudResidentEnabled=false,Capacitor={isNativePlatform:()=>true},record=value=>value,localProviderStatus=async()=>({configured:false});${code};return clearLocalProvider;`)(native);
 await run();await run(true);assert.deepEqual(calls,[undefined,{onlyIfPresent:true}]);
 const ui=readFileSync(join(root,'apps/app/src/runtime/connection-ui.tsx'),'utf8');
 // The shared resident binding controller asks for a plain unbind as `unbound`: presence-only.
 assert.match(ui,/A plain unbind is a no-op \(no restart\) when no binding is stored\.\s*clearProvider:async\(_signal,reason\)=>\{await clearLocalProvider\(reason==='unbound'\);\}/);
 const plugin=readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 assert.match(plugin,/Boolean\.TRUE\.equals\(call\.getBoolean\("onlyIfPresent"\)\)/);
});
