import {sharedSpeechSource,jsonJar,upstreamAgentRuntime,nativeSource} from './fixtures/jvm-tools.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolveCloudSignatureClassifier,verifyCloudRecordingSignatures} from '../scripts/check-cloud-recording-signature.mjs';
import {voiceFakeClock} from './fixtures/shared-batch-voice.mjs';
import {cloudVoiceViewFixture} from './fixtures/cloud-voice-view.mjs';

test('one explicit Talk action starts Cloud voice and stops on account change',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true});
 try {
  f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;f.shell.state.chat='hidden';
  await f.shell.startVoice();
  assert.equal(f.shell.state.chat,'sheet','hidden Home entry reveals the active voice sheet');
  const view=f.renderChat();assert.equal(view.state,'listening');assert.equal(view.cloudDisclosureText,undefined);
  assert.notEqual(view.recoveryLabel,'Start Cloud voice');assert.equal(f.localFactories,0);assert.equal(f.box.testMocksEnabled,false);
  assert.equal(f.starts,1);assert.equal(f.localFactories,0);assert.equal(f.pairedFactories,0);
  f.credential='different-credential';f.changed();for(let i=0;i<20;i++)await f.tick();
  assert.equal(f.uploads,0);assert.equal(f.cloudSpeech,0);assert.equal(f.sends,0);
 } finally {f.close();await f.tick();}
});
test('signed-out production Cloud speech offers sign-in without microphone or local fallback',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true,account:null});
 try {f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;await f.shell.startVoice();const view=f.renderChat();assert.equal(view.state,'error');assert.equal(view.recoveryLabel,'');assert.equal(view.statusLines.length,0);assert.ok(!view.voiceDetails);assert.equal(f.accountOpens,0,'failed Talk never opens sign-in automatically');assert.equal(typeof view.recover,'function','internal recovery classification remains available to Settings');assert.equal(f.starts,0);assert.equal(f.localFactories,0);}finally{f.close();await f.tick();}
});
test('native production Cloud voice pins host and Cartesia; staging and other output providers fail closed',()=>{
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-speech-'));
 try {const binary=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
 execFileSync(binary('javac'),['--release','11','-d',out,'android/app/src/main/java/ai/elizaresearch/alphaphone/CloudDeployment.java','android/app/src/main/java/ai/elizaresearch/alphaphone/CloudSpeechPolicy.java','test/fixtures/CloudSpeechPolicyTest.java']);
 assert.match(execFileSync(binary('java'),['-cp',out,'ai.elizaresearch.alphaphone.CloudSpeechPolicyTest'],{encoding:'utf8'}),/PASS Cloud speech production host and Cartesia admission/);
 const native=fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaVoiceCloudPlugin.java','utf8');
 const upload=native.slice(native.indexOf('@PluginMethod public void transcribeRecording('),native.indexOf('@PluginMethod public void synthesize('));
 assert.match(upload,/RecordingPcm\.decode\(file,\(\)->request\.cancelled\|\|destroyed\(\)\)/,'Cloud uploads real decoded PCM rather than relabelling the MPEG_4 recorder');
 assert.match(upload,/filename=\\"recording\.wav\\"\\r\\nContent-Type: audio\/wav/);
 assert.match(upload,/finally\{Arrays\.fill\(audio,\(byte\)0\);\}/,'uploaded PCM is cleared after the request body write');
 assert.match(native,/CloudSpeechPolicy\.host\(BuildConfig\.ELIZA_RUNTIME_PROFILE,BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS,environment\)/);
 assert.match(native,/if\(!paired\)CloudSpeechPolicy\.requireProvider\(BuildConfig\.ELIZA_RUNTIME_PROFILE,c\.getHeaderField\("X-Eliza-TTS-Provider"\)\)/);
 const paired=native.slice(native.indexOf('private HttpURLConnection connectPaired(PluginCall call,boolean status,SpeechRequestGate.Request request,boolean asr)'));
 assert.match(paired,/if\(!BuildConfig\.ELIZA_DEV_ALLOW_TEST_MOCKS\)throw new IOException\("Network speech is not enabled"\)/);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});

let fileTypeModule;
try{fileTypeModule=resolveCloudSignatureClassifier();}
catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
test('Cloud signature classifier rejects actual Android mp42 header and accepts PCM WAV',{skip:!fileTypeModule?'Prepared Cloud file-type dependency unavailable':false},async()=>{
 await verifyCloudRecordingSignatures();
});

test('real native multipart method uploads decoded WAV and clears it on credential, setup, cancellation and write failures',()=>{
 const source=fs.readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaVoiceCloudPlugin.java','utf8');
 const method=source.slice(source.indexOf('@PluginMethod public void transcribeRecording('),source.indexOf('@PluginMethod public void synthesize(')).replace('@PluginMethod ','');
 const authorityStart=source.indexOf(' private void requireCloudSpeechAuthority('),authorityEnd=source.indexOf(' // Test APK',authorityStart);
 assert.ok(authorityStart>=0&&authorityEnd>authorityStart,'the actual native route/authority gate is included');
 const authority=source.slice(authorityStart,authorityEnd);
 assert.ok(jsonJar,'Cached org.json is required for the real provider-mode admission');
 const out=fs.mkdtempSync(path.join(os.tmpdir(),'alpha-cloud-wav-upload-'));
 try{
 const file=path.join(out,'CloudWavUploadTest.java');
 fs.writeFileSync(file,`package ai.elizaresearch.alphaphone;import ai.eliza.voice.CloudSpeechTimings;import java.io.*;import java.net.*;import java.util.*;import java.nio.charset.StandardCharsets;import java.util.function.BooleanSupplier;
public class CloudWavUploadTest {
 static class BuildConfig{static final String ELIZA_RUNTIME_PROFILE="cloud";}
 CloudSpeechTimings cloudTimings=new CloudSpeechTimings();boolean destroyed,protectedSurface;Object getContext(){return this;}boolean sensitiveSurfaceActive(){return protectedSurface;}String failure="";Exception error;Pending pending;Connection connection;Capture capture=new Capture();Capture recording(){return capture;}boolean destroyed(){return destroyed;}
 static class PluginCall{String getString(String key){return "credentialId".equals(key)?"fixture-cloud":"selected-recording";}String getString(String key,String fallback){return getString(key);}}
 static class AlphaLocalAgentPlugin{
  static long authority=1;
  static long credentialAuthorityEpoch(){return authority;}
  static <T>T withCredentialAuthority(long epoch,java.util.concurrent.Callable<T> action)throws Exception{
   if(epoch!=authority)throw new SecurityException("Fixture authority retired");return action.call();
  }
 }
 static class AlphaCredentialStore{
  static String selected;
  AlphaCredentialStore(Object context){}
  String readCredentialSlot(String slot){if(!"local-agent-provider:v1".equals(slot))throw new AssertionError("Unexpected credential slot");return selected;}
 }
 static class Pending{boolean cancelled;JSObject result;String failureCode;}
 static class JSObject{void put(String key,Object value){}}
 static class JSONObject{static int reads;JSONObject(String value){reads++;}Object get(String key){return "transcript";}}
 static class Capture{File file=new File("opaque-selected-recording");File selected(String id){return file;}}
 // This multipart test exercises an unsaved draft; saved-note selection is covered separately.
 static class RecordingWindow implements AutoCloseable{File file;boolean empty;void check(){}public void close(){}}
 RecordingWindow savedRecording(PluginCall call,Pending request){return null;}
 interface Work{void run(Pending request)throws Exception;}
 void submit(PluginCall call,Work work){pending=new Pending();try{if(failure.equals("authority-before"))AlphaLocalAgentPlugin.authority++;work.run(pending);}catch(Exception e){error=e;}}
 String required(String value,int limit){return value;}
 static class RecordingPcm{static byte[] last;static File selected;static String failure;static byte[] decode(File file,BooleanSupplier cancelled)throws Exception{selected=file;if("decode".equals(failure)||cancelled.getAsBoolean())throw new IOException("PRIVATE_DECODE_SENTINEL");last=new byte[]{82,73,70,70,0,0,0,0,87,65,86,69};if("authority-after-decode".equals(failure))AlphaLocalAgentPlugin.authority++;if("route-after-decode".equals(failure))AlphaCredentialStore.selected=new org.json.JSONObject().put("provider","cerebras").toString();return last;}}
 class Connection extends HttpURLConnection {
  int expectedLength;public void setFixedLengthStreamingMode(int length){expectedLength=length;}
  ByteArrayOutputStream bytes=new ByteArrayOutputStream();Connection()throws Exception{super(new URL("http://fixture.invalid"));}
  public void setRequestProperty(String key,String value){if(failure.equals("properties"))throw new IllegalStateException();super.setRequestProperty(key,value);}
  public OutputStream getOutputStream()throws IOException{if(failure.equals("output"))throw new IOException();if(failure.equals("write"))return new OutputStream(){public void write(int value)throws IOException{throw new IOException();}};return bytes;}
  public String getHeaderField(String key){if(!key.equals("X-Eliza-STT-Provider"))throw new AssertionError();return failure.equals("missing-provider")?null:failure.equals("wrong-provider")?"whisper":"cartesia";}
  public InputStream getInputStream(){return new ByteArrayInputStream("{}".getBytes(StandardCharsets.UTF_8));}
  public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
 }
 HttpURLConnection connect(PluginCall call,String route,Pending request,long epoch)throws Exception{requireCloudSpeechAuthority(call,epoch);if(!route.equals("stt"))throw new AssertionError();if(failure.equals("connect"))throw new IOException();if(failure.equals("cancel"))request.cancelled=true;return connection=new Connection();}
 void answered(HttpURLConnection c){} void answeredTimed(HttpURLConnection c,CloudSpeechTimings.Record timing){}
 byte[] read(InputStream in,int max,Pending request)throws Exception{if(failure.equals("response"))throw new IOException("PRIVATE_RESPONSE_SENTINEL");byte[] result=in.readAllBytes();if(failure.equals("authority-before-publication"))AlphaLocalAgentPlugin.authority++;if(failure.equals("protected-before-publication"))protectedSurface=true;return result;}
 ${authority}
 ${method}
 public static void main(String[] args)throws Exception{
  for(String mode:new String[]{"","decode","connect","properties","output","write","cancel","response","missing-provider","wrong-provider","authority-before","authority-after-decode","authority-before-publication","own-mode","route-after-decode","protected-surface","protected-before-publication"}){
   CloudWavUploadTest host=new CloudWavUploadTest();host.failure=mode;host.protectedSurface=mode.equals("protected-surface");
   AlphaLocalAgentPlugin.authority=1;AlphaCredentialStore.selected=new org.json.JSONObject().put("provider",mode.equals("own-mode")?"cerebras":"elizacloud").put("credentialId","fixture-cloud").toString();
   RecordingPcm.last=null;RecordingPcm.selected=null;RecordingPcm.failure=mode;JSONObject.reads=0;host.transcribeRecording(new PluginCall());
   boolean beforeDecode=mode.equals("authority-before")||mode.equals("own-mode")||mode.equals("protected-surface");
   if(beforeDecode&&(RecordingPcm.selected!=null||RecordingPcm.last!=null||host.connection!=null||JSONObject.reads!=0))throw new AssertionError("Refused authority reached audio or provider");
   if(!beforeDecode&&RecordingPcm.selected!=host.capture.file)throw new AssertionError("Selected recording changed");
   if(!beforeDecode&&!mode.equals("decode")&&RecordingPcm.last==null)throw new AssertionError("PCM fixture missing on "+mode);
   for(byte value:RecordingPcm.last==null?new byte[0]:RecordingPcm.last)if(value!=0)throw new AssertionError("Decoded PCM not cleared on "+mode);
   if(mode.isEmpty()){
    if(host.error!=null||host.pending.result==null)throw new AssertionError("Upload failed");
    if(host.pending.failureCode!=null)throw new AssertionError("Successful transcription kept a failure code");
    if(host.connection.expectedLength!=host.connection.bytes.size())throw new AssertionError("Wrong multipart length");
    String wire=host.connection.bytes.toString("ISO-8859-1");if(!wire.contains("name=\\\"provider\\\"\\r\\n\\r\\ncartesia\\r\\n")||wire.split("name=\\\"provider\\\"",-1).length!=2)throw new AssertionError("Missing fixed provider");if(!wire.contains("filename=\\\"recording.wav\\\"")||!wire.contains("Content-Type: audio/wav")||!wire.contains("RIFF")||!wire.contains("WAVE")||wire.contains("ftyp"))throw new AssertionError("Wrong multipart format");
   }else {
    if(host.error==null||host.pending.result!=null)throw new AssertionError("Failure was swallowed");
    if(mode.endsWith("provider")&&JSONObject.reads!=0)throw new AssertionError("Unverified transcript parsed");
    String expected=beforeDecode?null:mode.equals("decode")?"voice-stt-decode":(mode.equals("connect")||mode.endsWith("after-decode"))?"voice-stt-connect":(mode.equals("response")||mode.endsWith("provider")||mode.endsWith("before-publication"))?"voice-stt-response":"voice-stt-upload";
    if(!Objects.equals(expected,host.pending.failureCode))throw new AssertionError("Expected "+expected+" on "+mode+", got "+host.pending.failureCode);
   }
  }
  System.out.println("PASS real native multipart WAV upload and cleanup");
 }
}`);
 const binary=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
 execFileSync(binary('javac'),['--release','11','-cp',jsonJar,'-d',out,file,sharedSpeechSource('CloudSpeechTimings.java'),upstreamAgentRuntime('NativeProviderAdmission.java'),nativeSource('LocalAgentProviderAdmission.java'),'android/app/src/main/java/ai/elizaresearch/alphaphone/CloudDeployment.java','android/app/src/main/java/ai/elizaresearch/alphaphone/CloudSpeechPolicy.java']);
 assert.match(execFileSync(binary('java'),['-cp',out+path.delimiter+jsonJar,'ai.elizaresearch.alphaphone.CloudWavUploadTest'],{encoding:'utf8'}),/PASS real native multipart WAV upload and cleanup/);
 }finally{fs.rmSync(out,{recursive:true,force:true});}
});

test('Cloud voice shows finite HTTP support codes without replacing sign-in or billing recovery',()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true});
 try{
  const failure=code=>f.box.cloudVoiceFailure({code,message:'PRIVATE_HTTP_SENTINEL'});
  for(const status of [401,403])assert.equal(failure(`voice-http-${status}`),'Sign in to Cloud again in Settings, then retry voice.');
  assert.equal(failure('voice-http-402'),"Cloud declined cloud voice for your account's billing. Check your account in Settings, then retry.");
  for(const status of [400,503])assert.equal(failure(`voice-http-${status}`),`Cloud voice could not complete this request (${status}). Try again later.`);
  // A 429 is the plan's request limit (cloud-voice-limit.test.mjs covers its retry facts).
  assert.match(failure('voice-http-429'),/voice reached your plan's request limit\. Wait a moment, then try again\.$/);
  for(const code of ['voice-http-200','voice-http-600','voice-http-400PRIVATE_HTTP_SENTINEL','voice-http-400\n','voice-http-400\r\n','voice-http-400\nPRIVATE_HTTP_SENTINEL','voice-http-0400',400,null])assert.equal(failure(code),null);
 }finally{f.close();}
});

