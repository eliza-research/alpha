import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sharedSpeechSource,fixture,runJvm,jsonJarSkip} from './fixtures/jvm-tools.mjs';
function runSpeechFragment(name,source,options){
 const dir=fs.mkdtempSync(join(tmpdir(),'alpha-cloud-readiness-'));
 try{
  const java=join(dir,`${name}.java`);
  fs.writeFileSync(java,source);
  return runJvm([java],name,options);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('native streaming speech validates bounded PCM, preserves every phrase before dispatch and bounds relay renewals',()=>{
 assert.match(runJvm([sharedSpeechSource('CloudSpeechWire.java'),fixture('CloudSpeechWireTest.java')],'ai.eliza.voice.CloudSpeechWireTest'),/^PASS streaming speech.*relay renewal bounds/);
});
test('native Cloud streaming keeps credentials native and feeds PCM before provider completion',()=>{
 const source=fs.readFileSync(sharedSpeechSource('SpeechStreamBridgePlugin.java'),'utf8');
 assert.match(source,/own\.origin=cloudOrigin\(environment\)/);
 assert.match(source,/readCredential\(environment,credential,own\.epoch\)/);
 assert.match(source,/recorder==next/);
 assert.match(source,/new StreamingSpeechPlayback\(16000\*5,16000/);
 assert.match(source,/AudioTrackSpeechOutput\.open\(16000\)/);
 assert.match(source,/u\.playback\.offer\(Arrays\.copyOfRange\(samples/);
 assert.match(source,/u\.playback\.offer\(null,true\)/);
 assert.doesNotMatch(source,/MediaPlayer|FileOutputStream|android\.util\.Log/);
});
test('validated mint gets a separate relay window within the native startup and lease bounds',()=>{
 const source=fs.readFileSync(sharedSpeechSource('SpeechStreamBridgePlugin.java'),'utf8');
 const budgets=source.match(/^ private static final long HTTP_STARTUP_MS=.*$/m)?.[0];
 const start=source.indexOf('  final long startupStartedMs=');
 const end=source.indexOf('  final Runnable expiry=',start);
 const ownership=source.match(/^  void check\(\)throws IOException.*$/m)?.[0];
 assert.ok(budgets&&ownership&&start>=0&&end>start);
 assert.match(source,/mark\(own,"start"\);own\.scheduleStartupDeadline\(\)/);
 assert.match(source,/Invalid speech token"\);\s*own\.armRelayStartup\(\);own\.check\(\);mark\(own,"relay-start"\);\s*WebSocket socket=http\.newWebSocket/);
 assert.match(source,/own\.socket=socket;if\(own\.closed\.get\(\)\)socket\.cancel\(\)/);
 assert.match(runSpeechFragment('CloudSpeechStartupBudgetTest',`import java.io.IOException;
import java.net.SocketTimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
public final class CloudSpeechStartupBudgetTest {
 ${budgets}
 static final class SystemClock {static long now;static long elapsedRealtime(){return now;}}
 static final class System {static long currentTimeMillis(){return 1_000_000L+SystemClock.now;}}
 static final class Handler {
  long when;
  Runnable pending;
  void postDelayed(Runnable task,long delay){pending=task;when=SystemClock.now+delay;}
  void removeCallbacks(Runnable task){if(pending==task)pending=null;}
 }
 static final Handler main=new Handler();
 static Session session;
 static boolean destroyed,foreground=true;
 static long authority=1;
 static long authorityEpoch(){return authority;}
 static void fail(Session own,String code){own.failure=code;own.closed.set(true);main.removeCallbacks(own.deadline);}
 static final class Session {
  final long epoch=authority;
  final AtomicBoolean closed=new AtomicBoolean(),startSettled=new AtomicBoolean();
  long expiresAt;
  String failure;
  ${source.slice(start,end)}
  ${ownership}
 }
 static Session start(){
  SystemClock.now=0;authority=1;main.pending=null;
  session=new Session();session.scheduleStartupDeadline();
  if(main.when!=12_000)throw new AssertionError("credential and HTTP bound changed");
  return session;
 }
 static void mint(Session own,long at,long leaseMs)throws Exception{
  SystemClock.now=at;own.expiresAt=System.currentTimeMillis()+leaseMs;own.armRelayStartup();
 }
 static void refused(Session own,long at,long leaseMs)throws Exception{
  try{mint(own,at,leaseMs);throw new AssertionError("unexpected relay admission");}
  catch(IOException expected){}
 }
 public static void main(String[] args)throws Exception {
  Session delayed=start();Runnable oldDeadline=main.pending;
  mint(delayed,9474,60_000);
  if(main.when!=17_474)throw new AssertionError("slow mint took time away from the relay");
  SystemClock.now=12_000;oldDeadline.run();
  if(delayed.closed.get()||main.when!=17_474)throw new AssertionError("the old deadline won");
  SystemClock.now=13_474;delayed.check();delayed.startSettled.set(true);
  SystemClock.now=17_474;oldDeadline.run();
  if(delayed.closed.get())throw new AssertionError("the startup deadline killed a ready capture");

  Session neverReady=start();mint(neverReady,11_999,60_000);
  if(main.when!=19_999)throw new AssertionError("the relay escaped the whole-start bound");
  SystemClock.now=19_999;main.pending.run();
  if(!"startup-timeout".equals(neverReady.failure))throw new AssertionError("unbounded relay startup");

  Session shortLease=start();mint(shortLease,9474,500);
  if(main.when!=9974)throw new AssertionError("the relay escaped the minted expiry");
  SystemClock.now=9974;
  try{shortLease.check();throw new AssertionError("a late handler admitted expired startup");}
  catch(SocketTimeoutException expected){}
  refused(start(),12_000,60_000);
  refused(start(),9474,0);
  Session stopped=start();stopped.closed.set(true);refused(stopped,9474,60_000);
  Session changed=start();authority++;refused(changed,9474,60_000);
  java.lang.System.out.println("PASS separately bounded relay startup");
 }
}`),/^PASS separately bounded relay startup/);
});
test('duplicate STT readiness cannot restart capture or fail the live session',()=>{
 const source=fs.readFileSync(sharedSpeechSource('SpeechStreamBridgePlugin.java'),'utf8');
 const start=source.indexOf('if("connected".equals(event))');
 const end=source.indexOf('String transcript=',start);
 assert.ok(start>=0&&end>start,'the production readiness handler is present');
 assert.match(runSpeechFragment('CloudSpeechReadinessTest',`import java.io.IOException;
import java.util.ArrayDeque;
public final class CloudSpeechReadinessTest {
 static final Object media=new Object();
 static final ArrayDeque<Runnable> queued=new ArrayDeque<>();
 static final Main main=new Main();
 static int readyMarks;
 static final class Main {
  int removals;
  void removeCallbacks(Runnable deadline){removals++;}
 }
 static final class Session {
  boolean providerReady;
  int starts;
  final Runnable deadline=()->{};
  void startCapture(){starts++;}
 }
 static void mark(Session session,String stage){if(!"stt-connected".equals(stage))throw new AssertionError(stage);readyMarks++;}
 static void submit(Object executor,Runnable work,Runnable rejected){queued.add(work);}
 static void fail(Session session,String code){throw new AssertionError(code);}
 static void handle(Session own,String event)throws Exception {
  ${source.slice(start,end)}
 }
 public static void main(String[] args)throws Exception {
  Session session=new Session();
  handle(session,"connected");
  handle(session,"connected"); // before the media executor starts capture
  if(!session.providerReady||queued.size()!=1||readyMarks!=1||session.starts!=0)throw new AssertionError("readiness must queue capture once");
  queued.remove().run();
  handle(session,"connected"); // after capture is active
  if(!queued.isEmpty()||readyMarks!=1||session.starts!=1||main.removals!=1)throw new AssertionError("duplicate readiness changed the active session");
  System.out.println("PASS duplicate STT readiness");
 }
}`),/^PASS duplicate STT readiness/);
});
test('known pre-ready relay failures retain their bounded code and malformed frames still fail', {skip:jsonJarSkip},()=>{
 const source=fs.readFileSync(sharedSpeechSource('SpeechStreamBridgePlugin.java'),'utf8');
 const parser=source.indexOf('private static String preReadyError(');
 const parserEnd=source.indexOf('private final class RelayListener',parser);
 const gate=source.indexOf('if(!own.ready){',parserEnd);
 const gateEnd=source.indexOf('if("extended".equals(type))',gate);
 assert.ok(parser>=0&&parserEnd>parser&&gate>parserEnd&&gateEnd>gate);
 assert.match(runSpeechFragment('CloudSpeechStartupErrorTest',`import java.io.IOException;
import org.json.JSONObject;
public final class CloudSpeechStartupErrorTest {
 static final class Session {boolean ready;String failure;}
 static void fail(Session own,String code){own.failure=code;}
 ${source.slice(parser,parserEnd)}
 static void handle(Session own,JSONObject row)throws IOException {
  String type=row.getString("t");
  ${source.slice(gate,gateEnd)}
  throw new AssertionError("unexpected pre-ready dispatch");
 }
 static JSONObject error(String code){return new JSONObject().put("t","error").put("code",code);}
 static void expect(JSONObject row,String code)throws Exception {
  Session own=new Session();handle(own,row);
  if(!code.equals(own.failure)||own.ready)throw new AssertionError("wrong startup result");
 }
 static void reject(JSONObject row)throws Exception {
  Session own=new Session();
  try{handle(own,row);throw new AssertionError("unexpected frame accepted");}
  catch(IOException expected){if(own.failure!=null||own.ready)throw new AssertionError("malformed frame changed session");}
 }
 public static void main(String[] args)throws Exception {
  for(String code:new String[]{"unauthorized","protocol","unavailable","closed"})expect(error(code),code);
  expect(error("unavailable").put("reason","insufficient_credits"),"insufficient_credits");
  reject(error("unavailable").put("message","not diagnostic data"));
  reject(error("unexpected"));
  reject(error("unauthorized").put("reason","insufficient_credits"));
  reject(error("unavailable").put("reason",1));
  reject(new JSONObject().put("t","stt").put("event",new JSONObject().put("type","connected")));
  System.out.println("PASS pre-ready typed speech errors");
 }
}`,{json:true}),/^PASS pre-ready typed speech errors/);
});
