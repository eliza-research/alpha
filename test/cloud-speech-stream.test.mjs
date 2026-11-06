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
test('native streaming speech validates bounded PCM and preserves every phrase before dispatch',()=>{
 assert.match(runJvm([sharedSpeechSource('CloudSpeechWire.java'),fixture('CloudSpeechWireTest.java')],'ai.eliza.voice.CloudSpeechWireTest'),/^PASS streaming speech/);
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
 const gateEnd=source.indexOf('if("stt".equals(type))',gate);
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
