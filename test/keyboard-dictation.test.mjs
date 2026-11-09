import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {nativeSource,fixture,runJvm,javaBinary,sharedSpeechSource,jsonJar} from './fixtures/jvm-tools.mjs';

test('keyboard dictation fences duplicate, cancelled, replaced and changed-field/account results',()=>{
 assert.match(runJvm([nativeSource('KeyboardDictationPolicy.java'),fixture('KeyboardDictationPolicyTest.java')],'ai.elizaresearch.alphaphone.KeyboardDictationPolicyTest'),/PASS keyboard dictation/);
});
test('auxiliary voice entry is launcher-only and protected by Android binding permission',()=>{
 const manifest=readFileSync('android/app/src/launcher/AndroidManifest.xml','utf8');
 assert.match(manifest, /AlphaKeyboardDictationService[^>]+android:permission="android.permission.BIND_INPUT_METHOD"/);
 assert.doesNotMatch(readFileSync('android/app/src/main/AndroidManifest.xml','utf8'),/AlphaKeyboardDictationService/);
 const subtype=readFileSync('android/app/src/launcher/res/xml/alpha_keyboard_dictation.xml','utf8');
 assert.match(subtype,/imeSubtypeMode="voice"/);assert.match(subtype,/isAuxiliary="true"/);
 assert.match(subtype,/overridesImplicitlyEnabledSubtype="true"/);
});

test('Quint traces conform to the actual Java dictation gate at every transition',()=>{
 const work=mkdtempSync(join(tmpdir(),'keyboard-dictation-traces-'));
 try {
  const spec='specs/quint/native/KeyboardDictation.qnt',quint='node_modules/.bin/quint';
  execFileSync(quint,['test',spec,'--backend=typescript','--max-samples=1','--out-itf',join(work,'scenario_{test}_{seq}.json'),'--verbosity=0']);
  execFileSync(quint,['run',spec,'--backend=typescript','--max-samples=40','--n-traces=40','--max-steps=30','--invariant=safety','--seed=20261109','--out-itf',join(work,'sample_{seq}.json'),'--verbosity=0']);
  const num=value=>Number(value['#bigint']);
  const rows=readdirSync(work).filter(n=>n.endsWith('.json')).flatMap(n=>JSON.parse(readFileSync(join(work,n),'utf8')).states.map(s=>[s.op,num(s.inputTicket),s.sameEditor,s.account,s.phase,num(s.generation),num(s.inserted)].join(',')));
  assert.ok(rows.length>100);
  const harness=join(work,'KeyboardDictationConformance.java');
  writeFileSync(harness,`package ai.elizaresearch.alphaphone;
public final class KeyboardDictationConformance {
 public static void main(String[] args)throws Exception {
  var generation=KeyboardDictationPolicy.class.getDeclaredField("generation");generation.setAccessible(true);
  KeyboardDictationPolicy p=null;int inserted=0,checks=0;
  for(String line:java.nio.file.Files.readAllLines(java.nio.file.Path.of(args[0]))){String[] r=line.split(",");long ticket=Long.parseLong(r[1]);
   switch(r[0]){case "init":p=new KeyboardDictationPolicy();inserted=0;break;case "open":p.open();break;case "start":p.start();break;case "stop":p.stop(ticket);break;case "cancel":p.close();break;case "finish":if(p.finish(ticket,Boolean.parseBoolean(r[2]),Boolean.parseBoolean(r[3])))inserted++;break;default:throw new AssertionError(r[0]);}
   if(!p.state().name().equalsIgnoreCase(r[4])||generation.getLong(p)!=Long.parseLong(r[5])||inserted!=Integer.parseInt(r[6]))throw new AssertionError(line);checks++;
  }
  System.out.println("PASS "+checks+" actual Java transitions match Quint");
 }
}`);
  const input=join(work,'traces.csv');writeFileSync(input,rows.join('\n'));
  assert.match(runJvm([nativeSource('KeyboardDictationPolicy.java'),harness],'ai.elizaresearch.alphaphone.KeyboardDictationConformance',{args:[input]}),/actual Java transitions match Quint/);
 } finally {rmSync(work,{recursive:true,force:true});}
});

