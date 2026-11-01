package ai.elizaresearch.alphaphone;

import ai.eliza.voice.LiveCaptureController;
import ai.eliza.voice.LocalSpeechBridgePlugin;
import ai.eliza.voice.RecordingPcm;
import ai.eliza.voice.SpeechRequestGate;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.JSONObject;

/**
 * Alpha's speech bridge. The on-device bridge (recording drafts, on-device recognition and
 * synthesis, streamed and prepared playback, audio focus, live capture with VAD and the native
 * latency collector) is the shared upstream {@link LocalSpeechBridgePlugin}. This subclass keeps
 * Alpha's bridge name, installed cache prefixes and ports (the owner's resident transport, Notes
 * audio storage, late-launch refusal), and the Alpha-only methods: browser-reading synthesis,
 * paired agent speech and the explicit Cloud voice profile.
 */
@CapacitorPlugin(name="AlphaVoiceCloud", permissions={@Permission(alias="microphone",strings={android.Manifest.permission.RECORD_AUDIO})})
public final class AlphaVoiceCloudPlugin extends LocalSpeechBridgePlugin {
 public AlphaVoiceCloudPlugin(){super("alpha-cloud-voice-","alpha-cloud-tts-");}
 // Test APK sets this directly on the plugin instance. Never exposed as a Capacitor method.
 String instrumentationBaseUrl;
 String instrumentationCredentialSlot;
 private static final int AUDIO_LIMIT=8*1024*1024;

 /** VAD segments go only to the on-device agent of the owner who started the capture. */
 @Override protected LiveCaptureController.Route residentRoute(String owner){return ()->AlphaLocalAgentPlugin.openNativeVoiceTransport(owner);}
 @Override protected boolean residentTransport(){return true;}
 /** Alpha's one refusal for a prompt the activity can no longer show; see {@link LateLaunch}. */
 @Override protected boolean launch(PluginCall call,Runnable request){return LateLaunch.ask(call,request);}

 @PluginMethod public void workflowPresentationCapabilities(PluginCall call){JSObject result=new JSObject();result.put("protocol",2);call.resolve(result);}
 /**
  * Keeps a finished draft as a Notes recording (AlphaNoteAudio owns the stored copy). The draft
  * lock is held across selection, duration and retention so a cancel or new draft cannot interleave.
  */
 @PluginMethod public void saveRecording(PluginCall call){getActivity().runOnUiThread(()->{try{String key=call.getString("recordingId");AlphaNoteAudioPlugin store=(AlphaNoteAudioPlugin)getBridge().getPlugin("AlphaNoteAudio").getInstance();ai.eliza.voice.LocalVoiceRecording drafts=recording();JSObject kept;synchronized(drafts){File chosen=drafts.selected(key);if(chosen==null)throw new IllegalStateException();kept=store.retain(chosen,key,call.getString("noteId"),drafts.durationMs(),call.getString("transcript"));}call.resolve(kept);}catch(Exception error){call.reject("The recording could not be saved. Keep this draft and retry.");}});}

 // ---- Speech plan limits (HTTP 429) ------------------------------------------------------------

