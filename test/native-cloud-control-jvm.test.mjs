import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runJvm,jsonJarSkip,sharedSpeechSource} from './fixtures/jvm-tools.mjs';
const javaPath='plugins/plugin-local-inference/native/android/speech-bridge/src/main/java/ai/eliza/voice/';
const speechSource=name=>process.env.SPEECH_TEST_TREE?path.join(process.env.SPEECH_TEST_TREE,javaPath,name):sharedSpeechSource(name);
const source=fs.readFileSync(speechSource('SpeechStreamBridgePlugin.java'),'utf8');
function method(s,needle){const start=s.indexOf(needle);assert.ok(start>=0,needle);let at=s.indexOf('{',start),depth=1,i=at+1;for(;depth&&i<s.length;i++){if(s[i]==='{')depth++;else if(s[i]==='}')depth--;}return s.slice(start,i);}
function jvm(name,body,{json=false}={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-native-control-'));try{const f=path.join(dir,name+'.java');fs.writeFileSync(f,body);return runJvm([f],name,{json});}finally{fs.rmSync(dir,{recursive:true,force:true});}}
test('microphone permission result cannot start after Stop, replacement, background or destruction',()=>{
 const callback=method(source,'private void microphoneReady('),stop=method(source,'public void stopCloudSpeech(');
 assert.match(jvm('PermissionControlTest',`import java.util.*;
 public class PermissionControlTest {
  static final class PluginCall {final String id;int rejects,resolves;PluginCall(String id){this.id=id;}String getString(String key){return id;}void reject(String...s){rejects++;}void resolve(){resolves++;}}
  enum PermissionState{GRANTED,DENIED}
  static final class Handler{final ArrayDeque<Runnable> pending=new ArrayDeque<>();void post(Runnable r){pending.add(r);}void run(){while(!pending.isEmpty())pending.remove().run();}}
  final Handler main=new Handler();boolean destroyed,foreground=true;PermissionState permission=PermissionState.GRANTED;PluginCall pendingStart;int starts;
  PermissionState getPermissionState(String s){return permission;}void start(PluginCall call){check(pendingStart==call,"start lost pending owner");pendingStart=null;starts++;}static class Session{}Session owned(PluginCall c){return null;}void detach(Session s){}void queueCleanup(Session s,Runnable r){r.run();}
  ${callback} ${stop}
  static void check(boolean x,String m){if(!x)throw new AssertionError(m);}
  public static void main(String[]a){
   PermissionControlTest f=new PermissionControlTest();PluginCall c=new PluginCall("one");f.pendingStart=c;f.foreground=false;f.microphoneReady(c);f.foreground=true;f.stopCloudSpeech(new PluginCall("one"));f.main.run();check(f.starts==0&&c.rejects==1,"Stop lost pending permission identity");
   f=new PermissionControlTest();c=new PluginCall("one");f.pendingStart=c;f.foreground=false;f.microphoneReady(c);f.foreground=true;f.main.run();check(f.starts==1,"permission dialog resume failed");
   f=new PermissionControlTest();c=new PluginCall("one");f.pendingStart=c;f.microphoneReady(c);f.pendingStart=new PluginCall("two");f.main.run();check(f.starts==0,"old callback replaced newer owner");
   f=new PermissionControlTest();c=new PluginCall("one");f.pendingStart=c;f.microphoneReady(c);f.destroyed=true;f.main.run();check(f.starts==0&&c.rejects==1,"destroyed callback started");
   f=new PermissionControlTest();c=new PluginCall("one");f.pendingStart=c;f.microphoneReady(c);f.foreground=false;f.main.run();check(f.starts==0&&c.rejects==1,"background callback started");
   f=new PermissionControlTest();c=new PluginCall("one");f.pendingStart=c;f.microphoneReady(c);f.stopCloudSpeech(new PluginCall("other"));f.main.run();check(f.starts==1,"unrelated Stop cancelled owner");
   f=new PermissionControlTest();c=new PluginCall("denied");f.pendingStart=c;f.permission=PermissionState.DENIED;f.microphoneReady(c);check(f.pendingStart==null&&c.rejects==1&&f.starts==0,"denial retained microphone ownership");f.permission=PermissionState.GRANTED;f.microphoneReady(c);f.main.run();check(f.starts==0&&c.rejects==1,"late callback revived denied permission");
   System.out.println("PASS permission owner cancellation and resume");
  }
 }`),/^PASS/);
});
test('PCM feeder releases the socket reader, preserves order, bounds tiny-frame tasks and erases cancelled audio',()=>{
 const feed=method(source,'private void feed('),submit=method(source,'private static boolean submit(');
 const init=/final ExecutorService feeder=([^;]+;.*?);final AtomicLong feeding=new AtomicLong\(\);/.exec(source)?.[0];assert.ok(init,'feeder executor');
 const bound=source.match(/private static final int FEED_TASKS=\d+;/)?.[0]||'private static final int FEED_TASKS=1024;';
 assert.match(jvm('FeedControlTest',`import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;
 public class FeedControlTest {
  private static final long FEED_BYTES=8*1024*1024;${bound}
  static final class CloudSpeechWire{static float[] floats(byte[]b){return new float[b.length/2];}}
  static class Playback{final CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);final List<Boolean> order=Collections.synchronizedList(new ArrayList<>());boolean offer(float[]x,boolean done)throws InterruptedException{entered.countDown();release.await();order.add(done);return true;}}
  static class Utterance{volatile boolean cancelled;final Playback playback=new Playback();}
  static class Session{final AtomicBoolean closed=new AtomicBoolean();volatile Utterance spoken;${init}}
  static final AtomicInteger failures=new AtomicInteger();void fail(Session s,String code){failures.incrementAndGet();s.closed.set(true);s.feeder.shutdown();if(s.spoken!=null)s.spoken.playback.release.countDown();}
  ${submit} ${feed}
  static void check(boolean x,String m){if(!x)throw new AssertionError(m);}
  public static void main(String[]a)throws Exception{
   FeedControlTest f=new FeedControlTest();Session s=new Session();Utterance u=new Utterance();s.spoken=u;byte[] first={1,2,3,4};long start=System.nanoTime();f.feed(s,u,first);check(System.nanoTime()-start<500_000_000L,"socket reader blocked");check(u.playback.entered.await(1,TimeUnit.SECONDS),"feeder never ran");f.feed(s,u,new byte[]{1,2});f.feed(s,u,null);u.playback.release.countDown();s.feeder.shutdown();check(s.feeder.awaitTermination(2,TimeUnit.SECONDS),"feed did not drain");check(u.playback.order.equals(Arrays.asList(false,false,true)),"completion reordered");check(s.feeding.get()==0&&Arrays.equals(first,new byte[4]),"PCM retained");
   s=new Session();u=new Utterance();s.spoken=u;f.feed(s,u,new byte[]{1,2});check(u.playback.entered.await(1,TimeUnit.SECONDS),"feeder not held");List<byte[]> buffers=new ArrayList<>();for(int i=0;i<FEED_TASKS+2;i++){byte[]b={1,2};buffers.add(b);f.feed(s,u,b);}u.playback.release.countDown();s.feeder.shutdown();check(s.feeder.awaitTermination(3,TimeUnit.SECONDS),"bounded feed did not retire");check(failures.get()>0,"tiny-frame task queue was unbounded");check(s.feeding.get()==0,"budget leaked");for(byte[]b:buffers)check(Arrays.equals(b,new byte[2]),"cancelled PCM not erased");
   s=new Session();u=new Utterance();s.spoken=u;u.cancelled=true;byte[] cancelled={1,2};f.feed(s,u,cancelled);s.feeder.shutdown();check(s.feeder.awaitTermination(1,TimeUnit.SECONDS),"cancel did not drain");check(u.playback.order.isEmpty()&&s.feeding.get()==0&&Arrays.equals(cancelled,new byte[2]),"cancelled utterance played");
   s=new Session();u=new Utterance();s.spoken=u;s.feeder.shutdown();byte[] rejected={1,2};int before=failures.get();f.feed(s,u,rejected);check(failures.get()==before+1&&s.feeding.get()==0&&Arrays.equals(rejected,new byte[2]),"rejected live feed vanished silently");
   System.out.println("PASS nonblocking bounded ordered feeder and zeroization");
  }
 }`),/^PASS/);
});
test('stream HTTP refusals bound the body and preserve only retry facts and intentional 404 fallback',()=>{
 const failure=method(source,'private static final class CloudHttpFailure'),refused=method(source,'private CloudHttpFailure refused(');
 assert.match(jvm('HttpControlTest',`import java.io.*;import java.nio.charset.StandardCharsets;
 public class HttpControlTest {
  static final class JSObject{}
  static final class ResponseBody{final int size;int read;ResponseBody(int n){size=n;}InputStream byteStream(){return new InputStream(){int at;public int read(){read++;return at++<size?'x':-1;}public int read(byte[]b){if(at>=size)return -1;int n=Math.min(b.length,size-at);java.util.Arrays.fill(b,0,n,(byte)'x');at+=n;read+=n;return n;}};}}
  static final class Response{final int status;final ResponseBody b;Response(int s,int n){status=s;b=new ResponseBody(n);}int code(){return status;}ResponseBody body(){return b;}String header(String name){return "42";}}
  String body,header;int calls;JSObject limitData(int status,String retry,String text){calls++;body=text;header=retry;return new JSObject();}
  ${failure} ${refused}
  static void check(boolean x,String m){if(!x)throw new AssertionError(m);}
  public static void main(String[]a){HttpControlTest f=new HttpControlTest();Response r=new Response(429,16384);CloudHttpFailure e=f.refused(r);check(e.code().equals("voice-http-429")&&e.data!=null&&f.body.length()==16384&&f.header.equals("42"),"bounded retry facts lost");r=new Response(429,1_000_000);f.refused(r);check(f.body==null&&r.b.read<=20480,"oversized error body read or forwarded");for(int status:new int[]{401,402,403,404,503}){r=new Response(status,1_000_000);e=f.refused(r);check(e.code().equals((status==404?"cloud-http-":"voice-http-")+status)&&e.data==null&&r.b.read==0,"HTTP parity or fallback changed");}System.out.println("PASS bounded HTTP refusal and code parity");}
 }`),/^PASS/);
});
test('relay renewal is offered-only and replaces one expiry; output bound belongs to each utterance',()=>{
 const helloAt=source.indexOf('JSONObject hello='),helloEnd=source.indexOf('own.wireToken=null;',helloAt);assert.ok(helloAt>=0&&helloEnd>helloAt);
 const hello=source.slice(helloAt,helloEnd);
 const extendedAt=source.indexOf('if("extended".equals(type))'),extended=method(source,'if("extended".equals(type))');
 const arm=method(source,'private void arm(');
 const bound=/if\(u\.finished\|\|[^;]+throw new IOException\("Invalid speech output"\);/.exec(source)?.[0];assert.ok(bound);
 const wire=fs.readFileSync(speechSource('CloudSpeechWire.java'),'utf8');
 const renewal=method(wire,'static long renewal(');
 assert.match(jvm('RenewalControlTest',`import java.util.*;import java.io.*;import java.time.*;
 public class RenewalControlTest {
  static final long FEED_BYTES=8*1024*1024;
  static class JSONObject{Map<String,Object> fields=new HashMap<>();JSONObject put(String k,Object v){fields.put(k,v);return this;}String getString(String k){return (String)fields.get(k);}}
  static final class CloudSpeechWire{static final long MAX_WINDOW_MS=65000;${renewal}}
  static class Handler{Runnable pending;int count;void removeCallbacks(Runnable r){if(pending==r)pending=null;}void postDelayed(Runnable r,long ms){pending=r;count++;}}
  final Handler main=new Handler();void mark(Session o,String s){}void retire(Session o,String s){}
  static class Session{boolean extendOffered;String wireToken="token";long expiresAt,receivedBytes;final java.util.concurrent.atomic.AtomicBoolean closed=new java.util.concurrent.atomic.AtomicBoolean();final Runnable expiry=()->{};JSONObject sent;void send(JSONObject o){sent=o;}}
  static class Utterance{boolean finished;long receivedBytes;}static class Frame{byte[]pcm=new byte[2];}
  ${arm}
  void hello(Session own){${hello}}
  void extended(Session own,JSONObject row)throws Exception{String type="extended";${extended}}
  void bound(Session own,Utterance u,Frame frame)throws Exception{${bound}}
  static void check(boolean x,String m){if(!x)throw new AssertionError(m);}
  public static void main(String[]a)throws Exception{RenewalControlTest f=new RenewalControlTest();Session s=new Session();f.hello(s);check(!s.sent.fields.containsKey("extend"),"old relay received unsupported hello key");s.extendOffered=true;f.hello(s);check(Boolean.TRUE.equals(s.sent.fields.get("extend")),"offered renewal not accepted");s.expiresAt=System.currentTimeMillis()+5000;f.arm(s);Runnable expiry=f.main.pending;f.extended(s,new JSONObject().put("expiresAt",Instant.ofEpochMilli(System.currentTimeMillis()+60000).toString()));check(f.main.pending==expiry&&f.main.count==2,"renewal did not replace expiry");s.extendOffered=false;try{f.extended(s,new JSONObject().put("expiresAt",Instant.now().plusSeconds(60).toString()));throw new AssertionError("unsolicited renewal accepted");}catch(IOException expected){}s.closed.set(true);f.arm(s);check(f.main.pending==null,"closed session rearmed");
   s=new Session();s.receivedBytes=FEED_BYTES+2;Utterance u=new Utterance();f.bound(s,u,new Frame());u.receivedBytes=FEED_BYTES;try{f.bound(s,u,new Frame());throw new AssertionError("utterance bound absent");}catch(IOException expected){}System.out.println("PASS offered-only renewal, one expiry and per-utterance output bound");}
 }`),/^PASS/);
});
test('Alpha streaming and batch 429 parsing preserves sanitized retry facts and note recovery/save claims',{skip:jsonJarSkip},()=>{
 const host=fs.readFileSync('android/app/src/main/java/ai/alphacompute/alphaphone/AlphaVoiceCloudPlugin.java','utf8');
 assert.match(host,/claimCanonicalNoteSave/);assert.match(host,/"recovery"\.equals\(reason\)/);assert.match(host,/protected JSObject limitData\(int status,String retryAfter,String body\)/);
 const limits=method(host,'static CloudVoiceLimit limitOf(String'),jsonText=method(host,'private static String jsonText(');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-limit-parity-'));try{
  const f=path.join(dir,'LimitParityTest.java');fs.writeFileSync(f,`package ai.alphacompute.alphaphone;import org.json.JSONObject;public class LimitParityTest{${limits}${jsonText}static void check(boolean b){if(!b)throw new AssertionError();}public static void main(String[]args){CloudVoiceLimit a=limitOf("42","{\\"error\\":{\\"code\\":\\"rate_limited\\",\\"retryAfterSeconds\\":3,\\"message\\":\\"PRIVATE\\"}}");check(a.retryAfterSeconds==3&&a.limitCode.equals("rate_limited"));a=limitOf("42","invalid");check(a.retryAfterSeconds==42&&a.limitCode==null);a=limitOf("42","{\\"error\\":{\\"code\\":123,\\"retryAfterSeconds\\":\\"3\\",\\"resetAt\\":null}}");check(a.retryAfterSeconds==42&&a.limitCode==null&&a.resetAt==null);System.out.println("PASS shared sanitized429parity");}}`);
  assert.match(runJvm(['android/app/src/main/java/ai/alphacompute/alphaphone/CloudVoiceLimit.java',f],'ai.alphacompute.alphaphone.LimitParityTest',{json:true}),/^PASS/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('provider switch cancels pending Cloud permission and retires old sessions without gating cleanup',()=>{
 const retirement=method(source,'protected final void retireSpeechAuthority('),stop=method(source,'public void stopCloudSpeech(');
 assert.match(jvm('ProviderRetirementTest',`public class ProviderRetirementTest {
  static class PluginCall {int rejects,resolves;String id;PluginCall(String id){this.id=id;}String getString(String key){return id;}void reject(String reason,String code){rejects++;}void resolve(){resolves++;}}
  static class Session {final String token="captured-old-fixture-token";boolean closed;}
  PluginCall pendingStart;Session session;int revoked;String revokedToken;
  Session owned(PluginCall call){return session;}
  void detach(Session s){s.closed=true;if(session==s)session=null;}
  void queueCleanup(Session s,Runnable done){revoked++;revokedToken=s.token;done.run();}
  void retire(Session s,String reason){detach(s);queueCleanup(s,()->{});}
  ${retirement}${stop}
  static void check(boolean b,String why){if(!b)throw new AssertionError(why);}
  public static void main(String[]args){ProviderRetirementTest f=new ProviderRetirementTest();PluginCall pending=new PluginCall("pending");f.pendingStart=pending;f.retireSpeechAuthority();check(f.pendingStart==null&&pending.rejects==1,"old microphone continuation survived mode switch");Session active=new Session();f.session=active;f.retireSpeechAuthority();check(active.closed&&f.revoked==1&&"captured-old-fixture-token".equals(f.revokedToken),"mode switch stranded old session cleanup");f.session=new Session();PluginCall stop=new PluginCall("active");f.stopCloudSpeech(stop);check(stop.resolves==1&&f.revoked==2,"Stop was blocked after mode switch");System.out.println("PASS pending permission, active retirement and captured-authority Stop");}
 }`),/^PASS/);
 const cleanup=method(source,'private void cleanup(');
 assert.match(cleanup,/final String token=own\.token,origin=own\.origin,id=own\.serverId/);
 assert.match(cleanup,/header\("Authorization","Bearer "\+token\)/);
 assert.doesNotMatch(cleanup,/readCredential|authorityEpoch|requireCloudVoiceSelection|own\.check/,'old captured authority remains usable only for cleanup');
});