test('voice IME and Cloud adapter compile against Android API and shared real recording classes',()=>{
 const work=mkdtempSync(join(tmpdir(),'keyboard-dictation-compile-'));
 try {
  const stubs={
   'BuildConfig.java':'final class BuildConfig {static final String ELIZA_RUNTIME_PROFILE="cloud";}',
   'MainActivity.java':'final class MainActivity {static void refreshKeyboardInsets(){} static void beginKeyboardReturn(){}}',
   'AlphaLocalAgentPlugin.java':'final class AlphaLocalAgentPlugin {static long credentialAuthorityEpoch(){return 0;} static <T>T withCredentialAuthority(long epoch,java.util.concurrent.Callable<T> body)throws Exception{return body.call();}}',
   'AlphaCredentialStore.java':'final class AlphaCredentialStore {AlphaCredentialStore(android.content.Context c){} String readCredentialSlot(String slot){return null;}}',
   'LocalAgentProviderAdmission.java':'final class LocalAgentProviderAdmission {static void requireCloudVoiceSelection(String s,String id){} static boolean validProviderToken(String s,int max){return true;}}',
  };
  for(const [name,body] of Object.entries(stubs))writeFileSync(join(work,name),'package ai.elizaresearch.alphaphone;'+body);
  const revision=join(work,'NativeProviderSlot.java');writeFileSync(revision,'package ai.eliza.plugins.agent.runtime;public final class NativeProviderSlot{public static String managementRevision(String s,long epoch){return s;}}');
  const passwords=join(work,'PasswordSurfaces.java');writeFileSync(passwords,'package ai.eliza.plugins.passwords;public final class PasswordSurfaces{public static boolean visible(){return false;}}');
  const api=join(process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||join(homedir(),process.platform==='darwin'?'Library/Android/sdk':'Android/Sdk'),'platforms/android-36/android.jar');
  assert.ok(existsSync(api),'Android API36 required for actual service compile');
  const shared='vendor/eliza/plugins/plugin-local-inference/native/android/src/main/java/ai/eliza/voice/';
  execFileSync(javaBinary('javac'),['--release','17','-cp',api,'-d',work,...Object.keys(stubs).map(n=>join(work,n)),passwords,revision,sharedSpeechSource('CartesiaSpeech.java'),...['KeyboardDictationPolicy.java','KeyboardDictationCloud.java','AlphaKeyboardDictationService.java','CloudSpeechPolicy.java','CloudDeployment.java'].map(nativeSource),shared+'LocalVoiceRecording.java',shared+'RecordingPcm.java'],{stdio:'pipe',timeout:60000});
 }finally{rmSync(work,{recursive:true,force:true});}
});

