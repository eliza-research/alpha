import {writeFileSync,mkdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {noteRecordingPlatform} from './note-recording-platform.mjs';

/** Full AlphaVoiceCloudPlugin note entry points with unexercised speech transports fenced. */
export function noteBridgePlatform() {
 const base=noteRecordingPlatform();
 const files={...base.sources};
 files['android/content/Context.java']=files['android/content/Context.java'].replace('public class Context {','public class Context {\n  public static final String AUDIO_SERVICE="audio";\n  public Object getSystemService(String name){return ai.elizaresearch.alphaphone.NoteBridgePorts.audio;}');
 files['android/os/Handler.java']=files['android/os/Handler.java'].replace('public boolean post(Runnable task){task.run();return true;}','public boolean post(Runnable task){ai.elizaresearch.alphaphone.NoteBridgePorts.post(task);return true;}');
 files['android/media/MediaRecorder.java']=files['android/media/MediaRecorder.java'].replace('    bytes();','    bytes();ai.elizaresearch.alphaphone.NoteBridgePorts.starts++;');
 Object.assign(files,{
  'ai/eliza/plugins/passwords/PasswordSurfaces.java':`package ai.eliza.plugins.passwords;
public final class PasswordSurfaces {public interface Listener {void onSecretSurfaceChanged(boolean visible);}public static void addListener(Listener value){}public static void removeListener(Listener value){}public static boolean visible(){return false;}}`,
  'ai/eliza/plugins/agent/runtime/NativeProviderSlot.java':`package ai.eliza.plugins.agent.runtime;
public final class NativeProviderSlot {public static String managementRevision(String value,long epoch){throw new AssertionError("Unexercised provider revision");}}`,
  'ai/eliza/plugins/media/RecordingWindow.java':`package ai.eliza.plugins.media;
public final class RecordingWindow implements AutoCloseable {
 public java.io.File file;public boolean empty;
 public static RecordingWindow open(Object store,java.io.File cache,String field,String id,String owner,Long offset,Long duration,java.util.function.BooleanSupplier cancelled){throw new AssertionError("Unexercised saved recording window");}
 public void check(){throw new AssertionError("Unexercised saved recording window");}
 public void close(){throw new AssertionError("Unexercised saved recording window");}
}`,
  'android/Manifest.java':'package android;public class Manifest {public static class permission {public static final String RECORD_AUDIO="audio";}}',
  'android/media/AudioManager.java':`package android.media;
public class AudioManager {
 public static final int MODE_NORMAL=0,MODE_IN_CALL=1,MODE_IN_COMMUNICATION=2,MODE_RINGTONE=3;
 public int mode;
 public int getMode(){return mode;}
}`,
  'com/getcapacitor/PermissionState.java':'package com.getcapacitor;public enum PermissionState {GRANTED,DENIED,PROMPT}',
  'com/getcapacitor/PluginMethod.java':'package com.getcapacitor;public @interface PluginMethod {}',
  'com/getcapacitor/annotation/Permission.java':'package com.getcapacitor.annotation;public @interface Permission {String alias();String[] strings();}',
  'com/getcapacitor/annotation/PermissionCallback.java':'package com.getcapacitor.annotation;public @interface PermissionCallback {}',
  'com/getcapacitor/annotation/CapacitorPlugin.java':'package com.getcapacitor.annotation;public @interface CapacitorPlugin {String name();Permission[] permissions() default {};}',
  'com/getcapacitor/PluginCall.java':`package com.getcapacitor;
public class PluginCall {
 public final JSObject data;
 public JSObject result;
 public String rejected,code;
 public int settled;
 public PluginCall(JSObject data){this.data=data;}
 public String getString(String key){return data.getString(key);}
 public String getString(String key,String fallback){return data.getString(key,fallback);}
 public Boolean getBoolean(String key,Boolean fallback){return data.getBoolean(key,fallback);}
 public JSObject getData(){return data;}
 public Long getLong(String key){return data.has(key)?data.optLong(key):null;}
 public void resolve(){settled++;}
 public void resolve(JSObject value){result=value;settled++;}
 public void reject(String message){rejected=message;settled++;}
 public void reject(String message,String code){this.code=code;reject(message);}
 public void reject(String message,String code,JSObject details){reject(message,code);}
}`,
  'android/app/Activity.java':'package android.app;public class Activity extends android.content.Context {public void runOnUiThread(Runnable task){task.run();}}',
  'com/getcapacitor/Plugin.java':`package com.getcapacitor;
public class Plugin {
 public void load(){}
 protected void handleOnPause(){}
 protected void handleOnResume(){}
 protected void handleOnDestroy(){}
 public android.content.Context getContext(){return ai.elizaresearch.alphaphone.NoteBridgePorts.context;}
 public PermissionState getPermissionState(String alias){return ai.elizaresearch.alphaphone.NoteBridgePorts.permission;}
 public void requestPermissionForAlias(String alias,PluginCall call,String callback){ai.elizaresearch.alphaphone.NoteBridgePorts.permissionCall=call;ai.elizaresearch.alphaphone.NoteBridgePorts.permissionCallback=callback;}
 public void notifyListeners(String event,JSObject value){ai.elizaresearch.alphaphone.NoteBridgePorts.events.put(new org.json.JSONObject().put("event",event).put("value",value));}
 public android.app.Activity getActivity(){return new android.app.Activity();}
 public Bridge getBridge(){return new Bridge();}
 public static class Bridge {public Handle getPlugin(String name){throw new AssertionError("Unexercised plugin lookup: "+name);}}
 public static class Handle {public Object getInstance(){throw new AssertionError("Unexercised plugin");}}
}`,
  'ai/eliza/voice/LocalSpeechBridgePlugin.java':`package ai.eliza.voice;
import com.getcapacitor.*;
public abstract class LocalSpeechBridgePlugin extends Plugin {
 public static final String CALL_MESSAGE="Speech is paused while a phone call is active";
 private final String prefix;
 private LocalVoiceRecording capture;
 private boolean closed;
 private final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
 protected LocalSpeechBridgePlugin(String recordingPrefix,String playbackPrefix){prefix=recordingPrefix;}
 public void load(){capture=new LocalVoiceRecording(getContext(),prefix,value->{});}
 protected final LocalVoiceRecording recording(){return capture;}
 protected final boolean destroyed(){return closed;}
 protected boolean sensitiveSurfaceActive(){return false;}
 protected final void retireSpeechAuthority(){throw new AssertionError("Unexercised parent speech retirement");}
 protected final android.os.Handler mainHandler(){return main;}
 protected void handleOnDestroy(){closed=true;}
 public void fixtureDestroy(){handleOnDestroy();}
 protected LiveCaptureController.Route residentRoute(String owner){return null;}
 protected boolean residentTransport(){return false;}
 protected boolean launch(PluginCall call,Runnable request){request.run();return true;}
 protected void rejectFailure(PluginCall call,String message,String code,Exception failure){call.reject(message,code);}
 protected interface Work {void run(SpeechRequestGate.Request request)throws Exception;}
 protected final void submit(PluginCall call,Work work){throw new AssertionError("Unexercised speech transport");}
 protected static String required(String value,int maximum){if(value==null||value.isBlank()||value.length()>maximum)throw new IllegalArgumentException();return value;}
 protected static byte[] read(java.io.InputStream source,int maximum,SpeechRequestGate.Request request){throw new AssertionError("Unexercised speech input");}
 protected static void successful(java.net.HttpURLConnection connection){throw new AssertionError("Unexercised speech HTTP");}
 protected final boolean speakerBusy(){return false;}
 protected final void synthesizeReviewed(PluginCall call,String text){throw new AssertionError("Unexercised synthesis");}
 protected final void publishPreparedAudio(PluginCall call,SpeechRequestGate.Request request,byte[] bytes){throw new AssertionError("Unexercised playback");}
 protected final void cancelSpeech(String id){throw new AssertionError("Unexercised cancellation");}
}`,
  'ai/eliza/voice/LiveCaptureController.java':'package ai.eliza.voice;public class LiveCaptureController {public interface Route {Object open()throws Exception;}}',
  'ai/eliza/voice/SpeechRequestGate.java':`package ai.eliza.voice;
public class SpeechRequestGate {public static class Request {public boolean cancelled;public String failure,failureCode;public Object result;public java.net.HttpURLConnection connection;}}`,
  'ai/eliza/voice/RecordingPcm.java':'package ai.eliza.voice;public class RecordingPcm {public static byte[] decode(java.io.File file,java.util.function.BooleanSupplier cancelled){throw new AssertionError("Unexercised decoder");}}',
  'ai/eliza/voice/CartesiaSpeech.java':`package ai.eliza.voice;
public class CartesiaSpeech {
 public interface Guard {void check()throws Exception;void opened(java.net.HttpURLConnection connection)throws Exception;}
 public static final Object HTTPS=new Object();
 public static class HttpFailure extends java.io.IOException {public int status;}
 public static String transcribe(String key,byte[] audio,Guard guard,Object http){throw new AssertionError("Unexercised HTTP");}
 public static byte[] synthesize(String key,String text,Guard guard,Object http){throw new AssertionError("Unexercised HTTP");}
}`,
  'ai/eliza/voice/SpeechStreamBridgePlugin.java':`package ai.eliza.voice;
public abstract class SpeechStreamBridgePlugin extends com.getcapacitor.Plugin {
 protected static class Credential {public Credential(String token,long expiry){}}
 protected boolean sensitiveSurfaceActive(){return false;}
 protected final void retireSpeechAuthority(){throw new AssertionError("Unexercised streaming retirement");}
 protected com.getcapacitor.JSObject limitData(int status,String retryAfter,String body){return null;}
 protected abstract long authorityEpoch();
 protected abstract String cloudOrigin(String environment)throws Exception;
 protected abstract String diagnosticFormat();
 protected abstract Credential readCredential(String environment,String id,long epoch)throws Exception;
 protected abstract boolean launch(com.getcapacitor.PluginCall call,Runnable action);
}`,
  'ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java':`package ai.elizaresearch.alphaphone;
public class AlphaLocalAgentPlugin {
 public static Object openNativeVoiceTransport(String owner){throw new AssertionError("Unexercised resident route");}
 public static long credentialAuthorityEpoch(){throw new AssertionError("Unexercised credentials");}
 public static <T>T withCredentialAuthority(long epoch,java.util.concurrent.Callable<T> task)throws Exception {throw new AssertionError("Unexercised credentials");}
}`,
  'ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java':'package ai.elizaresearch.alphaphone;public class AlphaConnectionPlugin {public String readCredentialSlot(String slot){throw new AssertionError("Unexercised credentials");}}',
  'ai/elizaresearch/alphaphone/AlphaCredentialStore.java':'package ai.elizaresearch.alphaphone;public class AlphaCredentialStore {public AlphaCredentialStore(android.content.Context context){}public String readCredentialSlot(String slot){throw new AssertionError("Unexercised credentials");}}',
  'ai/elizaresearch/alphaphone/AlphaNoteAudioPlugin.java':`package ai.elizaresearch.alphaphone;
public class AlphaNoteAudioPlugin {
 public static Object recordings(android.content.Context context){throw new AssertionError("Unexercised retained audio");}
 public com.getcapacitor.JSObject retain(java.io.File file,String id,String note,long duration,String text){throw new AssertionError("Unexercised retention");}
 public void saveNoteRecording(com.getcapacitor.PluginCall call,AlphaNoteRecorder recorder,String id){throw new AssertionError("Unexercised retention");}
}`,
  'ai/elizaresearch/alphaphone/AlphaBrowserPlugin.java':'package ai.elizaresearch.alphaphone;public class AlphaBrowserPlugin {public String consumeReading(com.getcapacitor.PluginCall call){throw new AssertionError("Unexercised browser");}}',
  'ai/elizaresearch/alphaphone/CloudSpeechPolicy.java':'package ai.elizaresearch.alphaphone;public class CloudSpeechPolicy {public static String host(String profile,boolean mocks,String environment){throw new AssertionError("Unexercised cloud");}public static void requireProvider(String profile,String provider){throw new AssertionError("Unexercised cloud");}}',
  'ai/elizaresearch/alphaphone/LocalAgentProviderAdmission.java':'package ai.elizaresearch.alphaphone;public class LocalAgentProviderAdmission {public static void requireCloudVoiceSelection(String provider,String id){throw new AssertionError("Unexercised provider");}public static boolean validProviderToken(String token,int max){throw new AssertionError("Unexercised provider");}}',
  'ai/elizaresearch/alphaphone/PairedAgentCredential.java':'package ai.elizaresearch.alphaphone;public class PairedAgentCredential {public boolean cloud;public String token;public static PairedAgentCredential resolve(com.getcapacitor.PluginCall call,AlphaConnectionPlugin store){throw new AssertionError("Unexercised pairing");}}',
  'ai/elizaresearch/alphaphone/PairedSpeechContract.java':`package ai.elizaresearch.alphaphone;
public class PairedSpeechContract {
 public static final String ASR_PATH="asr",TTS_PATH="tts",ASR_PROVIDER="asr";
 public static String requestId(String value){throw new AssertionError("Unexercised speech");}
 public static String transcript(org.json.JSONObject value){throw new AssertionError("Unexercised speech");}
 public static boolean asrReady(org.json.JSONObject value){throw new AssertionError("Unexercised speech");}
 public static boolean ttsReady(org.json.JSONObject value){throw new AssertionError("Unexercised speech");}
 public static org.json.JSONObject ttsBody(String value){throw new AssertionError("Unexercised speech");}
 public static void ttsHeaders(String a,String b,String c,String d){throw new AssertionError("Unexercised speech");}
}`,
  'ai/elizaresearch/alphaphone/BuildConfig.java':'package ai.elizaresearch.alphaphone;public class BuildConfig {public static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=false;public static final String ELIZA_RUNTIME_PROFILE="production";}',
  'ai/elizaresearch/alphaphone/LateLaunch.java':'package ai.elizaresearch.alphaphone;public class LateLaunch {public static boolean ask(com.getcapacitor.PluginCall call,Runnable action){action.run();return true;}}',
 });
 for(const [name,body] of Object.entries(files)){const file=join(base.directory,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);}
 return {directory:base.directory,sources:files,paths:Object.keys(files).map(name=>join(base.directory,name)),close:base.close};
}
