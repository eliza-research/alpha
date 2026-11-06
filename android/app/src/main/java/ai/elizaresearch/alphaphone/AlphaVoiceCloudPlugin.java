package ai.elizaresearch.alphaphone;

import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

/** Foreground speech: on-device by default, credential-bound Cloud in the explicit Cloud profile. */
@CapacitorPlugin(name="AlphaVoiceCloud", permissions={@Permission(alias="microphone",strings={android.Manifest.permission.RECORD_AUDIO})})
public final class AlphaVoiceCloudPlugin extends Plugin {
 private AlphaCloudVoiceCapture capture;
 private final AtomicLong epoch=new AtomicLong();
 private final Map<String,Long> permissionEpochs=new ConcurrentHashMap<>();
 private final Map<String,Pending> pending=new ConcurrentHashMap<>();
 private final ExecutorService workers=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4));
 private final Handler main=new Handler(Looper.getMainLooper());
 private boolean draining; // Guarded by pending; remains closed after a drain timeout until the barrier completes.
 private final Map<PluginCall,Runnable> drainWaiters=new LinkedHashMap<>();
 private volatile File playbackFile;
 private String playbackId;
 private String playbackRequestId;
 private final CloudSpeechTimings cloudTimings=new CloudSpeechTimings();
 private CloudSpeechTimings.Record playbackTiming;
 // Issue #395: the prepared clip is a local spoken reply, and where its first audible sample is.
 private boolean playbackLocalReply;
 private VoiceLatencyTrials.Trial playbackTrial;
 private int playbackLeadIn=-1,playbackFrames,playbackRate;
 private MediaPlayer player;
 private PluginCall preparingPlayback;
 // Issue #397: the streamed local utterance (main thread, like player) and assistant-speech audio focus.
 private StreamingSpeechPlayback streamPlayback;
 private SpeechOutputWarmup outputWarmup;
 private AlphaSpeechAudioFocus focus;
 /** Bounded streamed PCM per utterance: 30 s at 24 kHz (about 2.9 MB of floats), never more. */
 static final int STREAM_CAPACITY=AlphaLocalSpeechEngine.STREAM_RATE*30;
 private volatile boolean destroyed;
 private volatile boolean speechForeground=true;
 private final AlphaLocalSpeechEngine localEngine=new AlphaLocalSpeechEngine(()->new AlphaParadeeSpeech(getContext()));
 private final Object localCancellationGate=new Object();
 private Pending localActiveRequest; // Guarded by localCancellationGate.
 private final java.util.concurrent.atomic.AtomicBoolean localReleaseQueued=new java.util.concurrent.atomic.AtomicBoolean();
 private final Runnable localIdleRelease=this::queueLocalRelease;
 private final android.content.ComponentCallbacks2 localMemoryCallbacks=new android.content.ComponentCallbacks2(){
  public void onConfigurationChanged(android.content.res.Configuration value){}
  public void onLowMemory(){releaseForMemoryPressure();}
  public void onTrimMemory(int level){if(level==TRIM_MEMORY_UI_HIDDEN)scheduleLocalRelease(30000);else if(level>=TRIM_MEMORY_RUNNING_LOW)releaseForMemoryPressure();}
 };
 private void releaseForMemoryPressure(){for(Pending request:pending.values())request.cancel();queueLocalRelease();}
 private void queueLocalRelease(){
  main.removeCallbacks(localIdleRelease);
  if(!localReleaseQueued.compareAndSet(false,true))return;
  PluginWorkers.submit(workers,()->{try{localEngine.release();}finally{localReleaseQueued.set(false);}},()->localReleaseQueued.set(false));
 }
 private void scheduleLocalRelease(long delay){main.removeCallbacks(localIdleRelease);if(!destroyed)main.postDelayed(localIdleRelease,delay);}
 @PluginMethod public void workflowPresentationCapabilities(PluginCall call){JSObject result=new JSObject();result.put("protocol",2);call.resolve(result);}
 @PluginMethod public void releaseLocalSpeech(PluginCall call){for(Pending request:pending.values())request.cancel();main.post(this::clearPlayback);queueLocalRelease();call.resolve();}

 // Test APK sets this directly on the plugin instance. Never exposed as a Capacitor method.
 String instrumentationBaseUrl;
 String instrumentationCredentialSlot;
 private static final int AUDIO_LIMIT=8*1024*1024;
 private static final class Pending { volatile boolean cancelled,resolvedEarly,keepEngine; volatile Runnable cancelNative,deadline; volatile HttpURLConnection connection; volatile CloudSpeechTimings.Record timing; volatile JSObject result; volatile String failure,failureCode; void cancel(){cancelled=true;if(connection!=null)connection.disconnect();Runnable nativeCancel=cancelNative;if(nativeCancel!=null)try{nativeCancel.run();}catch(RuntimeException ignored){/* Late output remains fenced even if native cancellation fails. */}} }
 @Override public void load(){focus=new AlphaSpeechAudioFocus(getContext(),main,this::speechFocusChanged);focus.watchCalls(main::post,()->main.post(this::callStarted));getContext().registerComponentCallbacks(localMemoryCallbacks);capture=new AlphaCloudVoiceCapture(getContext(),v->notifyListeners("recordingStopped",v));File[] stale=getContext().getCacheDir().listFiles((d,n)->n.startsWith("alpha-cloud-tts-"));if(stale!=null)for(File f:stale)f.delete();}
 @PluginMethod public void startRecording(PluginCall call){
  if(isDraining()){call.reject("Voice cancellation is still draining");return;}
  if(focus!=null&&focus.callActive()){call.reject(CALL_MESSAGE,SpeechAudioFocusPolicy.CALL_ACTIVE);return;}
  if(getPermissionState("microphone")!=PermissionState.GRANTED){permissionEpochs.put(call.getCallbackId(),epoch.get());if(!LateLaunch.ask(call,()->requestPermissionForAlias("microphone",call,"microphonePermission")))permissionEpochs.remove(call.getCallbackId());return;}
  start(call,epoch.get());
 }
 /** Capacitor's own permission request launches through the activity; see {@link LateLaunch}. */
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 @PermissionCallback private void microphonePermission(PluginCall call){Long e=permissionEpochs.remove(call.getCallbackId());if(e==null||e!=epoch.get()){call.reject("Recording cancelled");return;}if(getPermissionState("microphone")!=PermissionState.GRANTED){call.reject("Microphone permission denied","permission-denied");return;}start(call,e);}
 private void start(PluginCall call,long e){main.post(()->{if(destroyed||!speechForeground||isDraining()||e!=epoch.get()){call.reject("Recording cancelled");return;}try{int limit=call.getInt("maxDurationMs",59000);if(limit!=29000&&limit!=59000)throw new IllegalArgumentException("Unsupported capture duration");call.resolve(capture.start(limit));}catch(Exception error){call.reject("Microphone could not start");}});}
 @PluginMethod public void getRecordingMetrics(PluginCall call){main.post(()->{try{call.resolve(capture.metrics(call.getString("recordingId")));}catch(RuntimeException error){call.reject("Recording metrics are no longer available");}});}
 @PluginMethod public void stopRecording(PluginCall call){main.post(()->{try{call.resolve(capture.stop());}catch(Exception error){call.reject("Recording could not be saved");}});}
 @PluginMethod public void saveRecording(PluginCall call){getActivity().runOnUiThread(()->{try{String key=call.getString("recordingId");AlphaNoteAudioPlugin store=(AlphaNoteAudioPlugin)getBridge().getPlugin("AlphaNoteAudio").getInstance();call.resolve(capture.retain(store,key,call.getString("noteId"),call.getString("transcript")));}catch(Exception error){call.reject("The recording could not be saved. Keep this draft and retry.");}});}
 private boolean isDraining(){synchronized(pending){return draining;}}
 private void finishDrain(boolean complete,String error){
  List<PluginCall> calls;synchronized(pending){if(complete)draining=false;calls=new ArrayList<>(drainWaiters.keySet());for(Runnable timeout:drainWaiters.values())main.removeCallbacks(timeout);drainWaiters.clear();}
  for(PluginCall call:calls){if(error==null)call.resolve();else call.reject(error);}
 }
 @PluginMethod public void cancelRecording(PluginCall call){
  epoch.incrementAndGet();permissionEpochs.clear();
  synchronized(pending){
   if(destroyed){call.reject("Voice unavailable");return;}
   for(Pending request:pending.values())request.cancel();
   Runnable timeout=()->{boolean waiting;synchronized(pending){waiting=drainWaiters.remove(call)!=null;}if(waiting)call.reject("Voice cancellation is still draining");};
   drainWaiters.put(call,timeout);main.postDelayed(timeout,120000);if(draining)return;draining=true;
  }
  main.post(()->{
   try{capture.cancel();}catch(RuntimeException error){finishDrain(false,"Recording cancellation failed");return;}
   // Never wait on the UI thread. The serial worker barrier follows cancelled work and its cleanup.
   PluginWorkers.submit(workers,()->main.post(()->{finishDrain(true,destroyed?"Voice unavailable":null);}),()->finishDrain(false,"Voice cancellation is unavailable"));
  });
 }
 private static String required(String value,int max){if(value==null||value.isBlank()||value.length()>max)throw new IllegalArgumentException();return value;}
 private HttpURLConnection connect(PluginCall call,String route,Pending request) throws Exception {
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
 // Native secure-store lookup binds playback to the selected paired identity.
 private HttpURLConnection connectPaired(PluginCall call,boolean status,Pending request)throws Exception{return connectPaired(call,status,request,false);}
 private HttpURLConnection connectPaired(PluginCall call,boolean status,Pending request,boolean asr)throws Exception{
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
  HttpURLConnection c=connectPaired(call,true,request);successful(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,16384,request);}
  JSONObject body=new JSONObject(new String(response,StandardCharsets.UTF_8));JSObject value=new JSObject();value.put("ready",PairedSpeechContract.ttsReady(body));if(request.cancelled||destroyed)throw new IOException();request.result=value;
 });}
 @PluginMethod public void pairedTranscriptionStatus(PluginCall call){submit(call,request->{
  HttpURLConnection c=connectPaired(call,true,request,true);successful(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,16384,request);}JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));boolean valid=PairedSpeechContract.asrReady(data);JSObject value=new JSObject();value.put("ready",valid);value.put("provider",PairedSpeechContract.ASR_PROVIDER);if(request.cancelled||destroyed)throw new IOException();request.result=value;
 });}
 @PluginMethod public void transcribePairedRecording(PluginCall call){submit(call,request->{
  String recordingId=required(call.getString("recordingId"),256);File file=capture.selected(recordingId);if(file==null)throw new IOException();
  // Establish exact saved credential binding before decoding; no user paths or URLs are accepted.
  HttpURLConnection c=connectPaired(call,false,request,true);byte[] audio=AlphaVoicePcm.decode(file,()->request.cancelled||destroyed);
  try{c.setRequestProperty("Content-Type","audio/wav");c.setRequestProperty("X-Request-Id",PairedSpeechContract.requestId(call.getString("requestId")));c.setFixedLengthStreamingMode(audio.length);try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(audio);}}finally{Arrays.fill(audio,(byte)0);}
  successful(c);byte[] response;try(InputStream in=c.getInputStream()){response=read(in,128*1024,request);}JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));String text=PairedSpeechContract.transcript(data);if(request.cancelled||destroyed)throw new IOException();JSObject value=new JSObject();value.put("text",text);value.put("local",true);value.put("provider",PairedSpeechContract.ASR_PROVIDER);request.result=value;
 });}
 @PluginMethod public void synthesizePaired(PluginCall call){synthesizeAudio(call,true);}
 @PluginMethod public void synthesizeBrowserReading(PluginCall call){main.post(()->{try{AlphaBrowserPlugin browser=(AlphaBrowserPlugin)getBridge().getPlugin("AlphaBrowser").getInstance();if("device".equals(call.getString("execution")))throw new IllegalArgumentException();String reviewed=browser.consumeReading(call);synthesizeAudio(call,true,reviewed);}catch(Exception error){call.reject("Reading approval expired");}});}
 @PluginMethod public void synthesizeLocalBrowserReading(PluginCall call){main.post(()->{try{if(!"device".equals(call.getString("execution")))throw new IllegalArgumentException();AlphaBrowserPlugin browser=(AlphaBrowserPlugin)getBridge().getPlugin("AlphaBrowser").getInstance();String reviewed=browser.consumeReading(call);synthesizeLocalNow(call,reviewed);}catch(Exception error){call.reject("Reading approval expired");}});}
 void cancelBrowserSpeech(String id){Pending request=pending.get(id);if(request!=null)request.cancel();if(Objects.equals(playbackRequestId,id)){clearPlayback();notifyListeners("playbackFailed",new JSObject());}}
 private static byte[] read(InputStream in,int limit,Pending request)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(request.cancelled||out.size()+n>limit)throw new IOException();out.write(b,0,n);}return out.toByteArray();}
 private interface Work {void run(Pending request)throws Exception;}
 private void submit(PluginCall call,Work work){submit(call,null,work);}
 private void submit(PluginCall call,String cloudRoute,Work work){
  final String id;try{id=required(call.getString("requestId"),256);}catch(Exception error){call.reject("Invalid request");return;}
  Pending request=new Pending();synchronized(pending){if(destroyed||draining||!pending.isEmpty()){if(!destroyed&&!draining&&Boolean.FALSE.equals(call.getBoolean("replace",true)))call.reject("Speaker is in use","playback-busy");else call.reject("Voice request already active or unavailable");return;}if(cloudRoute!=null)request.timing=cloudTimings.begin(cloudRoute);pending.put(id,request);}
  Runnable deadline=request::cancel;request.deadline=deadline;main.postDelayed(deadline,120000);
  PluginWorkers.submit(workers,()->{
   cloudTimings.mark(request.timing,"worker-start");
   try{if(request.cancelled)throw new IOException();work.run(request);}catch(Exception error){request.failure=request.cancelled?"Voice request cancelled":"Voice request failed";if(!request.cancelled&&error instanceof VoiceHttpException)request.failureCode="voice-http-"+((VoiceHttpException)error).status;}
   finally{try{if(request.connection!=null)request.connection.disconnect();}catch(RuntimeException error){request.failure="Voice request cleanup failed";}finally{pending.remove(id,request);main.removeCallbacks(deadline);}}
   if(request.timing!=null){if(request.cancelled||destroyed)cloudTimings.finish(request.timing,"cancelled");else if(request.failure!=null||request.result==null)cloudTimings.finish(request.timing,"failed");else if("stt".equals(cloudRoute))cloudTimings.finish(request.timing,"completed");}
   // A continuation may submit immediately when this resolves: release admission first.
   // A streamed utterance resolved at its first chunk; its playback events report the rest.
   if(request.resolvedEarly){/* Settled. */}else if(request.cancelled||destroyed)call.reject("Voice request cancelled");else if(request.failure!=null){if(request.failureCode!=null)call.reject(request.failure,request.failureCode);else call.reject(request.failure);}else if(request.result==null)call.reject("Voice request failed");else call.resolve(request.result);
  },()->{main.removeCallbacks(deadline);pending.remove(id,request);cloudTimings.finish(request.timing,"failed");call.reject("Voice unavailable");});
 }
 private static final class VoiceHttpException extends IOException {
  final int status;
  VoiceHttpException(int status){super("Voice HTTP request failed");this.status=status;}
 }
 private static void successful(HttpURLConnection c)throws Exception{int status=c.getResponseCode();if(status<200||status>=300)throw new VoiceHttpException(status);}
 private void successfulCloud(HttpURLConnection c,Pending request)throws Exception{int status=c.getResponseCode();cloudTimings.mark(request.timing,"headers");String provider=c.getHeaderField("X-Eliza-STT-Provider");if(provider==null)provider=c.getHeaderField("X-Eliza-TTS-Provider");cloudTimings.response(request.timing,status,provider,c.getHeaderField("Server-Timing"));if(status<200||status>=300)throw new VoiceHttpException(status);}
 @PluginMethod public void transcribeRecording(PluginCall call){submit(call,"stt",request->{
  request.failureCode="voice-stt-decode";cloudTimings.mark(request.timing,"decode-start");
  String recordingId=required(call.getString("recordingId"),256);File file=capture.selected(recordingId);if(file==null)throw new IOException();
  // Android's MPEG_4 recorder emits mp42, which the Cloud signature gate classifies as video.
  // Decode the selected bounded mono draft to real PCM WAV; changing its MIME label is insufficient.
  HttpURLConnection c;byte[] audio=AlphaVoicePcm.decode(file,()->request.cancelled||destroyed);
  cloudTimings.mark(request.timing,"decode-end");
  try{
  String boundary="AlphaVoice"+UUID.randomUUID().toString().replace("-","");
  byte[] prefix=("--"+boundary+"\r\nContent-Disposition: form-data; name=\"provider\"\r\n\r\ncartesia\r\n--"+boundary+"\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"recording.wav\"\r\nContent-Type: audio/wav\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
  byte[] suffix=("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.US_ASCII);
  request.failureCode="voice-stt-connect";cloudTimings.mark(request.timing,"upload-start");c=connect(call,"stt",request);
  request.failureCode="voice-stt-upload";c.setRequestProperty("Content-Type","multipart/form-data; boundary="+boundary);c.setFixedLengthStreamingMode(prefix.length+audio.length+suffix.length);
  try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(prefix);out.write(audio);out.write(suffix);}
  cloudTimings.mark(request.timing,"upload-end");
  }finally{Arrays.fill(audio,(byte)0);}
  request.failureCode="voice-stt-response";successfulCloud(c,request);CloudSpeechPolicy.requireProvider(BuildConfig.ELIZA_RUNTIME_PROFILE,c.getHeaderField("X-Eliza-STT-Provider"));byte[] response;try(InputStream in=c.getInputStream()){response=read(in,256*1024,request);}cloudTimings.mark(request.timing,"body-end");JSONObject data=new JSONObject(new String(response,StandardCharsets.UTF_8));Object transcript=data.get("transcript");if(!(transcript instanceof String))throw new IOException();
  if(request.cancelled||destroyed)throw new IOException();JSObject result=new JSObject();result.put("text",transcript);result.put("local",false);request.result=result;request.failureCode=null;
 });}
 private void submitLocal(PluginCall call,Work work){submit(call,request->{main.removeCallbacks(localIdleRelease);synchronized(localCancellationGate){localActiveRequest=request;request.cancelNative=()->{synchronized(localCancellationGate){if(localActiveRequest==request)localEngine.cancel();}};}try{if(request.cancelled||!speechForeground)throw new IOException("Voice cancelled");work.run(request);}catch(Exception error){if(!keepsEngine(request))localEngine.release();throw error;}catch(LinkageError|OutOfMemoryError error){localEngine.release();throw new IOException("On-device speech unavailable",error);}finally{synchronized(localCancellationGate){if(localActiveRequest==request)localActiveRequest=null;request.cancelNative=null;}if(destroyed||(request.cancelled&&!keepsEngine(request)))localEngine.release();else scheduleLocalRelease(speechForeground?120000:30000);}});}
 /**
  * A cancelled streamed synthesis (barge-in, stop) leaves the models loaded: ParadeeVoice fences the
  * cancelled call by generation, so the next sentence needs no reload (issue #397). Failures and
  * other cancellations still release them.
  */
 private static boolean keepsEngine(Pending request){return request.keepEngine&&request.cancelled;}
 // Local CPU execution has no dependency on an account, URL, or host process.
 // The status resolves only when the native pair loads, the ABI is at least 16, every bundle file
 // verifies and a context opens. `ready` (recognition) needs the bundle ASR slot, Paradee-8M TTS and VAD; `playback`
 // (read-aloud) needs Paradee-8M only, so a bundle without a qualified ASR pair still reads aloud.
 // A build without the voice bundle answers "unavailable" without loading any native library.
 /** A voice turn was sent: wake the speech output while the reply is produced. Advisory; a phone call skips it. */
 @PluginMethod public void warmSpeechOutput(PluginCall call){main.post(()->{
  if(!destroyed&&(focus==null||!focus.callActive())){closeOutputWarmup();outputWarmup=new SpeechOutputWarmup(AlphaLocalSpeechEngine.STREAM_RATE);}
  call.resolve();
 });}
 private void closeOutputWarmup(){if(outputWarmup!=null){outputWarmup.close();outputWarmup=null;}}
 @PluginMethod public void localSpeechStatus(PluginCall call){submitLocal(call,request->{
  localEngine.use(engine->{if(request.cancelled||destroyed)throw new IOException();return null;});
  if(request.cancelled||destroyed)throw new IOException();JSObject out=new JSObject();out.put("ready",true);out.put("execution","device");out.put("provider","fused-paradee-asr");request.result=out;
 });}
 @PluginMethod public void transcribeLocalRecording(PluginCall call){submitLocal(call,request->{
  File file=capture.selected(required(call.getString("recordingId"),256));if(file==null)throw new IOException();byte[] wav=AlphaVoicePcm.decode(file,()->request.cancelled||destroyed);float[] samples;
  try{samples=AlphaLocalSpeechEngine.readMono16kWav(wav);}finally{Arrays.fill(wav,(byte)0);}
  String text;try{text=localEngine.use(engine->{if(request.cancelled||destroyed)throw new IOException();return engine.transcribe(samples);});}finally{Arrays.fill(samples,0);}
  if(request.cancelled||destroyed)throw new IOException();JSObject out=new JSObject();out.put("text",text);out.put("local",true);out.put("execution","device");out.put("provider","fused-paradee-asr");request.result=out;
 });}
 @PluginMethod public void synthesizeLocal(PluginCall call){main.post(()->{if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&(playbackFile!=null||streamPlayback!=null||!pending.isEmpty())){call.reject("Speaker is in use","playback-busy");return;}synthesizeLocalNow(call);});}
 private void synthesizeLocalNow(PluginCall call){synthesizeLocalNow(call,null);}
 private void synthesizeLocalNow(PluginCall call,String reviewed){
  // Never speak over a ringing phone or a call; say so instead of synthesizing (issue #397).
  if(focus!=null&&focus.callActive()){call.reject(CALL_MESSAGE,SpeechAudioFocusPolicy.CALL_ACTIVE);return;}
  // Bind before the worker queues: only the reply to the named live turn acquires its stage/playback
  // marks (issue #395); a missing or stale voiceTurnId leaves this utterance unattributed.
  final boolean reply=reviewed==null;
  final VoiceLatencyTrials.Trial trial=reply?AlphaVoiceLatencyProbe.TRIALS.forTurn(call.getString("voiceTurnId")):null;
  submitLocal(call,request->{
  String text=reviewed==null?required(call.getString("text"),500):reviewed;byte[] audio;
  int[] clip={-1,0,0};
  int loadsBefore=localEngine.loads();
  if(reply)AlphaVoiceLatencyProbe.TRIALS.mark(trial,"tts-start",System.nanoTime());
  // Streaming engines play each chunk as it is synthesized; only an engine without streaming uses the
  // whole-sentence path below. A streaming failure is a failure, never a fallback.
  Boolean streamed=localEngine.use(engine->{if(request.cancelled||destroyed)throw new IOException();if(!engine.supportsStreaming())return false;streamLocal(call,request,engine,text,reply,trial,loadsBefore);return true;});
  if(streamed)return;
  audio=localEngine.use(engine->{if(request.cancelled||destroyed)throw new IOException();if(reviewed!=null)return engine.synthesizePassage(text,()->request.cancelled||destroyed);AlphaLocalSpeechEngine.Audio generated=engine.synthesize(text,()->request.cancelled||destroyed);try{clip[0]=AlphaVoiceLatencyProbe.leadInFrames(generated.samples);clip[1]=generated.samples.length;clip[2]=generated.sampleRate;return generated.wav();}finally{Arrays.fill(generated.samples,0);}});
  if(reply){AlphaVoiceLatencyProbe.TRIALS.mark(trial,"tts-ready",System.nanoTime());if(localEngine.loads()!=loadsBefore)AlphaVoiceLatencyProbe.TRIALS.engineLoaded(trial,"tts-load");}
  if(request.cancelled||destroyed){Arrays.fill(audio,(byte)0);throw new IOException();}
  File file=File.createTempFile("alpha-cloud-tts-",".wav",getContext().getCacheDir());CountDownLatch completed=new CountDownLatch(1);
  try{try(OutputStream out=new FileOutputStream(file)){out.write(audio);}main.post(()->{try{if(request.cancelled||destroyed){file.delete();request.failure="Voice request cancelled";return;}if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&(playbackFile!=null||streamPlayback!=null)){file.delete();request.failure="Speaker is in use";request.failureCode="playback-busy";return;}clearPlayback();playbackFile=file;playbackRequestId=call.getString("requestId");playbackId=UUID.randomUUID().toString();playbackLocalReply=reply;playbackTrial=trial;playbackLeadIn=clip[0];playbackFrames=clip[1];playbackRate=clip[2];JSObject out=new JSObject();out.put("playbackId",playbackId);out.put("execution","device");request.result=out;}catch(RuntimeException error){request.failure="Playback preparation failed";file.delete();}finally{completed.countDown();}});if(!completed.await(10,TimeUnit.SECONDS)){request.cancel();file.delete();throw new IOException("Playback preparation timed out");}}catch(Exception error){file.delete();throw error;}finally{Arrays.fill(audio,(byte)0);}
 });}
 /**
  * Issue #397 streamed local speech. Runs on the speech worker inside localEngine.use. The utterance
  * is published (the call resolves with its playbackId) when the first validated chunk arrives;
  * play() then starts an AudioTrack writer. Chunks are held in memory only, in a bounded queue whose
  * backpressure paces synthesis to playback. A failure after publication is reported as playbackFailed.
  */
 private void streamLocal(PluginCall call,Pending request,AlphaLocalSpeechEngine.Backend engine,String text,boolean reply,VoiceLatencyTrials.Trial trial,int loadsBefore)throws Exception{
  request.keepEngine=true;
  final String id=UUID.randomUUID().toString();
  final StreamingSpeechPlayback[] self=new StreamingSpeechPlayback[1];
  final StreamingSpeechPlayback.Listener listener=streamListener(id,reply?trial:null,self);
  final StreamingSpeechPlayback playback=new StreamingSpeechPlayback(STREAM_CAPACITY,AlphaLocalSpeechEngine.STREAM_RATE,AlphaVoiceLatencyProbe.AUDIBLE_LEVEL,()->new FirstWriteSpeechOutput(AudioTrackSpeechOutput.open(AlphaLocalSpeechEngine.STREAM_RATE),()->listener.firstFrame(System.nanoTime())),listener,System::nanoTime);
  self[0]=playback;
  // Cancelling the request also wakes a synthesis callback blocked on the full queue.
  final Runnable nativeCancel=request.cancelNative;
  request.cancelNative=()->{playback.stop();if(nativeCancel!=null)nativeCancel.run();};
  final String[] refused={null};
  final SpeechLeadTrim trim=new SpeechLeadTrim(AlphaVoiceLatencyProbe.AUDIBLE_LEVEL,AlphaLocalSpeechEngine.STREAM_RATE/33);
  try{
   engine.synthesizeStream(text,()->request.cancelled||destroyed||playback.stopped(),(raw,complete)->{
    if(request.cancelled||destroyed)return false;
    final float[] samples=trim.next(raw);
    if(samples.length==0&&!complete)return !playback.stopped();
    if(!request.resolvedEarly){
     main.post(this::closeOutputWarmup);
     if(reply){AlphaVoiceLatencyProbe.TRIALS.mark(trial,"tts-ready",System.nanoTime());if(localEngine.loads()!=loadsBefore)AlphaVoiceLatencyProbe.TRIALS.engineLoaded(trial,"tts-load");}
     refused[0]=publishStream(call,request,playback,id,reply,trial);
     if(refused[0]!=null){Arrays.fill(samples,0);return false;}
    }
    return playback.offer(samples,complete);
   });
  }catch(Exception error){
   if(playback.stopped())request.cancelled=true;
   if(!request.resolvedEarly){playback.stop();if(refused[0]!=null&&settleRefusal(request,refused[0]))return;throw error;}
   main.post(()->{if(streamPlayback==playback){if(request.cancelled)clearPlayback();else playback.fail("synthesis-failed");}else playback.stop();});
   throw error;
  }
  if(!request.resolvedEarly){playback.stop();throw new IllegalStateException("No speech output");}
 }
 private static boolean settleRefusal(Pending request,String refusal){
  if("playback-busy".equals(refusal)){request.failure="Speaker is in use";request.failureCode="playback-busy";request.cancelled=false;return true;}
  return false;
 }
 /** Main-thread publication of a streamed utterance. Null when published, else the refusal. */
 private String publishStream(PluginCall call,Pending request,StreamingSpeechPlayback playback,String id,boolean reply,VoiceLatencyTrials.Trial trial)throws Exception{
  CountDownLatch published=new CountDownLatch(1);String[] refusal={null};
  main.post(()->{try{
   if(request.cancelled||destroyed){refusal[0]="cancelled";return;}
   if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&(playbackFile!=null||streamPlayback!=null)){refusal[0]="playback-busy";return;}
   clearPlayback();streamPlayback=playback;playbackRequestId=call.getString("requestId");playbackId=id;playbackLocalReply=reply;playbackTrial=trial;
   // Synthesis is now paced by playback: the request deadline no longer applies; the queue and writer bound stalls.
   Runnable deadline=request.deadline;if(deadline!=null)main.removeCallbacks(deadline);
   request.resolvedEarly=true;
   JSObject out=new JSObject();out.put("playbackId",id);out.put("execution","device");out.put("streaming",true);call.resolve(out);
  }catch(RuntimeException error){refusal[0]="failed";}finally{published.countDown();}});
  if(!published.await(10,TimeUnit.SECONDS)){request.cancel();return "timeout";}
  return refusal[0];
 }
 private StreamingSpeechPlayback.Listener streamListener(String id,VoiceLatencyTrials.Trial trial,StreamingSpeechPlayback[] self){
  android.content.Context app=getContext().getApplicationContext();
  return new StreamingSpeechPlayback.Listener(){
   public void firstFrame(long nanos){if(trial==null)return;VoiceLatencyTrials.Trial owned=AlphaVoiceLatencyProbe.TRIALS.firstPcm(trial,nanos);if(owned!=null)AlphaVoiceLatencyProbe.stampEnvironment(app,owned);}
   public void audible(long nanos,String clock){if(trial!=null)AlphaVoiceLatencyProbe.TRIALS.audible(trial,nanos,clock);}
   public void ended(boolean silent){
    if(trial!=null)AlphaVoiceLatencyProbe.TRIALS.failed(trial,silent?"silent-response":"no-audible-time"); // No-op once audible passed it.
    main.post(()->{if(streamPlayback!=self[0])return;clearPlayback(false);JSObject event=new JSObject();event.put("playbackId",id);notifyListeners("playbackEnded",event);});
   }
   public void failed(String reason){
    if(trial!=null)AlphaVoiceLatencyProbe.TRIALS.failed(trial,reason);
    main.post(()->{if(streamPlayback!=self[0])return;clearPlayback(false);JSObject event=new JSObject();event.put("playbackId",id);notifyListeners("playbackFailed",event);});
   }
  };
 }
 @PluginMethod public void synthesize(PluginCall call){if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&(playbackFile!=null||streamPlayback!=null||!pending.isEmpty())){call.reject("Speaker is in use","playback-busy");return;}synthesizeAudio(call,false);}
 private void synthesizeAudio(PluginCall call,boolean paired){synthesizeAudio(call,paired,null);}
 private void synthesizeAudio(PluginCall call,boolean paired,String reviewed){submit(call,paired?null:"tts",request->{
  String text=required(reviewed==null?call.getString("text"):reviewed,5000);cloudTimings.mark(request.timing,"upload-start");HttpURLConnection c=paired?connectPaired(call,false,request):connect(call,"tts",request);byte[] body=(paired?PairedSpeechContract.ttsBody(text):new JSONObject().put("text",text).put("format","mp3")).toString().getBytes(StandardCharsets.UTF_8);if(paired)c.setRequestProperty("X-Request-Id",PairedSpeechContract.requestId(call.getString("requestId")));c.setRequestProperty("Content-Type","application/json");c.setFixedLengthStreamingMode(body.length);try(OutputStream out=c.getOutputStream()){if(request.cancelled)throw new IOException();out.write(body);}cloudTimings.mark(request.timing,"upload-end");if(paired)successful(c);else successfulCloud(c,request);
  if(!paired)CloudSpeechPolicy.requireProvider(BuildConfig.ELIZA_RUNTIME_PROFILE,c.getHeaderField("X-Eliza-TTS-Provider"));
  String mime=c.getContentType();if(paired)PairedSpeechContract.ttsHeaders(call.getString("requestId"),c.getHeaderField("X-Request-Id"),c.getHeaderField("X-Eliza-Speech-Provider"),mime);if(mime==null||!Set.of("audio/mpeg","audio/mp3","audio/wav").contains(mime.split(";")[0].trim().toLowerCase(Locale.ROOT)))throw new IOException();byte[] audio;try(InputStream in=c.getInputStream()){audio=read(in,AUDIO_LIMIT,request);}cloudTimings.mark(request.timing,"body-end");if(audio.length==0)throw new IOException();
  CountDownLatch completed=new CountDownLatch(1);
  File file=File.createTempFile("alpha-cloud-tts-",".audio",getContext().getCacheDir());try{try(FileOutputStream out=new FileOutputStream(file)){out.write(audio);}if(request.cancelled||destroyed)throw new IOException();main.post(()->{try{if(request.cancelled||destroyed){file.delete();request.failure="Voice request cancelled";return;}if(Boolean.FALSE.equals(call.getBoolean("replace",true))&&playbackFile!=null){file.delete();request.failure="Speaker is in use";request.failureCode="playback-busy";return;}clearPlayback();playbackFile=file;playbackRequestId=call.getString("requestId");playbackId=UUID.randomUUID().toString();playbackTiming=request.timing;cloudTimings.mark(request.timing,"prepared");JSObject value=new JSObject();value.put("playbackId",playbackId);request.result=value;}catch(RuntimeException error){request.failure="Playback preparation failed";file.delete();}finally{completed.countDown();}});completed.await();}catch(Exception error){file.delete();throw error;}finally{Arrays.fill(audio,(byte)0);}
 });}
 @PluginMethod public void play(PluginCall call){main.post(()->{try{if(streamPlayback!=null&&Objects.equals(playbackId,call.getString("playbackId"))){playStream(call);return;}if(playbackFile==null||!Objects.equals(playbackId,call.getString("playbackId"))){call.reject("Playback unavailable");return;}if(player!=null){player.release();player=null;}if(preparingPlayback!=null)preparingPlayback.reject("Playback replaced");preparingPlayback=call;MediaPlayer next=new MediaPlayer();player=next;next.setAudioAttributes(AlphaSpeechAudioFocus.ATTRIBUTES);next.setDataSource(playbackFile.getAbsolutePath());final String activePlaybackId=playbackId;next.setOnCompletionListener(p->{if(player==p){cloudTimings.mark(playbackTiming,"playback-end");cloudTimings.finish(playbackTiming,"completed");clearPlayback(false);JSObject event=new JSObject();event.put("playbackId",activePlaybackId);notifyListeners("playbackEnded",event);}});next.setOnErrorListener((p,w,e)->{if(player==p){cloudTimings.finish(playbackTiming,"failed");clearPlayback(false);JSObject event=new JSObject();event.put("playbackId",activePlaybackId);notifyListeners("playbackFailed",event);}return true;});next.setOnPreparedListener(p->{if(player==p&&!destroyed){try{String refusal=focus.acquire();if(refusal!=null){preparingPlayback=null;clearPlayback();call.reject(refusalMessage(refusal),refusal);return;}p.start();cloudTimings.mark(playbackTiming,"playback-start");if(playbackLocalReply)AlphaVoiceLatencyProbe.playbackStarted(playbackTrial,getContext(),p,main,playbackLeadIn,playbackFrames,playbackRate,()->player==p&&!destroyed);preparingPlayback=null;call.resolve();}catch(RuntimeException error){cloudTimings.finish(playbackTiming,"failed");clearPlayback();}}else call.reject("Playback cancelled");});next.prepareAsync();}catch(Exception error){cloudTimings.finish(playbackTiming,"failed");clearPlayback();call.reject("Playback unavailable");}});}
 static final String CALL_MESSAGE="Speech is paused while a phone call is active";
 private static String refusalMessage(String refusal){return SpeechAudioFocusPolicy.CALL_ACTIVE.equals(refusal)?CALL_MESSAGE:"Another app is using the speaker";}
 /** Starts a published streamed utterance: audio focus first, never during a call (issue #397). */
 private void playStream(PluginCall call){
  String refusal=focus.acquire();
  if(refusal!=null){clearPlayback();call.reject(refusalMessage(refusal),refusal);return;}
  if(preparingPlayback!=null){preparingPlayback.reject("Playback replaced");preparingPlayback=null;}
  if(player!=null){player.release();player=null;}
  streamPlayback.start();call.resolve();
 }
 /** Focus changes while speech plays (main thread). */
 private void speechFocusChanged(SpeechAudioFocusPolicy.Action action,boolean call){
  switch(action){
   case DUCK:case RESTORE:{boolean ducked=action==SpeechAudioFocusPolicy.Action.DUCK;if(streamPlayback!=null)streamPlayback.duck(ducked);float volume=ducked?SpeechAudioFocusPolicy.DUCK_VOLUME:1f;if(player!=null)try{player.setVolume(volume,volume);}catch(IllegalStateException ignored){/* Released. */}break;}
   case STOP:stopSpeechFor(call?SpeechAudioFocusPolicy.CALL_ACTIVE:"audio-focus-lost");if(call)stopCaptureForCall();break;
   default:break;
  }
 }
 /** Clears unplayed speech and tells the renderer why. */
 private void stopSpeechFor(String reason){String previous=playbackId;if(previous==null)return;clearPlayback(false);JSObject event=new JSObject();event.put("playbackId",previous);event.put("reason",reason);notifyListeners("playbackStopped",event);}
 /** The audio mode entered a call (Android 12+ watcher): stop speech and assistant capture honestly. */
 private void callStarted(){if(destroyed)return;stopSpeechFor(SpeechAudioFocusPolicy.CALL_ACTIVE);stopCaptureForCall();}
 private void stopCaptureForCall(){
  AlphaLiveVoiceCapture active=liveCurrent;
  if(active!=null)PluginWorkers.submit(liveStopWorker,()->active.interrupt(SpeechAudioFocusPolicy.CALL_ACTIVE),()->{/* Shut down: the capture already stopped. */});
  if(capture!=null)capture.stopAutomatically();
 }
 private void clearPlayback(){clearPlayback(true);}
 private void clearPlayback(boolean stopped){String previous=playbackId;cloudTimings.finish(playbackTiming,"cancelled");playbackTiming=null;if(preparingPlayback!=null){preparingPlayback.reject("Playback cancelled");preparingPlayback=null;}if(player!=null){player.release();player=null;}if(streamPlayback!=null){streamPlayback.stop();streamPlayback=null;AlphaVoiceLatencyProbe.TRIALS.stopped(playbackTrial);}if(focus!=null)focus.release();if(playbackFile!=null)playbackFile.delete();playbackFile=null;playbackId=null;playbackRequestId=null;playbackLocalReply=false;playbackTrial=null;playbackLeadIn=-1;if(stopped&&previous!=null){JSObject event=new JSObject();event.put("playbackId",previous);notifyListeners("playbackStopped",event);}}
 @PluginMethod public void stopPlayback(PluginCall call){String requestId=call.getString("requestId");main.post(()->{if(requestId==null||Objects.equals(playbackRequestId,requestId))clearPlayback();call.resolve();});}
 /** In-memory numeric Cloud stages only; no audio, text, credentials or request identifiers. */
 @PluginMethod public void cloudVoiceTiming(PluginCall call){try{call.resolve(JSObject.fromJSONObject(new JSONObject(cloudTimings.snapshot())));}catch(org.json.JSONException invalid){call.reject("Cloud speech timing unavailable");}}
 /**
  * Issue #395: the finished native latency trials (alpha-native-voice-timing-v3, numbers, fixed
  * labels and build/model identity only) for the diagnostics export.
  */
 @PluginMethod public void nativeVoiceTiming(PluginCall call){
  // Off the live capture worker: the first export may still be hashing the engine.
  android.content.Context app=getContext().getApplicationContext();
  Thread export=new Thread(()->{try{call.resolve(JSObject.fromJSONObject(AlphaVoiceLatencyProbe.export(app)));}catch(Exception error){call.reject("Voice timing unavailable");}},"alpha-voice-timing-export");
  export.setDaemon(true);export.start();
 }
 /**
  * Issue #395: the renderer reports a live turn's final transcript ("asr-final"), agent request
  * dispatch ("request") and first streamed reply token ("first-token"). Stamped with the monotonic
  * clock on arrival (so they include the bridge hop). Without voiceTurnId the stage binds to the open
  * turn and its id is returned; later stages and the reply's synthesizeLocal echo that id.
  */
 @PluginMethod public void markVoiceTurn(PluginCall call){
  long at=System.nanoTime();
  String stage=call.getString("stage","");
  if(!VoiceLatencyTrials.rendererStage(stage)){call.reject("Invalid voice turn stage");return;}
  String turnId=call.getString("voiceTurnId");
  VoiceLatencyTrials.Trial trial=turnId==null?AlphaVoiceLatencyProbe.TRIALS.pending():AlphaVoiceLatencyProbe.TRIALS.forTurn(turnId);
  JSObject out=new JSObject();out.put("marked",trial!=null&&AlphaVoiceLatencyProbe.TRIALS.mark(trial,stage,at));
  if(trial!=null)out.put("voiceTurnId",trial.turnId);
  call.resolve(out);
 }
 @PluginMethod public void clearNativeVoiceTiming(PluginCall call){AlphaVoiceLatencyProbe.TRIALS.clear();call.resolve();}
 @PluginMethod public void cancel(PluginCall call){Pending request=pending.get(call.getString("requestId",""));if(request!=null)request.cancel();call.resolve();}
 @Override protected void handleOnResume(){speechForeground=true;scheduleLocalRelease(120000);super.handleOnResume();}
 // Live voice (live-voice.ts / native-live-voice.ts): app-process capture with Silero VAD. One capture at a time.
 private final ExecutorService liveWorker=Executors.newSingleThreadExecutor();
 private AlphaLiveVoiceCapture live; // Guarded by liveWorker (all access runs on it).
 private volatile AlphaLiveVoiceCapture liveCurrent; // The running capture, for call interruption off liveWorker.
 private final ExecutorService nativeVoiceWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new SynchronousQueue<>());
 private final Map<String,NativeLiveVoicePipe> livePipes=new ConcurrentHashMap<>();
 private final LiveCaptureAdmission liveAdmission=new LiveCaptureAdmission();
 private final ExecutorService liveStopWorker=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new SynchronousQueue<>());
 private final Map<String,LiveCaptureAdmission.Ticket> livePermissionEpochs=new ConcurrentHashMap<>();
 @PluginMethod public void liveCaptureStatus(PluginCall call){
  boolean permitted=getPermissionState("microphone")==PermissionState.GRANTED;
  PluginWorkers.submit(liveWorker,()->{JSObject result=new JSObject();result.put("permission",permitted);result.put("nativeTransport",true);result.put("available",!destroyed&&AlphaLiveVoiceCapture.vadAvailable(getContext()));call.resolve(result);},()->call.resolve(new JSObject().put("permission",permitted).put("available",false)));
 }
 @PluginMethod public void startLiveCapture(PluginCall call){
  String id=call.getString("captureId","");
  if(!id.matches("[0-9a-fA-F-]{36}")){call.reject("Invalid live capture");return;}
  if(isDraining()||destroyed||!speechForeground){call.reject("Recording cancelled");return;}
  if(focus!=null&&focus.callActive()){call.reject("Voice is paused while a phone call is active",SpeechAudioFocusPolicy.CALL_ACTIVE);return;}
  LiveCaptureAdmission.Ticket ticket=liveAdmission.begin(id,epoch.get());
  if(getPermissionState("microphone")!=PermissionState.GRANTED){livePermissionEpochs.put(call.getCallbackId(),ticket);if(!LateLaunch.ask(call,()->requestPermissionForAlias("microphone",call,"liveMicrophonePermission")))livePermissionEpochs.remove(call.getCallbackId());return;}
  startLive(call,ticket);
 }
 @PermissionCallback private void liveMicrophonePermission(PluginCall call){LiveCaptureAdmission.Ticket ticket=livePermissionEpochs.remove(call.getCallbackId());if(ticket==null||!liveAdmission.current(ticket)||ticket.epoch!=epoch.get()){call.reject("Recording cancelled");return;}if(getPermissionState("microphone")!=PermissionState.GRANTED){call.reject("Microphone permission denied","permission-denied");return;}startLive(call,ticket);}
 private void startLive(PluginCall call,LiveCaptureAdmission.Ticket ticket){
  String id=ticket.id;long e=ticket.epoch;
  PluginWorkers.submit(liveWorker,()->{
   if(destroyed||!speechForeground||e!=epoch.get()||!liveAdmission.current(ticket)){call.reject("Recording cancelled");return;}
   if(live!=null){String old=live.captureId();live.stop();live=null;closeNativePipe(old,true,System.currentTimeMillis());}
   final NativeLiveVoicePipe pipe;
   try{
    pipe=Boolean.TRUE.equals(call.getBoolean("nativeAsr",false))?new NativeLiveVoicePipe(
     AlphaLocalAgentPlugin.openNativeVoiceTransport(call.getString("ownerId","")),new NativeLiveVoicePipe.Sink(){
      public void result(JSONObject value){if(!destroyed&&speechForeground&&e==epoch.get()&&liveAdmission.events(ticket))notifyListeners("liveCaptureTranscript",new JSObject().put("captureId",id).put("final",value));}
      public void failed(String code){if(!liveAdmission.events(ticket))return;if(!"ASR_FAILED".equals(code))liveAdmission.stop(id);notifyListeners("liveCaptureTranscript",new JSObject().put("captureId",id).put("error",code));}
     },id,call.getString("roomId",null)):null;
    if(pipe!=null){livePipes.put(id,pipe);if(!pipe.start(nativeVoiceWorker)){livePipes.remove(id,pipe);call.reject("Native voice transport busy");return;}if(!pipe.ready().get(10000,TimeUnit.MILLISECONDS))throw new IllegalStateException("Native voice startup unavailable");}
   }catch(Exception unavailable){closeNativePipe(id,true,System.currentTimeMillis());call.reject("Native voice enrollment unavailable");return;}
   AlphaLiveVoiceCapture next=new AlphaLiveVoiceCapture(getContext(),id,new AlphaLiveVoiceCapture.Sink(){
    private boolean admitted(){return !destroyed&&speechForeground&&e==epoch.get()&&liveAdmission.events(ticket);}
    public void frames(String captureId,JSArray frames,JSArray vad,float peak){if(!admitted())return;notifyListeners("liveCaptureFrames",new JSObject().put("captureId",captureId).put("frames",pipe==null?frames:new JSArray()).put("vad",vad).put("peak",peak));if(pipe!=null)pipe.offer(frames,vad);}
    public void ended(String captureId,String error){if(!admitted())return;JSObject event=new JSObject().put("captureId",captureId);if(error!=null)event.put("error",error);notifyListeners("liveCaptureEnded",event);if(error!=null&&pipe!=null)pipe.close(true,System.currentTimeMillis());}
   },Boolean.TRUE.equals(call.getBoolean("echoCancel",false)));
   // Publish cancellation before native startup. The callback only marks and schedules: no UI join/AudioRecord.stop.
   if(!liveAdmission.attach(ticket,()->{next.cancelPending();if(pipe!=null&&!liveAdmission.events(ticket))pipe.close(true,System.currentTimeMillis());PluginWorkers.submit(liveStopWorker,next::requestStop,()->{/* liveWorker cleanup still stops this source. */});})){closeNativePipe(id,true,System.currentTimeMillis());call.reject("Recording cancelled");return;}
   try{
    next.start();
    if(destroyed||!speechForeground||e!=epoch.get()||!liveAdmission.current(ticket)){next.stop();closeNativePipe(id,true,System.currentTimeMillis());call.reject("Recording cancelled");return;}
    live=next;liveCurrent=next;call.resolve(new JSObject().put("captureId",id).put("sampleRate",AlphaLiveVoiceCapture.SAMPLE_RATE).put("echoCancelled",next.echoCancelled()).put("nativeAsr",pipe!=null));
   }catch(Exception|Error error){next.stop();closeNativePipe(id,true,System.currentTimeMillis());call.reject("Live capture could not start","capture");}
  },()->call.reject("Voice unavailable"));
 }
 /** Waits only on liveWorker, never the bridge/UI thread. False explicitly means server close unconfirmed. */
 private boolean closeNativePipe(String id,boolean discard,double at){
  NativeLiveVoicePipe pipe=livePipes.get(id);if(pipe==null)return true;
  try{return pipe.close(discard,at).get(12000,TimeUnit.MILLISECONDS);}catch(Exception uncertain){pipe.close(true,at);return false;}
  finally{livePipes.remove(id,pipe);}
 }
 @PluginMethod public void stopLiveCapture(PluginCall call){
  String id=call.getString("captureId","");boolean discard=Boolean.TRUE.equals(call.getBoolean("discard",false));
  double at=call.getData().optDouble("cutoffMs",System.currentTimeMillis());if(!Double.isFinite(at))at=System.currentTimeMillis();final double cutoff=at;
  NativeLiveVoicePipe pipe=livePipes.get(id);if(pipe!=null){pipe.cutoff(cutoff);if(discard||!pipe.ready().isDone())pipe.close(true,cutoff);}
  liveAdmission.stop(id);
  PluginWorkers.submit(liveWorker,()->{long duration=0;if(live!=null&&live.captureId().equals(id)){duration=live.stop();live=null;}boolean acknowledged=closeNativePipe(id,discard,cutoff);call.resolve(new JSObject().put("captureId",id).put("durationMs",duration).put("serverClosed",acknowledged));},()->call.resolve(new JSObject().put("captureId",id).put("durationMs",0).put("serverClosed",false)));
 }
 private void stopLiveCapture(){liveAdmission.cancelAll();for(NativeLiveVoicePipe pipe:livePipes.values())pipe.close(true,System.currentTimeMillis());PluginWorkers.submit(liveWorker,()->{if(live!=null){live.stop();live=null;}for(String id:livePipes.keySet())closeNativePipe(id,true,System.currentTimeMillis());},()->{/* Already shut down: its last task stopped the capture. */});}
 @Override protected void handleOnPause(){speechForeground=false;stopLiveCapture();scheduleLocalRelease(30000);if(permissionEpochs.isEmpty())epoch.incrementAndGet();if(capture!=null)capture.stopAutomatically();for(Pending request:pending.values())request.cancel();main.post(this::clearPlayback);super.handleOnPause();}
 @Override protected void handleOnDestroy(){destroyed=true;main.post(()->{closeOutputWarmup();if(focus!=null)focus.close();});stopLiveCapture();liveWorker.shutdown();liveStopWorker.shutdown();nativeVoiceWorker.shutdown();livePermissionEpochs.clear();finishDrain(false,"Voice unavailable");epoch.incrementAndGet();permissionEpochs.clear();for(Pending request:pending.values())request.cancel();if(capture!=null)capture.cancel();main.post(this::clearPlayback);main.removeCallbacks(localIdleRelease);getContext().unregisterComponentCallbacks(localMemoryCallbacks);PluginWorkers.submit(workers,localEngine::close,()->{/* Already stopped: its last task closed nothing new. */});workers.shutdown();super.handleOnDestroy();}
}

