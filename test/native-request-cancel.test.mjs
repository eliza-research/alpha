// Both ends of withdrawing a plain local-agent request. The renderer half bundles the actual
// local-agent.ts bridge over a synthetic native plugin; the native half compiles the actual
// request worker and cancelRequest from AlphaLocalAgentPlugin.java on the host JVM with finite
// Capacitor and transport fixtures. No device or runtime: neither half is Android evidence.
import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {nativeSource,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
const stub=`export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>true,getPlatform:()=>'android',convertFileSrc:value=>value};
export function registerPlugin(name){const plugins=globalThis.__alphaNativePlugins??={};return plugins[name]??={};}
export class WebPlugin {}`;
const output=await build({entryPoints:['apps/app/src/runtime/local-agent.ts'],bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env':'{}'},logLevel:'silent',
 plugins:[{name:'native-stub',setup(b){b.onResolve({filter:/^(@capacitor\/core|\.\.\/platform-plugins)$/},a=>({path:a.path,namespace:'native-stub'}));b.onLoad({filter:/.*/,namespace:'native-stub'},()=>({contents:stub,loader:'js'}));}}]});
const {LocalAgentProtocol}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const agent=globalThis.__alphaNativePlugins.Agent;

test('aborting a plain native request withdraws it by the id sent with it',async()=>{
 const requests=[],cancels=[];let settle;
 agent.request=input=>{requests.push(input);return new Promise(resolve=>{settle=resolve;});};
 agent.cancelRequest=async input=>{cancels.push(input);return {withdrawn:true};};
 const controller=new AbortController();
 const reading=new LocalAgentProtocol().request('/api/agents',undefined,controller.signal);
 assert.equal(requests.length,1);assert.match(requests[0].cancelId,/^[0-9a-f-]{36}$/);
 assert.deepEqual(cancels,[]);
 controller.abort();
 await assert.rejects(reading,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(cancels,[{cancelId:requests[0].cancelId}]);
 settle({status:200,body:'{}'});
});

test('a request that completes sends no withdrawal, and each request has its own id',async()=>{
 const requests=[],cancels=[];
 agent.request=async input=>{requests.push(input);return {status:200,body:'{"ok":true}'};};
 agent.cancelRequest=async input=>{cancels.push(input);};
 const controller=new AbortController(),protocol=new LocalAgentProtocol();
 assert.deepEqual(await protocol.request('/api/agents',undefined,controller.signal),{ok:true});
 assert.deepEqual(await protocol.request('/api/status',undefined,controller.signal),{ok:true});
 controller.abort();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(cancels,[]);
 assert.equal(requests.length,2);assert.notEqual(requests[0].cancelId,requests[1].cancelId);
});

test('a native build without cancelRequest still reports the abort',async()=>{
 agent.request=()=>new Promise(()=>{});delete agent.cancelRequest;
 const controller=new AbortController();
 const reading=new LocalAgentProtocol().request('/api/agents',undefined,controller.signal);
 controller.abort();
 await assert.rejects(reading,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));
});

test('native never dispatches a withdrawn request that is still queued or enrolling',{skip:jsonJarSkip},()=>{
 const source=fs.readFileSync(nativeSource('AlphaLocalAgentPlugin.java'),'utf8');
 const cut=(from,to,after=0)=>{const start=source.indexOf(from,after),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,`Actual source must contain ${from}`);return source.slice(start,end);};
 const methodStart=source.indexOf(' @PluginMethod public void request(');
 const worker=cut('  JSONObject headers=call.getObject("headers");\n  final String cancelId=',' /** Cancellation acknowledges transport closure',methodStart);
 const deadlines=cut(' private static final int LOCAL_REQUEST_TIMEOUT_LIMIT_MS=', ' @PluginMethod public void request(');
 const admission=cut('  final Long deadline;','  JSONObject headers=call.getObject("headers");',methodStart);
 const line=from=>cut(from,'\n');
 const ownership=[line(' private void rejectPending('),cut(' private void resolveCurrent(',' private void rejectSuperseded('),line(' private void rejectSuperseded(')].join('\n');
 assert.ok(ownership.includes('private void requireOwned('));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'request-cancel-'));
 try{
  const file=path.join(dir,'RequestCancelTest.java');
  fs.writeFileSync(file,`package ai.alphacompute.alphaphone;
import java.util.*;import java.util.concurrent.*;import org.json.*;
@interface PluginMethod {}
class JSObject extends JSONObject {JSObject(){}JSObject(String json){super(json);}public JSObject put(String k,Object v){super.put(k,v);return this;}public JSObject put(String k,boolean v){super.put(k,v);return this;}public JSObject put(String k,int v){super.put(k,v);return this;}}
class PluginCall {Map<String,String> values=new HashMap<>();int resolves,rejects;String code;JSObject result;String getString(String k){return values.get(k);}String getString(String k,String d){return values.getOrDefault(k,d);}JSONObject getObject(String k){return null;}JSONObject getData(){return new JSONObject(values);}void resolve(JSObject value){resolves++;result=value;}void reject(String why){rejects++;}void reject(String why,String reason){rejects++;code=reason;}}
public class RequestCancelTest {
 static final Object lifecycleLock=new Object();final Set<PluginCall> pending=new HashSet<>();final Map<String,PluginCall> withdrawable=new HashMap<>();
 final List<Runnable> queued=new ArrayList<>();final Executor workers=queued::add;String ownerIdentity="owner";int dispatched,enrollments;Runnable duringEnroll=()->{};
 static class Superseded extends Exception {}
 long admittedEpoch(){return 1;}void requireCurrent(long epoch){}void clearEnrollment(){}
 String enroll(long epoch){enrollments++;duringEnroll.run();return "fixture";}
 JSONObject raw(String path,String method,String body,String token,JSONObject supplied,int timeoutMs){dispatched++;return new JSONObject().put("status",200).put("body","{}");}
 static void logRequestFailure(String category,String method,int status,String reason){}
${ownership}
${deadlines}
 void request(PluginCall call){
  long entered=android.os.SystemClock.elapsedRealtime();
  String path="/api/agents",method=call.getString("method","GET"),body=call.getString("body"),expectedOwner="owner",group=null;
${admission}
${worker}
 static PluginCall call(String method,String cancelId){PluginCall c=new PluginCall();c.values.put("method",method);if(cancelId!=null)c.values.put("cancelId",cancelId);return c;}
 static PluginCall cancel(String cancelId){PluginCall c=new PluginCall();c.values.put("cancelId",cancelId);return c;}
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 void drain(){while(!queued.isEmpty())queued.remove(0).run();}
 public static void main(String[] args){
  String first="11111111-1111-4111-8111-111111111111",second="22222222-2222-4222-8222-222222222222";
  // Withdrawn while queued behind the workers: answered at once, never enrolled, never sent.
  RequestCancelTest host=new RequestCancelTest();PluginCall write=call("POST",first);write.values.put("body","{}");host.request(write);
  check(host.queued.size()==1&&host.pending.contains(write),"Request was not queued");
  PluginCall withdrawal=cancel(first);host.cancelRequest(withdrawal);
  check(write.rejects==1&&"LOCAL_AGENT_REQUEST_CANCELLED".equals(write.code)&&withdrawal.resolves==1&&withdrawal.result.getBoolean("withdrawn")&&"unknown".equals(withdrawal.result.getString("outcome")),"Withdrawal did not answer the queued request");
  host.drain();
  check(host.dispatched==0&&host.enrollments==0&&write.rejects==1&&write.resolves==0,"A withdrawn queued request reached the runtime");
  check(host.pending.isEmpty()&&host.withdrawable.isEmpty(),"Withdrawn request left bookkeeping behind");
  // Withdrawn while its worker is enrolling: the guard before dispatch stops it.
  RequestCancelTest enrolling=new RequestCancelTest();PluginCall late=call("POST",first);late.values.put("body","{}");
  enrolling.duringEnroll=()->enrolling.cancelRequest(cancel(first));enrolling.request(late);enrolling.drain();
  check(enrolling.enrollments==1&&enrolling.dispatched==0&&late.rejects==1&&late.resolves==0,"A request withdrawn during enrollment was dispatched");
  // Not withdrawn: dispatched and resolved once; a later withdrawal finds nothing.
  RequestCancelTest normal=new RequestCancelTest();PluginCall read=call("GET",first),other=call("GET",second),plain=call("GET",null);
  normal.request(read);normal.request(other);normal.request(plain);
  PluginCall mine=cancel(second);normal.cancelRequest(mine);normal.drain();
  check(normal.dispatched==2&&read.resolves==1&&read.rejects==0&&plain.resolves==1&&other.rejects==1&&other.resolves==0,"Withdrawal reached a request other than the one named");
  PluginCall stale=cancel(first);normal.cancelRequest(stale);
  check(stale.resolves==1&&!stale.result.getBoolean("withdrawn")&&read.rejects==0&&normal.withdrawable.isEmpty(),"A completed request was withdrawn");
  // An id in use or malformed is refused before any work is queued.
  RequestCancelTest ids=new RequestCancelTest();PluginCall original=call("GET",first),collision=call("GET",first),malformed=call("GET","short");
  ids.request(original);ids.request(collision);ids.request(malformed);
  check(ids.queued.size()==1&&collision.rejects==1&&malformed.rejects==1&&ids.withdrawable.get(first)==original,"Duplicate or malformed withdrawal id admitted");
  System.out.println("PASS withdrawn requests are never dispatched; others are untouched");
 }
}`);
  const clock=path.join(dir,'SystemClock.java');fs.writeFileSync(clock,'package android.os;public class SystemClock {public static long elapsedRealtime(){return 0;}}');
  assert.match(runJvm([clock,file,nativeSource('PluginWorkers.java')],'ai.alphacompute.alphaphone.RequestCancelTest',{json:true}),/^PASS withdrawn requests/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