test('Cloud Notes exposes only read while idle, only Stop while live, and cancels reviewed text on leaving',async()=>{
 const f=cloudVoiceViewFixture({cloudProfile:true,holdPlayback:true});
 try {
  f.box.pendingAudioDeletions=async()=>({});
  f.shell.notes={open:'qa-note',list:[{id:'qa-note',title:'QA note',body:'Reviewed text.',updatedAt:1}]};
  let view=f.render().ed;assert.equal(view.stopReading,undefined);assert.equal(typeof view.readAloud,'function');assert.equal(view.cloudSpeechDisclosure,'Read with Eliza Cloud uploads this note’s text to your selected Cloud account for Cartesia speech and uses your plan allowance.');
  // Read-aloud sends only the note's text, on either route; own keys bill the owner's Cartesia account.
  const snapshot=f.box.connectionController.getSnapshot;f.box.connectionController.getSnapshot=()=>({...snapshot(),residentInference:'direct'});
  assert.equal(f.render().ed.cloudSpeechDisclosure,'Cartesia speech sends this note’s text using your own API key and provider allowance.');f.box.connectionController.getSnapshot=snapshot;
  view.readAloud();for(let i=0;i<20&&!f.cloudSpeech;i++)await f.tick();
  assert.equal(f.cloudSpeech,1);assert.equal(f.localFactories,0);assert.equal(f.speechInputs[0].credentialId,'cloud-credential');
  view=f.render().ed;assert.equal(typeof view.stopReading,'function');assert.equal(view.readAloud,undefined);
  view.stopReading();for(let i=0;i<10;i++)await f.tick();
  assert.equal(f.activePlayback,null);view=f.render().ed;assert.equal(view.stopReading,undefined);assert.equal(typeof view.readAloud,'function');
 }finally{f.close();await f.tick();}
});