/** One foreground-only private audio draft. Capture and upload are separate user actions. */
final class AlphaCloudVoiceCapture {
 private final android.content.Context context;
 private final java.util.function.Consumer<JSObject> events;
 private final Handler handler = new Handler(Looper.getMainLooper());
 private android.media.MediaRecorder recorder;
 private File file;
 private String id;
 private long startedAt;
 private long durationMs;
 private Runnable deadline;
 AlphaCloudVoiceCapture(android.content.Context context, java.util.function.Consumer<JSObject> events) {
  this.context = context; this.events = events;
  File[] stale = context.getCacheDir().listFiles((dir,name) -> name.startsWith("alpha-cloud-voice-") && name.endsWith(".m4a"));
  if (stale != null) for (File candidate : stale) candidate.delete();
 }
 synchronized JSObject start() throws IOException { return start(59000); }
 synchronized JSObject start(int maxDurationMs) throws IOException {
  if(maxDurationMs!=29000&&maxDurationMs!=59000)throw new IllegalArgumentException("Unsupported capture duration");
  if (file != null) throw new IllegalStateException("Finish or discard the current recording first");
  id = UUID.randomUUID().toString(); file = new File(context.getCacheDir(), "alpha-cloud-voice-" + id + ".m4a");
  recorder = new android.media.MediaRecorder();
  try {
   recorder.setAudioSource(android.media.MediaRecorder.AudioSource.MIC);
   recorder.setOutputFormat(android.media.MediaRecorder.OutputFormat.MPEG_4);
   recorder.setAudioEncoder(android.media.MediaRecorder.AudioEncoder.AAC);
   recorder.setAudioChannels(1); recorder.setAudioSamplingRate(16000); recorder.setAudioEncodingBitRate(64000);
   recorder.setOutputFile(file.getAbsolutePath()); recorder.setMaxDuration(maxDurationMs); recorder.setMaxFileSize(4 * 1024 * 1024);
   recorder.setOnInfoListener((source, what, extra) -> {
    synchronized(this){if(recorder!=source)return;if (what == android.media.MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == android.media.MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) stopAutomatically();}
   });
   recorder.setOnErrorListener((source, what, extra) -> { JSObject result=new JSObject();synchronized(this) {if(recorder!=source)return;result.put("recordingId",id);cancel();}result.put("status","failed");result.put("message","Recording stopped because Android reported a microphone error");events.accept(result); });
   recorder.prepare(); recorder.start(); startedAt = android.os.SystemClock.elapsedRealtime();
   final String ownedId=id;deadline=()->{synchronized(this){if(!ownedId.equals(id))return;stopAutomatically();}}; handler.postDelayed(deadline,maxDurationMs);
   JSObject result = new JSObject(); result.put("status","recording"); result.put("recordingId",id); result.put("maxDurationMs",maxDurationMs); return result;
  } catch (IOException | RuntimeException error) { cancel(); throw error; }
 }
 /** Genuine peak from the already-owned microphone capture; no second stream or inferred RMS. */
 synchronized JSObject metrics(String recordingId) {
  if(recorder==null||id==null||!id.equals(recordingId))throw new IllegalStateException("Recording changed");
  JSObject result=new JSObject();result.put("recordingId",id);result.put("peak",Math.max(0,Math.min(1,recorder.getMaxAmplitude()/32767.0)));return result;
 }
 synchronized JSObject stop() {
  if (recorder == null) throw new IllegalStateException("No recording is active");
  handler.removeCallbacks(deadline); durationMs = android.os.SystemClock.elapsedRealtime() - startedAt;
  try { recorder.stop(); }
  catch (RuntimeException error) { cancel(); throw new IllegalStateException("Recording was too short or unavailable"); }
  recorder.release(); recorder = null;
  if (!file.isFile() || file.length() == 0 || file.length() > 4 * 1024 * 1024) { cancel(); throw new IllegalStateException("Recording is unavailable or exceeds the size limit"); }
  JSObject result = new JSObject(); result.put("status","recorded"); result.put("recordingId",id); result.put("durationMs",durationMs); return result;
 }
 synchronized void stopAutomatically() {
  if (recorder == null) return;
  final String ownedId=id;
  try { events.accept(stop()); }
  catch (RuntimeException error) { JSObject result=new JSObject();result.put("recordingId",ownedId);result.put("status","failed");result.put("message","Recording could not be saved");events.accept(result); }
 }
 synchronized JSObject retain(AlphaNoteAudioPlugin store,String recordingId,String noteId,String transcript)throws Exception {File chosen=selected(recordingId);if(chosen==null)throw new IllegalStateException();return store.retain(chosen,recordingId,noteId,durationMs,transcript);}
 synchronized File selected(String recordingId) {
  if (recorder != null || file == null || !id.equals(recordingId)) return null;
  return file;
 }
 synchronized void discard(String recordingId) { if (id != null && id.equals(recordingId)) cancel(); }
 synchronized void cancel() {
  if (deadline != null) handler.removeCallbacks(deadline);
  if (recorder != null) { try { recorder.stop(); } catch (RuntimeException ignored) {} recorder.release(); recorder=null; }
  if (file != null) file.delete(); file=null; id=null; durationMs=0;
 }
}
