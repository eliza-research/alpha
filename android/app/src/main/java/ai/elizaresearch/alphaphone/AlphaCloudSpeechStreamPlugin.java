package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.os.Handler;
import android.os.Looper;
import ai.eliza.voice.AudioTrackSpeechOutput;
import ai.eliza.voice.SpeechAudioFocus;
import ai.eliza.voice.SpeechAudioFocusPolicy;
import ai.eliza.voice.StreamingSpeechPlayback;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;
import okio.ByteString;
import org.json.JSONObject;

/** A native speech-only Cloud relay. The resident agent retains all conversation and action ownership. */
@CapacitorPlugin(name="AlphaCloudSpeechStream",permissions={@Permission(alias="microphone",strings={Manifest.permission.RECORD_AUDIO})})
public final class AlphaCloudSpeechStreamPlugin extends Plugin {
 private static final MediaType JSON=MediaType.get("application/json; charset=utf-8");
 private static final String BASE="/api/v1/voice/speech/";
 private final Handler main=new Handler(Looper.getMainLooper());
 private final ExecutorService control=Executors.newSingleThreadExecutor();
 private final ExecutorService media=Executors.newSingleThreadExecutor();
 private final OkHttpClient http=new OkHttpClient.Builder().connectTimeout(8,TimeUnit.SECONDS).readTimeout(10,TimeUnit.SECONDS).writeTimeout(5,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build();
 private volatile Session session;
 private volatile boolean foreground=true,destroyed;
 private SpeechAudioFocus focus;
 private volatile PluginCall permissionCall;
 private final java.util.ArrayDeque<JSObject> timings=new java.util.ArrayDeque<>();
 private long timingSequence;
 private void mark(Session own,String stage){markAt(own,stage,System.nanoTime(),null,0);}
 private synchronized void markAt(Session own,String stage,long nanos,String clock,long utteranceStarted){
  JSObject row=new JSObject();row.put("session",own.diagnosticId);row.put("stage",stage);row.put("elapsedMs",Math.max(0,(nanos-own.started)/1_000_000));
  if(utteranceStarted>0)row.put("utteranceElapsedMs",Math.max(0,(nanos-utteranceStarted)/1_000_000));
  if(StreamingSpeechPlayback.TIMESTAMP_CLOCK.equals(clock)||StreamingSpeechPlayback.HEAD_CLOCK.equals(clock))row.put("clock",clock);
  else row.put("clock","monotonic-observed");
  row.put("sentFrames",own.sentFrames);row.put("sentBytes",own.sentBytes);row.put("receivedFrames",own.receivedFrames);row.put("receivedBytes",own.receivedBytes);if(own.httpStatus!=0)row.put("httpStatus",own.httpStatus);timings.addLast(row);while(timings.size()>100)timings.removeFirst();
 }
 @PluginMethod public synchronized void cloudStreamTiming(PluginCall call){JSArray rows=new JSArray();for(JSObject row:timings)rows.put(row);call.resolve(new JSObject().put("format","alpha-cloud-stream-timing-v1").put("records",rows));}

 @Override public void load(){
  focus=new SpeechAudioFocus(getContext(),main,(action,call)->{
   Session own=session;if(own==null)return;
   if(action==SpeechAudioFocusPolicy.Action.DUCK||action==SpeechAudioFocusPolicy.Action.RESTORE){Utterance spoken=own.spoken;if(spoken!=null&&spoken.playback!=null)spoken.playback.duck(action==SpeechAudioFocusPolicy.Action.DUCK);}
   else if(action==SpeechAudioFocusPolicy.Action.STOP)retire(own,call?"call-active":"audio-focus-lost");
  });
  focus.watchCalls(main::post,()->{Session own=session;if(own!=null)retire(own,"call-active");});
 }
 @Override @PluginMethod public void requestPermissions(PluginCall call){LateLaunch.ask(call,()->super.requestPermissions(call));}
 @PluginMethod public void startCloudSpeech(PluginCall call){
  if(destroyed||!foreground){call.reject("Voice is not in the foreground");return;}
  if(session!=null||permissionCall!=null){call.reject("Voice is already active");return;}
  if(getPermissionState("microphone")!=PermissionState.GRANTED){permissionCall=call;if(!LateLaunch.ask(call,()->requestPermissionForAlias("microphone",call,"microphoneReady")))permissionCall=null;return;}
  start(call);
 }
 @PermissionCallback private void microphoneReady(PluginCall call){
  if(permissionCall!=call)return;permissionCall=null;
  if(getPermissionState("microphone")!=PermissionState.GRANTED){call.reject("Microphone permission denied","permission-denied");return;}
  if(destroyed||!foreground){call.reject("Voice is not in the foreground");return;}
  start(call);
 }
 private void start(PluginCall call){
  final String id=call.getString("sessionId"),environment=call.getString("environment"),credential=call.getString("credentialId");
  try{UUID.fromString(id);if(credential==null||credential.length()>128)throw new IllegalArgumentException();}catch(Exception invalid){call.reject("Invalid speech session");return;}
  final Session own=new Session(id,environment,credential,AlphaLocalAgentPlugin.credentialAuthorityEpoch(),call);
  synchronized(this){if(session!=null||destroyed||!foreground){call.reject("Voice is already active or unavailable");return;}session=own;}mark(own,"start");main.postDelayed(own.deadline,12000);
  PluginWorkers.submit(control,()->{try{
   own.check();if(focus.callActive())throw new IOException("call-active");
   String host=CloudSpeechPolicy.host(BuildConfig.ELIZA_RUNTIME_PROFILE,BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS,environment);own.origin="https://"+host;
   own.token=AlphaLocalAgentPlugin.withCredentialAuthority(own.epoch,()->{
    JSONObject saved=new JSONObject(new AlphaCredentialStore(getContext()).readCredentialSlot("cloud:"+environment));
    if(!credential.equals(saved.optString("credentialId"))||saved.optLong("expiresAt",Long.MAX_VALUE)<=System.currentTimeMillis())throw new SecurityException("Cloud account changed");
    String token=saved.getString("token");if(token.isEmpty()||token.length()>16384||token.contains("\r")||token.contains("\n"))throw new SecurityException("Cloud account unavailable");return token;
   });
   JSONObject consent=post(own,"consent",new JSONObject());mark(own,"consent");String nonce=consent.getString("consentNonce");UUID.fromString(nonce);
   if(Instant.parse(consent.getString("expiresAt")).toEpochMilli()<=System.currentTimeMillis())throw new IOException("Expired consent");
   JSONObject minted=post(own,"session",new JSONObject().put("consentNonce",nonce));mark(own,"mint");
   own.serverId=minted.getString("sessionId");UUID.fromString(own.serverId);
   own.expiresAt=Instant.parse(minted.getString("expiresAt")).toEpochMilli();
   if(minted.getInt("version")!=1||own.expiresAt<=System.currentTimeMillis()||own.expiresAt>System.currentTimeMillis()+65000)throw new IOException("Invalid session expiry");
   String address=minted.getString("wsUrl"),expected="wss://"+host+BASE+"ws?sessionId="+own.serverId;
   if(!expected.equals(address))throw new IOException("Invalid speech destination");
   own.wireToken=minted.getString("token");if(own.wireToken.isEmpty()||own.wireToken.length()>6144)throw new IOException("Invalid speech token");
   own.check();own.socket=http.newWebSocket(new Request.Builder().url(address).build(),new RelayListener(own));
  }catch(Exception failure){fail(own,failure instanceof CloudHttpFailure?"cloud-http-"+((CloudHttpFailure)failure).status:failure instanceof java.net.UnknownHostException?"dns":failure instanceof java.net.SocketTimeoutException?"timeout":failure instanceof javax.net.ssl.SSLException?"tls":"connect");}},()->fail(own,"closed"));
 }
 private static final class CloudHttpFailure extends IOException {final int status;CloudHttpFailure(int status){super("Cloud speech HTTP refused");this.status=status;}}
 private JSONObject post(Session own,String path,JSONObject body)throws Exception{
  own.check();mark(own,path+"-start");Request request=new Request.Builder().url(own.origin+BASE+path).header("Authorization","Bearer "+own.token).post(RequestBody.create(body.toString(),JSON)).build();
  Call pending=http.newCall(request);own.pending=pending;
  try(Response response=pending.execute()){
   own.check();own.httpStatus=response.code();mark(own,path+"-headers");if(!response.isSuccessful())throw new CloudHttpFailure(response.code());ResponseBody bytes=response.body();if(bytes==null||bytes.contentLength()>32768)throw new IOException("Invalid speech response");
   try(java.io.InputStream in=bytes.byteStream()){java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] chunk=new byte[4096];int n;while((n=in.read(chunk))!=-1){if(out.size()+n>32768)throw new IOException("Oversized speech response");out.write(chunk,0,n);}mark(own,path+"-body");return new JSONObject(out.toString(StandardCharsets.UTF_8.name()));}
  }finally{own.pending=null;}
 }
 @PluginMethod public void stopCloudSpeech(PluginCall call){Session own=owned(call);if(own==null){call.resolve();return;}detach(own);queueCleanup(own,call::resolve);}
 @PluginMethod public void setCloudSpeechMuted(PluginCall call){
  Session own=owned(call);if(own==null){call.reject("Speech session changed");return;}
  boolean muted=Boolean.TRUE.equals(call.getBoolean("muted",false));own.muted=muted;long mute=++own.muteGeneration;if(muted)silence(own,mute,30);
  PluginWorkers.submit(media,()->{try{own.check();if(mute==own.muteGeneration){if(muted)stopCapture(own);else if(own.recorder==null)own.startCapture();}call.resolve();}catch(Exception failure){call.reject("Microphone could not change state");fail(own,"capture");}},()->call.reject("Voice is closed"));
 }
 @PluginMethod public void speakCloudSpeech(PluginCall call){
  Session own=owned(call);String id=call.getString("utteranceId"),text=call.getString("text");
  if(own==null||own.speakerDraining||!own.providerReady||!CloudSpeechWire.id(id)||text==null||text.trim().isEmpty()||text.length()>4096){call.reject("Invalid speech request");return;}
  main.post(()->{try{
   own.check();if(own.spoken!=null||own.speakerDraining)throw new IllegalStateException("Speaker is already active");String refused=focus.acquire();if(refused!=null)throw new IllegalStateException(refused);
   java.util.List<String> phrases=CloudSpeechWire.phrases(text);Utterance utterance=new Utterance(own,id);own.spoken=utterance;mark(own,"tts-request");
   for(String phrase:phrases)own.send(new JSONObject().put("t","tts").put("id",id).put("text",phrase).put("flush",true));
   own.send(new JSONObject().put("t","finish").put("id",id));call.resolve();
  }catch(Exception failure){cancelSpeech(own,id);call.reject("Speech could not start");}});
 }
 @PluginMethod public void cancelCloudSpeech(PluginCall call){main.post(()->{
  Session own=owned(call);Utterance retired=own==null?null:cancelSpeech(own,call.getString("utteranceId"));
  if(retired==null){call.resolve();return;}
  PluginWorkers.submit(media,()->{try{if(retired.playback!=null&&!retired.playback.join(1500)){call.reject("Speech cleanup was not confirmed","speech-cleanup-unconfirmed");fail(own,"playback");return;}own.speakerDraining=false;call.resolve();}catch(InterruptedException failure){Thread.currentThread().interrupt();call.reject("Speech cleanup was not confirmed","speech-cleanup-unconfirmed");}},()->call.reject("Speech cleanup was not confirmed","speech-cleanup-unconfirmed"));
 });}
 private Session owned(PluginCall call){Session own=session;return own!=null&&own.id.equals(call.getString("sessionId"))?own:null;}
 private Utterance cancelSpeech(Session own,String id){
  Utterance value=own.spoken;if(value==null||id!=null&&!value.id.equals(id))return null;
  synchronized(value){if(own.spoken!=value)return null;own.spoken=null;own.speakerDraining=value.playback!=null;value.cancelled=true;}
  if(value.playback!=null)value.playback.stop();
  try{own.send(new JSONObject().put("t","cancel").put("id",value.id));}catch(Exception ignored){}
  main.post(()->{if(session==null||session==own)focus.release();});return value;
 }
 private final class RelayListener extends WebSocketListener {
  final Session own;RelayListener(Session own){this.own=own;}
  @Override public void onOpen(WebSocket socket,Response response){try{own.socket=socket;own.check();mark(own,"ws-open");own.send(new JSONObject().put("t","hello").put("token",own.wireToken).put("errorReasons",true));own.wireToken=null;}catch(Exception error){fail(own,"connect");}}
  @Override public void onMessage(WebSocket socket,String text){
   try{own.check();if(text.getBytes(StandardCharsets.UTF_8).length>8192)throw new IOException("Oversized speech control");JSONObject row=new JSONObject(text);String type=row.getString("t");
    if("ready".equals(type)){if(own.ready||row.getInt("version")!=1||row.getInt("sampleRate")!=16000||row.getInt("channels")!=1)throw new IOException("Invalid speech format");own.ready=true;mark(own,"ready");main.postDelayed(()->retire(own,"expired"),Math.max(1,own.expiresAt-System.currentTimeMillis()));return;}
    if(!own.ready)throw new IOException("Speech is not ready");
    if("stt".equals(type)){JSONObject data=row.getJSONObject("event");String event=data.getString("type");if("connected".equals(event)){if(own.providerReady)throw new IOException("Duplicate provider readiness");own.providerReady=true;mark(own,"stt-connected");PluginWorkers.submit(media,()->{try{own.startCapture();main.removeCallbacks(own.deadline);}catch(Exception failed){fail(own,"capture");}},()->fail(own,"closed"));return;}String transcript=data.optString("transcript","");if(transcript.length()>16384)throw new IOException("Transcript too large");
     if("start-of-turn".equals(event)||"turn-resumed".equals(event)){mark(own,"speech-start");emit(own,"speech-start",new JSObject());}
     else if("end-of-turn".equals(event)){mark(own,"asr-final");emit(own,"speech-end",new JSObject().put("text",transcript).put("final",true));}
     else if("transcript-update".equals(event)||"eager-end-of-turn".equals(event))emit(own,"transcript",new JSObject().put("text",transcript).put("final",false));
     else throw new IOException("Invalid recognition event");
    }else if("complete".equals(type)){Utterance u=own.spoken;if(u!=null&&u.id.equals(row.optString("id"))&&!u.cancelled){if(u.playback==null||u.finished)throw new IOException("Speech completed without audio");u.finished=true;u.playback.offer(null,true);}}
    else if("error".equals(type))fail(own,"unavailable");
    else if(!"tts_prepared".equals(type)&&!"flush_complete".equals(type))throw new IOException("Invalid speech event");
   }catch(Exception error){fail(own,"protocol");}
  }
  @Override public void onMessage(WebSocket socket,ByteString bytes){
   try{own.check();CloudSpeechWire.Audio frame=CloudSpeechWire.decode(bytes.toByteArray());Utterance u=own.spoken;if(u==null||u.cancelled||!u.id.equals(frame.id))return;if(u.finished||own.receivedBytes+frame.pcm.length>8*1024*1024)throw new IOException("Invalid speech output");
    synchronized(u){if(u.cancelled||own.spoken!=u)return;if(u.playback==null){u.playback=new StreamingSpeechPlayback(16000*5,16000,0.005f,()->AudioTrackSpeechOutput.open(16000),new StreamingSpeechPlayback.Listener(){
     public void firstFrame(long nanos){markAt(own,"first-pcm",nanos,null,u.started);emit(own,"audio-start",new JSObject().put("utteranceId",u.id).put("elapsedMs",(nanos-u.started)/1_000_000));}
     public void audible(long nanos,String clock){u.audible=nanos;markAt(own,"first-audible",nanos,clock,u.started);}
     public void ended(boolean silent){if(own.spoken!=u||u.cancelled)return;own.spoken=null;mark(own,"audio-end");main.post(()->{if(session==null||session==own)focus.release();});emit(own,"audio-end",new JSObject().put("utteranceId",u.id).put("silent",silent));}
     public void failed(String reason){if(own.spoken==u&&!u.cancelled)fail(own,"playback");}
    },System::nanoTime);u.playback.start();}}
    own.receivedFrames++;own.receivedBytes+=frame.pcm.length;float[] samples=CloudSpeechWire.floats(frame.pcm);Arrays.fill(frame.pcm,(byte)0);try{for(int start=0;start<samples.length;start+=1600)if(!u.playback.offer(Arrays.copyOfRange(samples,start,Math.min(samples.length,start+1600)),false))throw new IOException("Speech playback stalled");}finally{Arrays.fill(samples,0f);}
   }catch(Exception error){fail(own,"playback");}
  }
  @Override public void onFailure(WebSocket socket,Throwable error,Response response){fail(own,"connection-lost");}
  @Override public void onClosed(WebSocket socket,int code,String reason){if(!own.closed.get())fail(own,"connection-lost");}
 }
 private final class Session {
  final String id,environment,credential;final long epoch,started=System.nanoTime(),diagnosticId=++timingSequence;final PluginCall startCall;final AtomicBoolean closed=new AtomicBoolean(),startSettled=new AtomicBoolean();
  volatile String origin,token,wireToken,serverId;volatile long expiresAt,sentFrames,sentBytes,receivedFrames,receivedBytes;volatile int httpStatus;volatile boolean ready,providerReady,muted,speakerDraining;volatile long muteGeneration;volatile Call pending;volatile WebSocket socket;volatile AudioRecord recorder;volatile AcousticEchoCanceler echo;volatile Thread capture;volatile Utterance spoken;
  final Runnable deadline=()->fail(this,"startup-timeout");
  Session(String id,String environment,String credential,long epoch,PluginCall call){this.id=id;this.environment=environment;this.credential=credential;this.epoch=epoch;this.startCall=call;}
  void check()throws IOException{if(closed.get()||session!=this||destroyed||!foreground||epoch!=AlphaLocalAgentPlugin.credentialAuthorityEpoch())throw new IOException("Speech session changed");}
  void send(JSONObject value)throws IOException{check();WebSocket peer=socket;if(peer==null||peer.queueSize()>64000||!peer.send(value.toString()))throw new IOException("Speech transport unavailable");}
  void startCapture()throws Exception{
   check();int minimum=AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT);if(minimum<=0)throw new IOException("Capture unavailable");
   boolean cancel=AcousticEchoCanceler.isAvailable();AudioRecord next=new AudioRecord.Builder().setAudioSource(cancel?MediaRecorder.AudioSource.VOICE_COMMUNICATION:MediaRecorder.AudioSource.VOICE_RECOGNITION).setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(16000).setChannelMask(AudioFormat.CHANNEL_IN_MONO).build()).setBufferSizeInBytes(Math.max(minimum,6400)).build();
   recorder=next;if(next.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("Capture unavailable");if(cancel){echo=AcousticEchoCanceler.create(next.getAudioSessionId());if(echo!=null)echo.setEnabled(true);}boolean echoEnabled=echo!=null&&echo.getEnabled();
   check();next.startRecording();if(next.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)throw new IOException("Capture unavailable");
   capture=new Thread(()->{byte[] frame=new byte[1024];long levelAt=0;try{while(!closed.get()&&!muted&&recorder==next){check();int count=next.read(frame,0,frame.length,AudioRecord.READ_BLOCKING);if(count<=0||count%2!=0)throw new IOException("Microphone stopped");long now=System.nanoTime();if(now-levelAt>50_000_000L){levelAt=now;emit(this,"level",new JSObject().put("peak",muted?0:CloudSpeechWire.peak(frame,count)));}if(!muted){WebSocket peer=socket;if(peer==null||peer.queueSize()>64000||!peer.send(ByteString.of(frame,0,count)))throw new IOException("Speech upload stalled");sentFrames++;sentBytes+=count;}}}catch(Exception error){if(!closed.get()&&!muted&&recorder==next)fail(this,"capture");}finally{Arrays.fill(frame,(byte)0);}},"alpha-cloud-speech-microphone");capture.setDaemon(true);capture.start();
   emit(this,"ready",new JSObject().put("sampleRate",16000).put("echoCancelled",echoEnabled));if(startSettled.compareAndSet(false,true))startCall.resolve(new JSObject().put("sessionId",id).put("sampleRate",16000).put("echoCancelled",echoEnabled));
  }
 }
 private static final class Utterance {final String id;final long started=System.nanoTime();volatile boolean cancelled,finished;volatile long audible;volatile StreamingSpeechPlayback playback;Utterance(Session own,String id){this.id=id;}}
 private void emit(Session own,String type,JSObject detail){if(own.closed.get()||session!=own)return;detail.put("sessionId",own.id);detail.put("type",type);notifyListeners("cloudSpeechEvent",detail);}
 private void fail(Session own,String code){if(own.closed.get())return;mark(own,"error");emit(own,"error",new JSObject().put("code",code).put("status",own.httpStatus));if(own.startSettled.compareAndSet(false,true))own.startCall.reject("Cloud streaming speech is unavailable",code);retire(own,null);}
 private void retire(Session own,String reason){if(reason!=null)emit(own,"error",new JSObject().put("code",reason));detach(own);queueCleanup(own,()->{});}
 private void detach(Session own){if(!own.closed.compareAndSet(false,true))return;mark(own,"stop");synchronized(this){if(session==own)session=null;}main.removeCallbacks(own.deadline);Call call=own.pending;if(call!=null)call.cancel();WebSocket socket=own.socket;if(socket!=null)socket.cancel();if(own.startSettled.compareAndSet(false,true))own.startCall.reject("Cloud streaming speech stopped","cancelled");Utterance u=own.spoken;if(u!=null){synchronized(u){u.cancelled=true;}if(u.playback!=null)u.playback.stop();}main.post(()->{if(session==null||session==own)focus.release();});}
 /** A bounded silence tail closes Ink's current turn after the physical mic stops. */
 private void silence(Session own,long generation,int remaining){
  if(remaining<=0||!own.muted||own.muteGeneration!=generation||own.closed.get())return;
  try{own.check();WebSocket socket=own.socket;if(socket==null||socket.queueSize()>64000||!socket.send(ByteString.of(new byte[1024])))throw new IOException();own.sentFrames++;own.sentBytes+=1024;}catch(Exception ignored){return;}
  main.postDelayed(()->silence(own,generation,remaining-1),32);
 }
 private void stopCapture(Session own){
  AudioRecord recorder=own.recorder;own.recorder=null;
  if(recorder!=null)try{recorder.stop();}catch(RuntimeException ignored){}
  Thread capture=own.capture;own.capture=null;if(capture!=null&&capture!=Thread.currentThread())try{capture.join(1500);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}
  if(own.echo!=null){own.echo.release();own.echo=null;}if(recorder!=null)recorder.release();
 }
 private void queueCleanup(Session own,Runnable done){Runnable work=()->{cleanup(own);done.run();};PluginWorkers.submit(media,work,()->{Thread thread=new Thread(work,"alpha-cloud-speech-retire");thread.setDaemon(true);thread.start();});}
 private void cleanup(Session own){
  stopCapture(own);
  Utterance u=own.spoken;if(u!=null&&u.playback!=null)try{u.playback.join(1500);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}own.spoken=null;
  final String token=own.token,origin=own.origin,id=own.serverId;own.token=null;own.wireToken=null;
  // Revoke is best effort after local microphone and speaker release; no cleanup retry can replay audio.
  if(id!=null&&origin!=null&&token!=null)try{Request request=new Request.Builder().url(origin+BASE+"session/"+id+"/revoke").header("Authorization","Bearer "+token).post(RequestBody.create("{}",JSON)).build();http.newCall(request).enqueue(new Callback(){public void onFailure(Call call,IOException failure){}public void onResponse(Call call,Response response){response.close();}});}catch(RuntimeException ignored){}
 }
 @Override protected void handleOnResume(){foreground=true;super.handleOnResume();}
 @Override protected void handleOnPause(){foreground=false;PluginCall pending=permissionCall;permissionCall=null;if(pending!=null)pending.reject("Voice stopped");Session own=session;if(own!=null)retire(own,null);super.handleOnPause();}
 @Override protected void handleOnDestroy(){destroyed=true;Session own=session;if(own!=null){detach(own);queueCleanup(own,()->{});}control.shutdown();media.shutdown();http.dispatcher().executorService().shutdown();http.connectionPool().evictAll();main.post(()->focus.close());super.handleOnDestroy();}
}
