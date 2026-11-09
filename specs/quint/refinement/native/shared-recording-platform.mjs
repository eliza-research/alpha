import {writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {noteBridgePlatform} from './note-bridge-platform.mjs';

/** Primitive ports for the full shared bridge's recording and cancellation paths. */
export function sharedRecordingPlatform(){
 const base=noteBridgePlatform(),files={...base.sources};
 for(const name of ['ai/eliza/voice/LocalSpeechBridgePlugin.java','ai/eliza/voice/SpeechRequestGate.java','ai/elizaresearch/alphaphone/AlphaNoteAudioPlugin.java']){
  delete files[name];unlinkSync(join(base.directory,name));
 }
 files['android/content/Context.java']=files['android/content/Context.java'].replace('public class Context {','public class Context {\n public void registerComponentCallbacks(ComponentCallbacks2 callback){}\n public void unregisterComponentCallbacks(ComponentCallbacks2 callback){}');
 files['com/getcapacitor/Plugin.java']=files['com/getcapacitor/Plugin.java'].replace(' public void load(){}',' public void load(){}\n public void requestPermissions(PluginCall call){throw new AssertionError("Unexercised generic permission");}');
 // Host org.json adds a float put overload absent from Android org.json. Widen this sink only.
 files['com/getcapacitor/Plugin.java']=files['com/getcapacitor/Plugin.java'].replace('String event,JSObject value','String event,org.json.JSONObject value');
 files['com/getcapacitor/PluginCall.java']=files['com/getcapacitor/PluginCall.java'].replace(' public final JSObject data;',' public final JSObject data;\n private static int sequence;\n private final String callback="callback-"+(++sequence);\n public String getCallbackId(){return callback;}\n public Integer getInt(String key,Integer fallback){return data.getInteger(key,fallback);}');
 Object.assign(files,{
  'android/content/ComponentCallbacks2.java':'package android.content;public interface ComponentCallbacks2 {int TRIM_MEMORY_UI_HIDDEN=20,TRIM_MEMORY_RUNNING_LOW=10;void onConfigurationChanged(android.content.res.Configuration value);void onLowMemory();void onTrimMemory(int level);}',
  'android/content/res/Configuration.java':'package android.content.res;public class Configuration {}',
  'android/media/MediaPlayer.java':`package android.media;
public class MediaPlayer {
 public interface Completion {void call(MediaPlayer player);}
 public interface Failure {boolean call(MediaPlayer player,int what,int extra);}
 public void release(){throw new AssertionError("Unexercised player");}
 public void setAudioAttributes(Object attributes){throw new AssertionError("Unexercised player");}
 public void setDataSource(String path){throw new AssertionError("Unexercised player");}
 public void setOnCompletionListener(Completion callback){throw new AssertionError("Unexercised player");}
 public void setOnErrorListener(Failure callback){throw new AssertionError("Unexercised player");}
 public void setOnPreparedListener(Completion callback){throw new AssertionError("Unexercised player");}
 public void prepareAsync(){throw new AssertionError("Unexercised player");}
 public void start(){throw new AssertionError("Unexercised player");}
 public void setVolume(float left,float right){throw new AssertionError("Unexercised player");}
}`,
  'ai/eliza/voice/SpeechAudioFocus.java':`package ai.eliza.voice;
public class SpeechAudioFocus {
 public static final Object ATTRIBUTES=new Object();
 public static Runnable callCallback;
 public interface Listener {void changed(SpeechAudioFocusPolicy.Action action,boolean call);}
 public SpeechAudioFocus(android.content.Context context,android.os.Handler main,Listener listener){}
 public boolean callActive(){return ai.elizaresearch.alphaphone.NoteBridgePorts.audio.mode!=android.media.AudioManager.MODE_NORMAL;}
 public void watchCalls(java.util.concurrent.Executor executor,Runnable callback){callCallback=()->executor.execute(callback);}
 public String acquire(){throw new AssertionError("Unexercised audio focus acquisition");}
 public void release(){}
 public void close(){}
}`,
  'ai/eliza/voice/SessionSpeech.java':'package ai.eliza.voice;public class SessionSpeech {public static LocalSpeechEngine.Backend shared(android.content.Context context){throw new AssertionError("Unexercised speech inference");}}',
  'ai/eliza/voice/VoiceLatencyProbe.java':`package ai.eliza.voice;
public class VoiceLatencyProbe {
 public static final float AUDIBLE_LEVEL=0.01f;
 public static final VoiceLatencyTrials TRIALS=new VoiceLatencyTrials(System::nanoTime);
 public static int leadInFrames(float[] samples){throw new AssertionError("Unexercised speech latency");}
 public static void stampEnvironment(android.content.Context context,VoiceLatencyTrials.Trial trial){throw new AssertionError("Unexercised speech latency");}
 public static void playbackStarted(VoiceLatencyTrials.Trial trial,android.content.Context context,android.media.MediaPlayer player,android.os.Handler main,int lead,int frames,int rate,java.util.function.BooleanSupplier current){throw new AssertionError("Unexercised speech latency");}
 public static org.json.JSONObject export(android.content.Context context){throw new AssertionError("Unexercised speech latency");}
}`,
  'ai/eliza/voice/AudioTrackSpeechOutput.java':'package ai.eliza.voice;public class AudioTrackSpeechOutput {public static StreamingSpeechPlayback.Output open(int rate){throw new AssertionError("Unexercised audio output");}}',
  'ai/eliza/voice/VoiceAssets.java':'package ai.eliza.voice;public class VoiceAssets {public static Object sharedInference(android.content.Context context){throw new AssertionError("Unexercised live inference");}}',
  'ai/eliza/voice/LiveVoiceCapture.java':`package ai.eliza.voice;
public class LiveVoiceCapture {
 public interface Sink {void frames(String id,org.json.JSONArray frames,org.json.JSONArray vad,float peak);void ended(String id,String error);}
 public LiveVoiceCapture(android.content.Context context,Object inference,String id,Sink sink,boolean echo){throw new AssertionError("Unexercised live microphone");}
 public static boolean vadAvailable(Object inference){throw new AssertionError("Unexercised live inference");}
}`,
  'ai/eliza/voice/LiveCaptureController.java':`package ai.eliza.voice;
public class LiveCaptureController {
 public interface Host {
  boolean open(long epoch);LiveVoiceCapture capture(String id,LiveVoiceCapture.Sink sink,boolean echo)throws Exception;
  void frames(String id,org.json.JSONArray frames,org.json.JSONArray vad,float peak);void ended(String id,String error);
  void transcript(String id,org.json.JSONObject value,String error);
 }
 public interface Route {Object open()throws Exception;}
 public interface Started {void started(String id,int rate,boolean echo,boolean piped);void refused(String message,String code);}
 public interface Stopped {void stopped(String id,long duration,boolean closed);}
 public static final String CANCELLED="Recording cancelled";
 public LiveCaptureController(Host host){}
 public void cancelAll(){}
 public void shutdown(){}
 public void interrupt(String reason){}
 public void onWorker(Runnable work,Runnable refused){throw new AssertionError("Unexercised live capture");}
 public LiveCaptureAdmission.Ticket reserve(String id,long epoch){throw new AssertionError("Unexercised live admission");}
 public boolean current(LiveCaptureAdmission.Ticket ticket){throw new AssertionError("Unexercised live admission");}
 public void start(LiveCaptureAdmission.Ticket ticket,boolean echo,Route route,String room,boolean reopen,Started callback){throw new AssertionError("Unexercised live capture");}
 public void stop(String id,boolean discard,double cutoff,Stopped callback){throw new AssertionError("Unexercised live stop");}
}`,
 });
 for(const [name,body] of Object.entries(files)){const path=join(base.directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);}
 return {directory:base.directory,paths:Object.keys(files).map(name=>join(base.directory,name)),close:base.close};
}