test('real dictation transport preserves selected Direct/Cloud ownership and cancels stale results',()=>{
 const work=mkdtempSync(join(tmpdir(),'keyboard-dictation-authority-'));
 try {
  assert.ok(jsonJar,'Pinned host JSON dependency required');
  const stubs={
   'AlphaLocalAgentPlugin.java':`package ai.elizaresearch.alphaphone;final class AlphaLocalAgentPlugin {static long epoch;static long credentialAuthorityEpoch(){return epoch;}static <T>T withCredentialAuthority(long e,java.util.concurrent.Callable<T> body)throws Exception{if(e!=epoch)throw new SecurityException();return body.call();}}`,
   'AlphaCredentialStore.java':`package ai.elizaresearch.alphaphone;final class AlphaCredentialStore {static String provider,credential;AlphaCredentialStore(android.content.Context c){}String readCredentialSlot(String name){return name.equals("local-agent-provider:v1")?provider:credential;}}`,
   'LocalAgentProviderAdmission.java':`package ai.elizaresearch.alphaphone;final class LocalAgentProviderAdmission {static boolean validProviderToken(String s,int max){return s.matches("[!-~]{8,"+max+"}");}static void requireCloudVoiceSelection(String s,String id)throws Exception{var p=new org.json.JSONObject(s);if(!p.getString("provider").equals("elizacloud")||!id.equals(p.getString("credentialId")))throw new SecurityException();}}`,
   'NativeProviderSlot.java':`package ai.eliza.plugins.agent.runtime;public final class NativeProviderSlot{public static String managementRevision(String s,long epoch){return s+":"+epoch;}}`,
   'PasswordSurfaces.java':`package ai.eliza.plugins.passwords;public final class PasswordSurfaces{public static boolean visible(){return false;}}`,
   'RecordingPcm.java':`package ai.eliza.voice;public final class RecordingPcm{public static byte[] decode(java.io.File f,java.util.function.BooleanSupplier cancelled)throws Exception{if(cancelled.getAsBoolean())throw new java.io.IOException();return new byte[44];}}`,
   'BuildConfig.java':`package ai.elizaresearch.alphaphone;final class BuildConfig{static final String ELIZA_RUNTIME_PROFILE="cloud";}`,
  };
  for(const [name,body] of Object.entries(stubs))writeFileSync(join(work,name),body);
  const harness=join(work,'KeyboardAuthorityTest.java');
  writeFileSync(harness,`package ai.elizaresearch.alphaphone;
import java.net.*;import java.io.*;import java.nio.charset.StandardCharsets;
public final class KeyboardAuthorityTest {
 static String host,authorization;static int requests,status=200;static boolean retire;static Runnable onResponse;
 static void check(boolean value){if(!value)throw new AssertionError();}
 static void reset(boolean direct){AlphaLocalAgentPlugin.epoch++;requests=0;status=200;retire=false;onResponse=null;host=null;authorization=null;
  AlphaCredentialStore.provider=direct?"{\\"provider\\":\\"cerebras\\",\\"cartesiaKey\\":\\"direct-test-key\\"}":"{\\"provider\\":\\"elizacloud\\",\\"credentialId\\":\\"cloud-generation\\"}";
  AlphaCredentialStore.credential="{\\"credentialId\\":\\"cloud-generation\\",\\"token\\":\\"cloud-test-token\\"}";
 }
 interface Action{void run()throws Exception;}
 static void refused(Action action)throws Exception{boolean denied=false;try{action.run();}catch(Exception expected){denied=true;}check(denied);}
 public static void main(String[] args)throws Exception{
  URL.setURLStreamHandlerFactory(protocol->protocol.equals("https")?new URLStreamHandler(){protected URLConnection openConnection(URL url){requests++;host=url.getHost();return new HttpURLConnection(url){
   public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}
   public OutputStream getOutputStream(){authorization=getRequestProperty("Authorization");return new ByteArrayOutputStream();}
   public int getResponseCode(){if(retire)AlphaLocalAgentPlugin.epoch++;if(onResponse!=null)onResponse.run();return status;}
   public String getHeaderField(String key){return key.equals("X-Eliza-STT-Provider")?"cartesia":null;}
   public InputStream getInputStream(){return new ByteArrayInputStream((url.getHost().equals("api.cartesia.ai")?"{\\"text\\":\\"Direct draft\\"}":"{\\"transcript\\":\\"Cloud draft\\"}").getBytes(StandardCharsets.UTF_8));}
  };}}:null);
  reset(true);var direct=new KeyboardDictationCloud(null);check(direct.transcribe(null).equals("Direct draft"));check(requests==1&&host.equals("api.cartesia.ai")&&authorization.equals("Bearer direct-test-key"));
  reset(false);var cloud=new KeyboardDictationCloud(null);check(cloud.transcribe(null).equals("Cloud draft"));check(requests==1&&host.equals(CloudDeployment.PRODUCTION_API_HOST)&&authorization.equals("Bearer cloud-test-token"));
  reset(true);var changed=new KeyboardDictationCloud(null);AlphaCredentialStore.provider=AlphaCredentialStore.provider.replace("direct-test-key","changed-test-key");refused(changed::check);check(requests==0);
  reset(false);var account=new KeyboardDictationCloud(null);AlphaCredentialStore.credential=AlphaCredentialStore.credential.replace("cloud-generation","new-generation");refused(account::check);check(requests==0);
  reset(true);var failed=new KeyboardDictationCloud(null);status=503;refused(()->failed.transcribe(null));check(requests==1&&host.equals("api.cartesia.ai"));
  reset(true);var cancelled=new KeyboardDictationCloud(null);cancelled.cancel();refused(()->cancelled.transcribe(null));check(requests==0);
  reset(false);var late=new KeyboardDictationCloud(null);retire=true;refused(()->late.transcribe(null));check(requests==1);
  reset(true);var lateDirect=new KeyboardDictationCloud(null);onResponse=()->AlphaCredentialStore.provider=AlphaCredentialStore.provider.replace("direct-test-key","changed-test-key");refused(()->lateDirect.transcribe(null));check(requests==1);
  reset(false);AlphaCredentialStore.provider=AlphaCredentialStore.provider.replace("cloud-generation","wrong-generation");refused(()->new KeyboardDictationCloud(null));check(requests==0);
  System.out.println("PASS nine selected-route, account, revision, failure, cancellation and late-result cases");
 }
}`);
  const api=join(process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||join(homedir(),process.platform==='darwin'?'Library/Android/sdk':'Android/Sdk'),'platforms/android-36/android.jar');
  const classpath=jsonJar+':'+api;
  execFileSync(javaBinary('javac'),['--release','17','-cp',classpath,'-d',work,...Object.keys(stubs).map(n=>join(work,n)),harness,...['KeyboardDictationCloud.java','KeyboardDictationPolicy.java','CloudSpeechPolicy.java','CloudDeployment.java'].map(nativeSource),sharedSpeechSource('CartesiaSpeech.java')],{timeout:60000});
  assert.match(execFileSync(javaBinary('java'),['-cp',work+':'+classpath,'ai.elizaresearch.alphaphone.KeyboardAuthorityTest'],{encoding:'utf8',timeout:15000}),/PASS nine selected-route/);
 }finally{rmSync(work,{recursive:true,force:true});}
});
