import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {runJvm, nativeSource} from './fixtures/jvm-tools.mjs';
import {signInReadiness} from '../apps/app/src/runtime/cloud-sign-in.ts';

const read=file=>readFileSync(file,'utf8');
function between(source,start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,`${start} … ${end}`);return source.slice(a,b);
}

test('each sign-in opening refreshes methods, including after a previously unavailable host',async()=>{
 const source=read('apps/app/src/runtime/connection-ui.tsx');
 const method=between(source,'async function inAppSignInMethods(','/** A failed or cancelled step');
 const code=stripTypeScriptTypes(method,{mode:'transform'});
 const calls=[];let available=false;
 const port={status:async input=>{calls.push(input);return available?{inApp:true,email:true,google:true,phone:true}:{inApp:false,methodsKnown:false};}};
 const discover=new Function('cloudSignIn','signInReadiness','SIGN_IN_READINESS_WAIT_MS',code+';return inAppSignInMethods;')(port,signInReadiness,1000);
 assert.equal(await discover('production',new AbortController().signal),null);
 available=true;
 assert.deepEqual(await discover('production',new AbortController().signal),{email:true,google:true,phone:true});
 assert.deepEqual(calls,[{environment:'production',refresh:true},{environment:'production',refresh:true}]);
 const cancelled=new AbortController();cancelled.abort();
 assert.equal(await discover('production',cancelled.signal),null);
 assert.equal(calls.length,2,'an already-cancelled opening sends no readiness request');
});

// Execute the production readiness/cache methods with a deterministic executor and preferences.
// No Android runtime, network, login or credential storage is involved.
test('native readiness refresh replaces stale methods and coalesces concurrent callers',()=>{
 const plugin=read(nativeSource('AlphaCloudSignInPlugin.java'));
 const methods=between(plugin,' @PluginMethod public void status(',' /** The readiness observations');
 const directory=mkdtempSync(join(tmpdir(),'alpha-readiness-refresh-'));
 try{
  const context=join(directory,'Context.java'),fixture=join(directory,'ReadinessRetryTest.java');
  writeFileSync(context,'package android.content; public final class Context { public static final int MODE_PRIVATE=0; }');
  writeFileSync(fixture,`package ai.elizaresearch.alphaphone;
import java.util.*;
import java.util.concurrent.RejectedExecutionException;
public final class ReadinessRetryTest {
 @interface PluginMethod {}
 static final class PluginCall {
  boolean refresh; JSObject result;
  PluginCall(boolean refresh) { this.refresh=refresh; }
  String getString(String key,String fallback) { return fallback; }
  Boolean getBoolean(String key,boolean fallback) { return refresh; }
  void resolve(JSObject result) { if(this.result!=null)throw new AssertionError("answered twice");this.result=result; }
  void reject(String message,String code) { throw new AssertionError(code); }
 }
 static final class JSObject extends HashMap<String,Object> {
  public JSObject put(String key,Object value) { super.put(key,value);return this; }
 }
 static final class Queue {
  final List<Runnable> jobs=new ArrayList<>(); boolean reject;
  void execute(Runnable work) { if(reject)throw new RejectedExecutionException();jobs.add(work); }
  void drain() { while(!jobs.isEmpty())jobs.remove(0).run(); }
 }
 static final class Preferences {
  final Map<String,String> values=new HashMap<>();
  String getString(String key,String fallback) { return values.getOrDefault(key,fallback); }
  Preferences edit() { return this; }
  Preferences remove(String key) { values.remove(key);return this; }
  Preferences putString(String key,String value) { values.put(key,value);return this; }
  void apply() {}
 }
 static final class Host {
  final Preferences preferences=new Preferences();
  Preferences getSharedPreferences(String name,int mode) { return preferences; }
 }
 static final class Attempt { boolean google;String mfaType,phone; }
 final Object lock=new Object(); final Queue prober=new Queue();final Host host=new Host();
 final Map<CloudSignInFlow.Environment,CloudSignInReadiness.Result> readiness=new EnumMap<>(CloudSignInFlow.Environment.class);
 final Map<CloudSignInFlow.Environment,List<PluginCall>> probing=new EnumMap<>(CloudSignInFlow.Environment.class);
 static final String READINESS_PREFERENCES="readiness";
 Attempt attempt;int measurements;boolean fail;CloudSignInReadiness.Result next;
 boolean testMocks() { return false; }
 Host getContext() { return host; }
 CloudSignInReadiness.Result measure(CloudSignInFlow.Environment environment) throws Exception {
  measurements++;if(fail)throw new Exception("offline");return next;
 }
${methods}
 static void check(boolean condition,String message) { if(!condition)throw new AssertionError(message); }
 static boolean google(PluginCall call) { return call.result!=null&&Boolean.TRUE.equals(call.result.get("google")); }
 public static void main(String[] args) {
  ReadinessRetryTest host=new ReadinessRetryTest();
  CloudSignInFlow.Environment env=CloudSignInFlow.Environment.PRODUCTION;
  long now=System.currentTimeMillis();
  host.host.preferences.values.put(env.name,new CloudSignInReadiness.Result(false,false,false,true,now+600000).serialize());
  host.probe(env,null);
  check(host.prober.jobs.isEmpty()&&host.measurements==0,"startup reuses a fresh cached answer");
  host.next=new CloudSignInReadiness.Result(true,true,true,true,now+600000);
  PluginCall first=new PluginCall(true),second=new PluginCall(true),normal=new PluginCall(false);
  host.status(first);host.status(second);host.status(normal);
  check(host.prober.jobs.size()==1,"refresh callers share one probe");
  check(first.result==null&&second.result==null&&normal.result==null,"active refresh never returns the stale cache");
  check(!host.host.preferences.values.containsKey(env.name),"refresh invalidates the stored answer");
  host.prober.drain();
  check(host.measurements==1&&google(first)&&google(second)&&google(normal),"all waiting callers receive recovered methods");
  PluginCall cached=new PluginCall(false);host.status(cached);
  check(google(cached)&&host.prober.jobs.isEmpty(),"ordinary status retains caching");
  host.next=new CloudSignInReadiness.Result(true,false,false,true,now+600000);
  PluginCall revoked=new PluginCall(true);host.status(revoked);host.prober.drain();
  check(!google(revoked)&&Boolean.FALSE.equals(revoked.result.get("phone")),"refresh also removes methods no longer available");
  host.fail=true;PluginCall offline=new PluginCall(true);host.status(offline);host.prober.drain();
  check(Boolean.FALSE.equals(offline.result.get("methodsKnown")),"a failed probe has unknown methods");
  host.fail=false;host.next=new CloudSignInReadiness.Result(true,true,true,true,now+600000);
  PluginCall recovered=new PluginCall(true);host.status(recovered);host.prober.drain();
  check(google(recovered),"a retry bypasses the fresh negative cache immediately");
  host.prober.reject=true;PluginCall closed=new PluginCall(true);host.status(closed);
  check(closed.result!=null&&host.probing.isEmpty(),"executor rejection releases waiting callers");
  System.out.println("PASS native readiness retry");
 }
}`);
  assert.match(runJvm([context,fixture,...['CloudDeployment.java','CloudSignInFlow.java','CloudSignInReadiness.java'].map(nativeSource)],'ai.elizaresearch.alphaphone.ReadinessRetryTest'),/PASS native readiness retry/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
