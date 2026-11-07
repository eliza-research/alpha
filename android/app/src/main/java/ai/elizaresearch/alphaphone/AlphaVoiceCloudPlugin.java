package ai.elizaresearch.alphaphone;

import ai.eliza.voice.LiveCaptureController;
import ai.eliza.voice.CartesiaSpeech;
import ai.eliza.voice.LocalSpeechBridgePlugin;
import ai.eliza.voice.RecordingPcm;
import ai.eliza.voice.SpeechRequestGate;
import ai.eliza.voice.CloudSpeechTimings;
import ai.eliza.voice.SpeechStreamBridgePlugin;
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
 private final CloudSpeechTimings cloudTimings=new CloudSpeechTimings();
 /** Numeric batch stages begin after worker admission; queue wait and audible playback are not claimed. */
 @PluginMethod public void cloudVoiceTiming(PluginCall call){try{call.resolve(JSObject.fromJSONObject(new JSONObject(cloudTimings.snapshot())).put("format","alpha-cloud-speech-timing-v1"));}catch(org.json.JSONException invalid){call.reject("Cloud speech timing unavailable");}}
 private void answeredTimed(HttpURLConnection connection,CloudSpeechTimings.Record timing)throws Exception{
  int status=connection.getResponseCode();cloudTimings.mark(timing,"headers");
  String provider=connection.getHeaderField("X-Eliza-STT-Provider");if(provider==null)provider=connection.getHeaderField("X-Eliza-TTS-Provider");
  cloudTimings.response(timing,status,provider,connection.getHeaderField("Server-Timing"));cloudTimings.moderation(timing,connection.getHeaderField("X-Eliza-TTS-Moderation"));answered(connection);
 }


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

 // ---- Notes recording (AlphaNoteRecorder) ----------------------------------------------------
 // No length limit; finished segments survive process death, and AlphaNoteRecordingService keeps a
 // recording going with the screen off. Segments are transcribed through the same recordingId
 // lookups as a draft: LocalVoiceRecording.selectAlso (patches/eliza/notes-recording-segments.patch).
 private volatile boolean noteForeground=true;
 /** The shared bridge's refusal code for an active call, so the renderer shows its one call line. */
 private static final String CALL_ACTIVE_CODE="call-active";
 @Override public void load(){super.load();recording().selectAlso(id->AlphaNoteRecorder.get(getContext()).segment(id));}
 @Override protected void handleOnResume(){noteForeground=true;super.handleOnResume();}
 @Override protected void handleOnPause(){noteForeground=false;super.handleOnPause();}
 private boolean callActive(){android.media.AudioManager audio=(android.media.AudioManager)getContext().getSystemService(android.content.Context.AUDIO_SERVICE);int mode=audio==null?android.media.AudioManager.MODE_NORMAL:audio.getMode();return mode==android.media.AudioManager.MODE_IN_CALL||mode==android.media.AudioManager.MODE_IN_COMMUNICATION||mode==android.media.AudioManager.MODE_RINGTONE;}
 /** The last state the notification showed, so it is rebuilt only when the state changes. */
 private volatile String lastNoteState;
 private final AlphaNoteRecorder.Listener noteRecorderEvents=status->{notifyListeners("noteRecordingChanged",status);if(!"recording".equals(status.getString("state"))&&!"paused".equals(status.getString("state")))AlphaNoteRecordingService.recordingClosed(getContext(),status.getString("recordingId"));else if(!java.util.Objects.equals(status.getString("state"),lastNoteState))AlphaNoteRecordingService.refresh(getContext());lastNoteState=status.getString("state");};
 private AlphaNoteRecorder noteRecorder(){AlphaNoteRecorder recorder=AlphaNoteRecorder.get(getContext());recorder.setListener(noteRecorderEvents);return recorder;}
 private static String noteRecordingId(PluginCall call){String value=call.getString("recordingId");if(value==null||!value.matches(AlphaNoteRecorder.ID))throw new IllegalArgumentException();return value;}
 @PluginMethod public void startNoteRecording(PluginCall call){
  if(callActive()){call.reject(CALL_MESSAGE,CALL_ACTIVE_CODE);return;}
  if(getPermissionState("microphone")!=PermissionState.GRANTED){LateLaunch.ask(call,()->requestPermissionForAlias("microphone",call,"noteMicrophonePermission"));return;}
  startNote(call);
 }
 @PermissionCallback private void noteMicrophonePermission(PluginCall call){if(getPermissionState("microphone")!=PermissionState.GRANTED){call.reject("Microphone permission denied","permission-denied");return;}startNote(call);}
 private void startNote(PluginCall call){mainHandler().post(()->{
  if(destroyed()||!noteForeground){call.reject("Recording cancelled");return;}
  try{JSObject status=noteRecorder().start();AlphaNoteRecordingService.start(getContext(),status.getString("recordingId"));call.resolve(status);}
  catch(IOException error){call.reject("storage".equals(error.getMessage())?"Storage is full":"Microphone could not start","storage".equals(error.getMessage())?"storage":"capture");}
  catch(RuntimeException error){call.reject("Microphone could not start","capture");}
 });}
 @PluginMethod public void noteRecordingStatus(PluginCall call){mainHandler().post(()->call.resolve(noteRecorder().status()));}
 @PluginMethod public void pauseNoteRecording(PluginCall call){mainHandler().post(()->{try{call.resolve(noteRecorder().pause(noteRecordingId(call)));}catch(RuntimeException error){call.reject("Recording changed");}});}
 @PluginMethod public void resumeNoteRecording(PluginCall call){
  if(callActive()){call.reject(CALL_MESSAGE,CALL_ACTIVE_CODE);return;}
  mainHandler().post(()->{try{String id=noteRecordingId(call);JSObject status=noteRecorder().resume(id);AlphaNoteRecordingService.start(getContext(),id);call.resolve(status);}
  catch(IOException error){call.reject("storage".equals(error.getMessage())?"Storage is full":"Microphone could not start","storage".equals(error.getMessage())?"storage":"capture");}
  catch(RuntimeException error){call.reject("Recording changed");}});
 }
 @PluginMethod public void stopNoteRecording(PluginCall call){mainHandler().post(()->{try{call.resolve(noteRecorder().stop(noteRecordingId(call)));}catch(RuntimeException error){call.reject("Recording changed");}});}
 @PluginMethod public void discardNoteRecording(PluginCall call){mainHandler().post(()->{AlphaNoteRecorder recorder=noteRecorder();String id=call.getString("recordingId");if(id!=null&&recorder.owns(id))recorder.discard();call.resolve(recorder.status());});}
 @PluginMethod public void setNoteSegmentText(PluginCall call){mainHandler().post(()->{try{noteRecorder().setText(noteRecordingId(call),call.getString("segmentId"),call.getString("text"));call.resolve();}catch(Exception error){call.reject("Recording changed");}});}
 /** Joins the finished segments into one recording and saves it for the note. Repeatable until discarded. */
 @PluginMethod public void saveNoteRecording(PluginCall call){
  final String id;try{id=noteRecordingId(call);}catch(RuntimeException invalid){call.reject("Invalid recording");return;}
  // Off the bridge thread, on AlphaNoteAudio's own worker; this subclass owns no worker.
  ((AlphaNoteAudioPlugin)getBridge().getPlugin("AlphaNoteAudio").getInstance()).saveNoteRecording(call,noteRecorder(),id);
 }

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
  if(failure instanceof CartesiaSpeech.HttpFailure){call.reject("Cartesia voice request failed","voice-http-"+((CartesiaSpeech.HttpFailure)failure).status);return;}
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
  CloudSpeechTimings.Record timing=cloudTimings.begin("stt");boolean completed=false;try{
  request.failureCode="voice-stt-decode";cloudTimings.mark(timing,"decode-start");
  String recordingId=required(call.getString("recordingId"),256);File file=recording().selected(recordingId);if(file==null)throw new IOException();
  // Android's MPEG_4 recorder emits mp42, which the Cloud signature gate classifies as video.
  // Decode the selected bounded mono draft to real PCM WAV; changing its MIME label is insufficient.
  HttpURLConnection c;byte[] audio=RecordingPcm.decode(file,()->request.cancelled||destroyed());cloudTimings.mark(timing,"decode-end");
  try{
  String boundary="AlphaVoice"+UUID.randomUUID().toString().replace("-","");
  byte[] prefix=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"provider\"\r\n\r\ncartesia\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.wav\"\r\nContent-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
  byte[] suffix=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.US_ASCII);
  request.failureCode="voice-stt-connect";cloudTimings.mark(timing,"upload-start");c=connect(call,"stt",request);
  request.failureCode="voice-stt-upload";c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);c.setFixedLengthStreamingMode(prefix.length+audio.length+suffix.length);
  try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(prefix);out.write(audio);out.write(suffix);}cloudTimings.mark(timing,"upload-end");
  }finally{Arrays.fill(audio,(byte)0);}
  request.failureCode="voice-stt-response";answeredTimed(c,timing);CloudSpeechPolicy.requireProvider(BuildConfig.ELIZA_RUNTIME_PROFILE,c.getHeaderField("X-Eliza-STT-Provider"));byte[] response;try(InputStream in=c.getInputStream()){response=read(in,256*1024,request);}cloudTimings.mark(timing,"body-end");JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));Object transcript=data.get("transcript");if(!(transcript instanceof String))throw new IOException();
  if(request.cancelled||destroyed())throw new IOException();JSObject result=new JSObject();result.put("text",transcript);result.put("local",false);request.result=result;request.failureCode=null;completed=true;
  }finally{cloudTimings.finish(timing,request.cancelled||destroyed()?"cancelled":completed?"completed":"failed");}
 });}
 @PluginMethod public void synthesize(PluginCall call){if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&speakerBusy()){call.reject("Speaker is in use","playback-busy");return;}synthesizeAudio(call,false,null);}

 /** Explicit own-key voice uses the shared transport inside the existing request/Stop lifecycle. */
 private final class OwnSpeech implements CartesiaSpeech.Guard {
  final SpeechRequestGate.Request request;final long epoch;final String revision,key;
  OwnSpeech(PluginCall call,SpeechRequestGate.Request request)throws Exception{
   this.request=request;epoch=AlphaLocalAgentPlugin.credentialAuthorityEpoch();revision=required(call.getString("providerRevision"),128);
   key=AlphaLocalAgentPlugin.withCredentialAuthority(epoch,()->{
    JSONObject provider=new JSONObject(new AlphaCredentialStore(getContext()).readCredentialSlot("local-agent-provider:v1"));
    if(!"cerebras".equals(provider.optString("provider"))||!revision.equals(provider.optString("revision")))throw new SecurityException("Provider changed");
    String value=provider.optString("cartesiaKey","");if(!LocalAgentProviderAdmission.validProviderToken(value,1024))throw new SecurityException("Voice is not configured");return value;
   });
  }
  public void check()throws Exception{if(request.cancelled||destroyed())throw new IOException("Speech cancelled");AlphaLocalAgentPlugin.withCredentialAuthority(epoch,()->{JSONObject provider=new JSONObject(new AlphaCredentialStore(getContext()).readCredentialSlot("local-agent-provider:v1"));if(!revision.equals(provider.optString("revision")))throw new SecurityException("Provider changed");return null;});}
  public void opened(HttpURLConnection connection)throws Exception{request.connection=connection;check();}
 }
 @PluginMethod public void transcribeOwnRecording(PluginCall call){submit(call,request->{
  OwnSpeech own=new OwnSpeech(call,request);String recordingId=required(call.getString("recordingId"),256);File file=recording().selected(recordingId);if(file==null)throw new IOException("Recording unavailable");
  byte[] wav=RecordingPcm.decode(file,()->request.cancelled||destroyed());
  try{String text=CartesiaSpeech.transcribe(own.key,wav,own,CartesiaSpeech.HTTPS);own.check();JSObject result=new JSObject();result.put("text",text);result.put("local",false);result.put("provider","cartesia");result.put("route","direct");request.result=result;}finally{Arrays.fill(wav,(byte)0);}
 });}
 @PluginMethod public void synthesizeOwn(PluginCall call){if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&speakerBusy()){call.reject("Speaker is in use","playback-busy");return;}submit(call,request->{
  OwnSpeech own=new OwnSpeech(call,request);byte[] audio=CartesiaSpeech.synthesize(own.key,required(call.getString("text"),5000),own,CartesiaSpeech.HTTPS);own.check();publishPreparedAudio(call,request,audio);
 });}

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
  CloudSpeechTimings.Record timing=paired?null:cloudTimings.begin("tts");boolean completed=false;try{
  String text=required(reviewed==null?call.getString("text"):reviewed,5000);cloudTimings.mark(timing,"upload-start");HttpURLConnection c=paired?connectPaired(call,false,request,false):connect(call,"tts",request);byte[] body=(paired?PairedSpeechContract.ttsBody(text):new JSONObject().put("text",text).put("format","mp3")).toString().getBytes(StandardCharsets.UTF_8);if(paired)c.setRequestProperty("X-Request-Id",PairedSpeechContract.requestId(call.getString("requestId")));c.setRequestProperty("Content-Type","application/json");c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(body);}cloudTimings.mark(timing,"upload-end");if(paired)answered(c);else answeredTimed(c,timing);
  if(!paired)CloudSpeechPolicy.requireProvider(BuildConfig.ELIZA_RUNTIME_PROFILE,c.getHeaderField("X-Eliza-TTS-Provider"));
  String mime=c.getContentType();if(paired)PairedSpeechContract.ttsHeaders(call.getString("requestId"),c.getHeaderField("X-Request-Id"),c.getHeaderField("X-Eliza-Speech-Provider"),mime);if(mime==null||!Set.of("audio/mpeg","audio/mp3","audio/wav").contains(mime.split(";")[0].trim().toLowerCase(Locale.ROOT)))throw new IOException();byte[] audio;try(InputStream in=c.getInputStream()){audio=read(in,AUDIO_LIMIT,request);}cloudTimings.mark(timing,"body-end");if(audio.length==0)throw new IOException();
  publishPreparedAudio(call,request,audio);completed=request.failure==null&&request.result!=null;if(completed)cloudTimings.mark(timing,"prepared");
  }finally{cloudTimings.finish(timing,request.cancelled||destroyed()?"cancelled":completed?"completed":"failed");}
 });}
 /** Product identity and encrypted account binding for the shared PCM relay. */
 @CapacitorPlugin(name="AlphaCloudSpeechStream",permissions={@Permission(alias="microphone",strings={android.Manifest.permission.RECORD_AUDIO})})
 public static final class Streaming extends SpeechStreamBridgePlugin {
  @Override protected long authorityEpoch(){return AlphaLocalAgentPlugin.credentialAuthorityEpoch();}
  @Override protected String cloudOrigin(String environment)throws Exception{return "https://"+CloudSpeechPolicy.host(BuildConfig.ELIZA_RUNTIME_PROFILE,BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS,environment);}
  @Override protected String diagnosticFormat(){return "alpha-cloud-stream-timing-v1";}
  @Override protected Credential readCredential(String environment,String expectedId,long epoch)throws Exception{
   return AlphaLocalAgentPlugin.withCredentialAuthority(epoch,()->{
    JSONObject saved=new JSONObject(new AlphaCredentialStore(getContext()).readCredentialSlot("cloud:"+environment));
    if(!expectedId.equals(saved.optString("credentialId")))throw new SecurityException("Cloud account changed");
    return new Credential(saved.getString("token"),saved.optLong("expiresAt",Long.MAX_VALUE));
   });
  }
  @Override protected boolean launch(PluginCall call,Runnable action){return LateLaunch.ask(call,action);}
 }

}