test('Cloud profile sends one credential-bound recorded turn and speaks its matching reply without local models',async()=>{
 const clock=voiceFakeClock(),f=cloudVoiceViewFixture({cloudProfile:true,clock,peak:0.5});
 try {
  f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
  await f.shell.startVoice();await clock.flush();
  await clock.advance(700);f.peak=0;await clock.advance(1200);await clock.flush();
  assert.equal(f.uploads,1);assert.equal(f.sends,1);assert.equal(f.cloudSpeech,1);
  assert.equal(f.transcribeInput.environment,'production');assert.equal(f.transcribeInput.credentialId,'cloud-credential');
  assert.equal(f.speechInputs[0].credentialId,'cloud-credential');assert.equal(f.speechInputs[0].text,'Synthetic matching reply.');
  assert.equal(f.localFactories,0);assert.equal(f.pairedFactories,0);assert.equal(f.box.testMocksEnabled,false);
 }finally{f.close();await clock.flush();}
});


test('configured service name follows explicit Talk and signed-out recovery',async()=>{
 for(const account of ['cloud-account',null]){
  const f=cloudVoiceViewFixture({cloudProfile:true,account});
  try {
   f.box.cloudServiceName=()=> 'Nebula';
   f.box.React={createElement:()=>null};f.box.VoiceActivity=()=>null;
   await f.shell.startVoice();const view=f.renderChat();
   assert.doesNotMatch(JSON.stringify(view),/Eliza Cloud/);
   if(account){assert.equal(view.state,'listening');}
   else {assert.equal(view.state,'error');assert.equal(view.recoveryLabel,'');assert.equal(view.statusLines.length,0);assert.ok(!view.voiceDetails);assert.equal(f.accountOpens,0,'no automatic sign-in from a failed Talk');assert.equal(typeof view.recover,'function');}
   assert.equal(f.starts,account?1:0);assert.equal(f.uploads,0);assert.equal(f.localFactories,0);
  }finally{f.close();await f.tick();}
 }
});