 /** An HTTP 429 with its retry facts only; any other non-2xx status stays the shared voice-http-<status>. */
 private static final class VoiceHttpException extends IOException {
  final int status;final CloudVoiceLimit limit;
  VoiceHttpException(int status,CloudVoiceLimit limit){super("Voice HTTP request failed");this.status=status;this.limit=limit;}
 }
 private static void answered(HttpURLConnection c)throws Exception{int status=c.getResponseCode();if(status==429)throw new VoiceHttpException(status,limitOf(c));successful(c);}
 /** Adds only sanitized plan-limit facts after the shared bridge released admission.
  * Cancellation, destruction and all non-limit failures retain shared settlement. */
 @Override protected void rejectFailure(PluginCall call,String message,String code,Exception failure){
  if(failure instanceof VoiceHttpException){VoiceHttpException limited=(VoiceHttpException)failure;call.reject(message,"voice-http-"+limited.status,limitData(limited.limit));return;}
  super.rejectFailure(call,message,code,failure);
 }
 /** A 429's retry facts only (CloudVoiceLimit): the body is read bounded and never forwarded. */
 private static CloudVoiceLimit limitOf(HttpURLConnection c){
  String code=null,retryAt=null,resetAt=null;Number seconds=null;
  try(InputStream in=c.getErrorStream()){
   if(in!=null){ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){if(out.size()+n>16384)throw new IOException();out.write(b,0,n);}
    JSONObject body=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));JSONObject error=body.optJSONObject("error");JSONObject row=error!=null?error:body;
    code=jsonText(row,"code");retryAt=jsonText(row,"retryAt");resetAt=jsonText(row,"resetAt");
    Object value=row.opt("retryAfterSeconds");if(value instanceof Number)seconds=(Number)value;}
  }catch(Exception ignored){/* A body that is absent, oversized or not JSON leaves only Retry-After. */}
  return CloudVoiceLimit.read(c.getHeaderField("Retry-After"),code,seconds,retryAt,resetAt,System.currentTimeMillis());
 }
 /** A string member only: JSON null or a number is absent, never coerced to text ("null"). */
 private static String jsonText(JSONObject row,String key){Object value=row.opt(key);return value instanceof String?(String)value:null;}
 private static JSObject limitData(CloudVoiceLimit limit){JSObject data=new JSObject();if(limit.retryAfterSeconds!=null)data.put("retryAfterSeconds",limit.retryAfterSeconds);if(limit.limitCode!=null)data.put("limitCode",limit.limitCode);if(limit.resetAt!=null)data.put("resetAt",limit.resetAt);return data;}

 // ---- Explicit Cloud voice profile (credential-bound) -----------------------------------------

 private HttpURLConnection connect(PluginCall call,String route,SpeechRequestGate.Request request) throws Exception {
  String environment=call.getString("environment");
  String host=CloudSpeechPolicy.host(BuildConfig.ELIZA_RUNTIME_PROFILE,BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS,environment);
  AlphaConnectionPlugin store=(AlphaConnectionPlugin)getBridge().getPlugin("AlphaConnection").getInstance();
  String slot="cloud:"+environment;
  if(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS && instrumentationCredentialSlot!=null){if(!instrumentationCredentialSlot.matches("instrumentation\\.[A-Za-z0-9_-]{1,100}"))throw new IllegalArgumentException();slot=instrumentationCredentialSlot;}
  JSONObject credential=new JSONObject(store.readCredentialSlot(slot));
  String generation=required(call.getString("credentialId"),128);
  if(!generation.equals(credential.optString("credentialId")))throw new IllegalStateException("Cloud account changed");
  String token=required(credential.getString("token"),16384);
  if(token.contains("\r")||token.contains("\n"))throw new IllegalArgumentException();
  if(credential.has("expiresAt")&&credential.getLong("expiresAt")<=System.currentTimeMillis())throw new IllegalStateException();
  String base="https://"+host;
  if(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS && instrumentationBaseUrl!=null){java.net.URI test=new java.net.URI(instrumentationBaseUrl);if(!"http".equals(test.getScheme())||!"127.0.0.1".equals(test.getHost())||test.getPort()<1024||test.getRawUserInfo()!=null||test.getRawQuery()!=null||test.getRawFragment()!=null||!"".equals(test.getRawPath()))throw new IllegalArgumentException();base=instrumentationBaseUrl;}
  HttpURLConnection c=(HttpURLConnection)new URL(base+"/api/v1/voice/"+route).openConnection();request.connection=c;
  c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(120000);c.setUseCaches(false);c.setRequestMethod("POST");c.setDoOutput(true);c.setRequestProperty("Authorization","Bearer "+token);
  if(request.cancelled)throw new IOException();return c;
 }
 @PluginMethod public void transcribeRecording(PluginCall call){submit(call,request->{
  request.failureCode="voice-stt-decode";
  String recordingId=required(call.getString("recordingId"),256);File file=recording().selected(recordingId);if(file==null)throw new IOException();
  // Android's MPEG_4 recorder emits mp42, which the Cloud signature gate classifies as video.
  // Decode the selected bounded mono draft to real PCM WAV; changing its MIME label is insufficient.
  HttpURLConnection c;byte[] audio=RecordingPcm.decode(file,()->request.cancelled||destroyed());
  try{
  String boundary="AlphaVoice"+UUID.randomUUID().toString().replace("-","");
  byte[] prefix=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"provider\"\r\n\r\ncartesia\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.wav\"\r\nContent-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
  byte[] suffix=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.US_ASCII);
  request.failureCode="voice-stt-connect";c=connect(call,"stt",request);
  request.failureCode="voice-stt-upload";c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);c.setFixedLengthStreamingMode(prefix.length+audio.length+suffix.length);
  try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(prefix);out.write(audio);out.write(suffix);}
  }finally{Arrays.fill(audio,(byte)0);}
  request.failureCode="voice-stt-response";answered(c);CloudSpeechPolicy.requireProvider(BuildConfig.ELIZA_RUNTIME_PROFILE,c.getHeaderField("X-Eliza-STT-Provider"));byte[] response;try(InputStream in=c.getInputStream()){response=read(in,256*1024,request);}JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));Object transcript=data.get("transcript");if(!(transcript instanceof String))throw new IOException();
  if(request.cancelled||destroyed())throw new IOException();JSObject result=new JSObject();result.put("text",transcript);result.put("local",false);request.result=result;request.failureCode=null;
 });}
 @PluginMethod public void synthesize(PluginCall call){if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&speakerBusy()){call.reject("Speaker is in use","playback-busy");return;}synthesizeAudio(call,false,null);}

 // ---- Paired agent speech (development and hosted agents) -----------------------------------

 // Native secure-store lookup binds playback to the selected paired identity.
 private HttpURLConnection connectPaired(PluginCall call,boolean status,SpeechRequestGate.Request request,boolean asr)throws Exception{
  if(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)throw new IOException("Network speech is not enabled");
  String origin=required(call.getString("origin"),2048);java.net.URI uri=new java.net.URI(origin);
  boolean local=BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS&&"http".equals(uri.getScheme())&&Set.of("127.0.0.1","10.0.2.2").contains(uri.getHost());
  if(uri.getHost()==null||(!"https".equals(uri.getScheme())&&!local)||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||uri.getRawFragment()!=null||!"".equals(uri.getRawPath())||uri.getPort()==0||uri.getPort()>65535)throw new IllegalArgumentException();
  AlphaConnectionPlugin store=(AlphaConnectionPlugin)getBridge().getPlugin("AlphaConnection").getInstance();
  PairedAgentCredential pairedCredential=PairedAgentCredential.resolve(call,store);
  if(pairedCredential.cloud&&asr)throw new IOException("Use on-device transcription for this Cloud connection");
  String token=pairedCredential.token;
  HttpURLConnection c=(HttpURLConnection)new URL(origin+(asr?PairedSpeechContract.ASR_PATH:PairedSpeechContract.TTS_PATH)+(status?"/status":"")).openConnection();request.connection=c;
  c.setInstanceFollowRedirects(false);c.setConnectTimeout(20000);c.setReadTimeout(120000);c.setUseCaches(false);c.setRequestMethod(status?"GET":"POST");c.setDoOutput(!status);c.setRequestProperty("Authorization","Bearer "+token);
  if(pairedCredential.cloud)c.setRequestProperty("X-Eliza-Phone-Protocol","1");
  if(request.cancelled)throw new IOException();return c;
 }
 @PluginMethod public void pairedVoiceStatus(PluginCall call){submit(call,request->{
  HttpURLConnection c=connectPaired(call,true,request,false);answered(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,16384,request);}
  JSONObject body=new JSONObject(new String(response,StandardCharsets.UTF_8));JSObject value=new JSObject();value.put("ready",PairedSpeechContract.ttsReady(body));if(request.cancelled||destroyed())throw new IOException();request.result=value;
 });}
 @PluginMethod public void pairedTranscriptionStatus(PluginCall call){submit(call,request->{
  HttpURLConnection c=connectPaired(call,true,request,true);answered(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,16384,request);}JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));boolean valid=PairedSpeechContract.asrReady(data);JSObject value=new JSObject();value.put("ready",valid);value.put("provider",PairedSpeechContract.ASR_PROVIDER);if(request.cancelled||destroyed())throw new IOException();request.result=value;
 });}
 @PluginMethod public void transcribePairedRecording(PluginCall call){submit(call,request->{
  String recordingId=required(call.getString("recordingId"),256);File file=recording().selected(recordingId);if(file==null)throw new IOException();
  // Establish exact saved credential binding before decoding; no user paths or URLs are accepted.
  HttpURLConnection c=connectPaired(call,false,request,true);byte[] audio=RecordingPcm.decode(file,()->request.cancelled||destroyed());
  try{c.setRequestProperty("Content-Type","audio/wav");c.setRequestProperty("X-Request-Id",PairedSpeechContract.requestId(call.getString("requestId")));c.setFixedLengthStreamingMode(audio.length);try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(audio);}}finally{Arrays.fill(audio,(byte)0);}
  answered(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,128*1024,request);}JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));String text=PairedSpeechContract.transcript(data);if(request.cancelled||destroyed())throw new IOException();JSObject value=new JSObject();value.put("text",text);value.put("local",true);value.put("provider",PairedSpeechContract.ASR_PROVIDER);request.result=value;
 });}
 @PluginMethod public void synthesizePaired(PluginCall call){synthesizeAudio(call,true,null);}

 // ---- Browser read-aloud (reviewed passages from AlphaBrowser) --------------------------------

 @PluginMethod public void synthesizeBrowserReading(PluginCall call){mainHandler().post(()->{try{AlphaBrowserPlugin browser=(AlphaBrowserPlugin)getBridge().getPlugin("AlphaBrowser").getInstance();if("device".equals(call.getString("execution")))throw new IllegalArgumentException();String reviewed=browser.consumeReading(call);synthesizeAudio(call,true,reviewed);}catch(Exception error){call.reject("Reading approval expired");}});}
 @PluginMethod public void synthesizeLocalBrowserReading(PluginCall call){mainHandler().post(()->{try{if(!"device".equals(call.getString("execution")))throw new IllegalArgumentException();AlphaBrowserPlugin browser=(AlphaBrowserPlugin)getBridge().getPlugin("AlphaBrowser").getInstance();String reviewed=browser.consumeReading(call);synthesizeReviewed(call,reviewed);}catch(Exception error){call.reject("Reading approval expired");}});}
 void cancelBrowserSpeech(String id){cancelSpeech(id);}

 /** Cloud or paired synthesis into a prepared clip on the shared playback. */
 private void synthesizeAudio(PluginCall call,boolean paired,String reviewed){submit(call,request->{
  String text=required(reviewed==null?call.getString("text"):reviewed,5000);HttpURLConnection c=paired?connectPaired(call,false,request,false):connect(call,"tts",request);byte[] body=(paired?PairedSpeechContract.ttsBody(text):new JSONObject().put("text",text).put("format","mp3")).toString().getBytes(StandardCharsets.UTF_8);if(paired)c.setRequestProperty("X-Request-Id",PairedSpeechContract.requestId(call.getString("requestId")));c.setRequestProperty("Content-Type","application/json");c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(body);}answered(c);
  if(!paired)CloudSpeechPolicy.requireProvider(BuildConfig.ELIZA_RUNTIME_PROFILE,c.getHeaderField("X-Eliza-TTS-Provider"));
  String mime=c.getContentType();if(paired)PairedSpeechContract.ttsHeaders(call.getString("requestId"),c.getHeaderField("X-Request-Id"),c.getHeaderField("X-Eliza-Speech-Provider"),mime);if(mime==null||!Set.of("audio/mpeg","audio/mp3","audio/wav").contains(mime.split(";")[0].trim().toLowerCase(Locale.ROOT)))throw new IOException();byte[] audio;try(InputStream in=c.getInputStream()){audio=read(in,AUDIO_LIMIT,request);}if(audio.length==0)throw new IOException();
  publishPreparedAudio(call,request,audio);
 });}
}
