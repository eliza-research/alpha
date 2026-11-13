import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {app, root} from './java.mjs';

export const withdrawalSource = app + 'AlphaLocalAgentPlugin.java';
export const withdrawalWorkerSource = app + 'PluginWorkers.java';
export const withdrawalIds = [null, ...[1, 2, 3].map(id => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`)];

/** The same exact request-worker extraction as native-request-cancel, plus the real ownership
 * and surface-retirement methods. Routing, credentials, the clock and HTTP are closed ports. */
export function withdrawalPlatform(directory) {
  const source = readFileSync(join(root, withdrawalSource), 'utf8');
  assert.match(source, /workers=Executors\.newFixedThreadPool\(2\)/);
  const between = (first, last, from = 0) => {
    const start = source.indexOf(first, from), end = source.indexOf(last, start + first.length);
    assert.ok(start >= 0 && end > start, `withdrawal source anchors ${first}, ${last}`);
    return source.slice(start, end);
  };
  const line = first => between(first, '\n');
  const request = source.indexOf(' @PluginMethod public void request(');
  const ownership = between(' private void requireCurrent(', '\n\n');
  const invalidation = between(' private void invalidateOwnCalls(){', ' /** Runtime lifecycle changes');
  const deadlines = between(' private static final int LOCAL_REQUEST_TIMEOUT_LIMIT_MS=', ' @PluginMethod public void request(');
  const admission = between('  final Long deadline;', '  JSONObject headers=call.getObject("headers");', request);
  const worker = between('  JSONObject headers=call.getObject("headers");\n  final String cancelId=', ' /** Cancellation acknowledges transport closure', request);
  const java = `package ai.alphacompute.alphaphone;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;
import org.json.*;
@interface PluginMethod {}
class JSObject extends JSONObject {
 JSObject(){} JSObject(String json){super(json);}
 public JSObject put(String key,Object value){super.put(key,value);return this;}
 public JSObject put(String key,boolean value){super.put(key,value);return this;}
 public JSObject put(String key,int value){super.put(key,value);return this;}
}
class AlphaImageCapability {static boolean verified(Object context){throw new AssertionError("Telephony outside withdrawal fixture");}}
class PluginCall {
 final int id;final JSObject data;final WithdrawalHost host;
 volatile int resolves,rejects;volatile String code,reason;volatile JSObject result;
 volatile String withdrawnAt="none";
 PluginCall(int id,JSObject data,WithdrawalHost host){this.id=id;this.data=data;this.host=host;}
 String getString(String key){return data.optString(key,null);}
 String getString(String key,String fallback){return data.optString(key,fallback);}
 JSONObject getObject(String key){return data.optJSONObject(key);}
 JSONObject getData(){return data;}
 void resolve(JSObject value){answer();result=value;resolves++;}
 void reject(String message){reject(message,null);}
 void reject(String message,String why){
  answer();reason=message;code=why;
  if(id>0&&"LOCAL_AGENT_REQUEST_CANCELLED".equals(why)){withdrawnAt=host.phase(id);host.event("withdrawn");}
  else if(id>0&&"LOCAL_AGENT_EPOCH_CHANGED".equals(why))host.event("superseded");
  rejects++;
 }
 void answer(){WithdrawalHost.check(resolves+rejects==0,"Native bridge answered twice");}
}
final class WithdrawalHost {
 static final Object lifecycleLock=new Object();
 final Set<PluginCall> pending=new HashSet<>();
 final Map<String,PluginCall> withdrawable=new HashMap<>();
 final Map<String,Runnable> streamInvalidators=new HashMap<>();
 final Map<String,ClosedStream> streams=new HashMap<>();
 final ClosedReview recoveryReview=new ClosedReview();
 static final class ClosedReview {void clear(){}}
 static final class ClosedStream {void cancel(){throw new AssertionError("Stream outside plain-request fixture");}}
 boolean disposed=false,accepting=true;long lifecycleEpoch=1;String ownerIdentity="owner";
 static class Superseded extends Exception {}
 final Map<Integer,Work> work=new LinkedHashMap<>();
 final PluginCall[] calls=new PluginCall[4];
 final ThreadLocal<Integer> current=new ThreadLocal<>();
 final AtomicReference<Throwable> failure=new AtomicReference<>();
 volatile String outcome="none";volatile int eventSerial;int admitting;
 static final class Work {
  final int id;final Runnable runnable;
  final CountDownLatch enrollmentRelease=new CountDownLatch(1),transportRelease=new CountDownLatch(1);
  final AtomicInteger enrollments=new AtomicInteger(),dispatches=new AtomicInteger();
  volatile boolean started,finished,enrolling,transport;Thread thread;
  Work(int id,Runnable runnable){this.id=id;this.runnable=runnable;}
 }
 final Executor workers=runnable->{
  check(admitting>0&&!work.containsKey(admitting),"One actual queued worker per request");
  work.put(admitting,new Work(admitting,runnable));event("admitted");
 };
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 synchronized void event(String value){outcome=value;eventSerial++;}
 static void await(BooleanSupplier ready){
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
  while(!ready.getAsBoolean()){
   check(System.nanoTime()<deadline,"Controlled worker did not reach its port");
   try{Thread.sleep(1);}catch(InterruptedException error){Thread.currentThread().interrupt();throw new AssertionError(error);}
  }
 }
 static void gate(CountDownLatch latch)throws InterruptedException {
  check(latch.await(10,TimeUnit.SECONDS),"Controlled port was never released");
 }
 Object getContext(){throw new AssertionError("Telephony context outside withdrawal fixture");}
 void requireProviderOwner(boolean foreground){throw new AssertionError("Telephony ownership outside withdrawal fixture");}
 void clearEnrollment(){throw new AssertionError("401 outside successful transport fixture");}
 static void logRequestFailure(String group,String method,int status,String reason){}
 String enroll(long epoch)throws Exception {
  Work item=work.get(current.get());item.enrollments.incrementAndGet();event("enrolling");item.enrolling=true;
  gate(item.enrollmentRelease);return "fixture-token";
 }
 JSONObject raw(String path,String method,String body,String token,JSONObject headers,int timeout)throws Exception {
  Work item=work.get(current.get());
  check(path.equals("/api/status")&&method.equals("GET")&&body==null&&token.equals("fixture-token"),"Exact native transport input");
  check(timeout==120000,"The actual deadline guard supplies the transport budget");
  check(item.dispatches.incrementAndGet()==1,"A request dispatched twice");
  event("sent");item.transport=true;gate(item.transportRelease);
  return new JSONObject().put("status",200).put("body","{}");
 }
${invalidation}
${line(' private void rejectPending(')}
${ownership}
${deadlines}
 void request(PluginCall call){
  long entered=android.os.SystemClock.elapsedRealtime();
  String path=call.getString("path",""),method=call.getString("method","GET"),body=call.getString("body"),expectedOwner=call.getString("ownerId"),group=null;
  check(path.equals("/api/status")&&method.equals("GET")&&body==null,"Only admitted plain status reads are in this model");
${admission}
${worker}
 void admit(int id,JSObject input){
  check(calls[id]==null,"A request identity is fresh");
  calls[id]=new PluginCall(id,input,this);admitting=id;
  try{request(calls[id]);}finally{admitting=0;}
 }
 void take(int id){
  Work item=work.get(id);check(item!=null&&!item.started,"The selected work is actually queued");
  check(work.values().stream().filter(w->w.started&&!w.finished).count()<2,"Both real worker slots are occupied");
  item.started=true;item.thread=new Thread(()->{
   current.set(id);
   try{item.runnable.run();}catch(Throwable error){failure.compareAndSet(null,error);}
   finally{
    if(item.transport)event(calls[id].resolves==1?"resolved":"answer-discarded");
    else event(item.enrolling?"dropped-enrolling":"dropped-queued");
    item.finished=true;current.remove();
   }
  },"withdrawal-worker-"+id);
  item.thread.start();await(()->item.enrolling||item.finished);
 }
 void dispatch(int id){Work item=work.get(id);check(item.enrolling&&!item.transport&&!item.finished,"Worker is parked in real enrollment");item.enrollmentRelease.countDown();await(()->item.transport||item.finished);}
 void transportAnswers(int id){Work item=work.get(id);check(item.transport&&!item.finished,"Worker is parked in real transport");item.transportRelease.countDown();await(()->item.finished);}
 PluginCall cancel(String id){
  PluginCall call=new PluginCall(0,new JSObject().put("cancelId",id),this);cancelRequest(call);
  check(call.resolves==1&&call.rejects==0,"One cancellation acknowledgement");
  check(call.result.getString("outcome").equals("unknown"),"Withdrawal never proves server effect cancellation");
  event(call.result.getBoolean("withdrawn")?"withdrawn":"nothing-to-withdraw");return call;
 }
 void supersede(){synchronized(lifecycleLock){check(!pending.isEmpty(),"A lifecycle retirement has pending calls");invalidateOwnCalls();}}
 String phase(int id){
  Work item=work.get(id);if(item==null)return "none";
  if(!item.started)return "queued";if(item.finished)return "finished";
  if(item.transport)return "sent";if(item.enrolling)return "enrolling";
  throw new AssertionError("Worker observed between controlled ports");
 }
 String callState(int id){
  PluginCall call=calls[id];if(call==null)return "none";
  check(call.resolves+call.rejects<=1,"Native answer count");
  if(call.resolves==1)return "resolved";
  if(call.rejects==0)return "open";
  if("LOCAL_AGENT_REQUEST_CANCELLED".equals(call.code))return "withdrawn";
  if("LOCAL_AGENT_EPOCH_CHANGED".equals(call.code))return "superseded";
  throw new AssertionError("Unexpected native failure: "+call.reason);
 }
 void close(){
  synchronized(lifecycleLock){invalidateOwnCalls();}
  for(Work item:work.values()){item.enrollmentRelease.countDown();item.transportRelease.countDown();}
  for(Work item:work.values())if(item.thread!=null){try{item.thread.join(10000);}catch(InterruptedException error){throw new AssertionError(error);}check(!item.thread.isAlive(),"Worker cleanup");}
 }
}
`;
  mkdirSync(directory, {recursive: true});
  const host = join(directory, 'WithdrawalHost.java'), clock = join(directory, 'SystemClock.java');
  writeFileSync(host, java);
  writeFileSync(clock, 'package android.os;public final class SystemClock {public static long elapsedRealtime(){return 0;}}\n');
  return {paths: [host, clock], sourceSha256: createHash('sha256').update(source).digest('hex')};
}
