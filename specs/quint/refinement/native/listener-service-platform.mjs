import {mkdirSync,writeFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {listenerStorePlatform} from './listener-store-platform.mjs';

/** Framework/audio boundaries for the actual shared listener, store and service. */
export function listenerServicePlatform(){
 const platform=listenerStorePlatform();
 const files={
  'android/Manifest.java':'package android;public final class Manifest {public static class permission {public static final String RECORD_AUDIO="record";}}',
  'android/content/Context.java':`package android.content;public class Context {
   public static final int MODE_PRIVATE=0;public Context createDeviceProtectedStorageContext(){return this;}public Context getApplicationContext(){return this;}
   public SharedPreferences getSharedPreferences(String name,int mode){return ai.eliza.sense.StorePorts.preferences;}
   public boolean stopService(Intent intent){ai.eliza.sense.StorePorts.stops++;return true;}public ComponentName startForegroundService(Intent intent){ai.eliza.sense.ServicePorts.starts++;return null;}
   public ContentResolver getContentResolver(){return ai.eliza.sense.ServicePorts.resolver;}public String getPackageName(){return "ai.alphacompute.alphaphone.sense";}
   public android.content.pm.PackageManager getPackageManager(){return new android.content.pm.PackageManager();}
   public int checkSelfPermission(String permission){return ai.eliza.sense.ServicePorts.permission?0:-1;}
   public java.util.concurrent.Executor getMainExecutor(){return Runnable::run;}
   public <T>T getSystemService(Class<T> type){return type.cast(type==android.media.AudioManager.class?ai.eliza.sense.ServicePorts.audio:type==android.os.UserManager.class?new android.os.UserManager():new android.app.KeyguardManager());}
  }`,
  'android/content/ContentResolver.java':`package android.content;public class ContentResolver {
   public boolean observed;public void registerContentObserver(Object uri,boolean descendants,android.database.ContentObserver observer){observed=true;}
   public void unregisterContentObserver(android.database.ContentObserver observer){observed=false;}
  }`,
  'android/content/ComponentName.java':'package android.content;public class ComponentName {public ComponentName(String packageName,String name){}}',
  'android/content/Intent.java':'package android.content;public class Intent {public Intent(){}public Intent(Context context,Class<?> type){}public Intent setComponent(ComponentName name){return this;}}',
  'android/content/pm/PackageManager.java':`package android.content.pm;public class PackageManager {
   public static final int PERMISSION_GRANTED=0;public static class NameNotFoundException extends Exception {}public static class PackageInfo {public long lastUpdateTime;}
   public PackageInfo getPackageInfo(String name,int flags)throws NameNotFoundException {PackageInfo info=new PackageInfo();info.lastUpdateTime=ai.eliza.sense.StorePorts.install;return info;}
  }`,
  'android/content/pm/ServiceInfo.java':'package android.content.pm;public class ServiceInfo {public static final int FOREGROUND_SERVICE_TYPE_MICROPHONE=128;}',
  'android/app/Service.java':`package android.app;public class Service extends android.content.Context {
   public static final int START_STICKY=1,STOP_FOREGROUND_REMOVE=1;public boolean created,foreground,selfStopped,superDestroyed;
   public void onCreate(){created=true;}public int onStartCommand(android.content.Intent intent,int flags,int id){return 0;}public android.os.IBinder onBind(android.content.Intent intent){return null;}
   public void onDestroy(){superDestroyed=true;}public void stopSelf(){selfStopped=true;}public void stopForeground(int flags){foreground=false;}
   public void startForeground(int id,Object notification,int type){if(ai.eliza.sense.ServicePorts.foregroundFails)throw new IllegalStateException("foreground refused");foreground=true;}
  }`,
  'android/app/KeyguardManager.java':'package android.app;public class KeyguardManager {public boolean isKeyguardLocked(){return ai.eliza.sense.ServicePorts.locked;}}',
  'android/os/UserManager.java':'package android.os;public class UserManager {public boolean isUserUnlocked(){return ai.eliza.sense.ServicePorts.unlocked;}public boolean isUserForeground(){return ai.eliza.sense.ServicePorts.userForeground;}}',
  'android/os/IBinder.java':'package android.os;public interface IBinder {}',
  'android/os/Looper.java':'package android.os;public class Looper {public static Looper getMainLooper(){return new Looper();}}',
  'android/os/SystemClock.java':'package android.os;public class SystemClock {public static long elapsedRealtime(){return ai.eliza.sense.ServicePorts.now;}}',
  'android/os/Handler.java':`package android.os;public class Handler {
   public Handler(Looper looper){}public boolean post(Runnable task){ai.eliza.sense.ServicePorts.queued.add(task);return true;}
   public boolean postDelayed(Runnable task,long delay){ai.eliza.sense.ServicePorts.timers.put(task,delay);return true;}
   public void removeCallbacks(Runnable task){ai.eliza.sense.ServicePorts.queued.removeIf(item->item==task);ai.eliza.sense.ServicePorts.timers.remove(task);}
  }`,
  'android/database/ContentObserver.java':'package android.database;public abstract class ContentObserver {public ContentObserver(android.os.Handler handler){}public void onChange(boolean value){}}',
  'android/provider/Settings.java':'package android.provider;public class Settings {public static class Global {public static final String BOOT_COUNT="boot";public static int getInt(Object resolver,String key,int fallback){return ai.eliza.sense.StorePorts.boot;}}public static class Secure {public static Object getUriFor(String key){return key;}}}',
  'android/service/quicksettings/TileService.java':'package android.service.quicksettings;public class TileService {public static void requestListeningState(android.content.Context context,android.content.ComponentName component){}}',
  'android/util/Log.java':'package android.util;public class Log {public static int w(String tag,String text){return 0;}public static int i(String tag,String text){return 0;}}',
  'android/media/AudioAttributes.java':'package android.media;public class AudioAttributes {public int getUsage(){return 1;}}',
  'android/media/AudioFormat.java':'package android.media;public class AudioFormat {public static final int CHANNEL_IN_MONO=16,ENCODING_PCM_16BIT=2;}',
  'android/media/MediaRecorder.java':'package android.media;public class MediaRecorder {public static class AudioSource {public static final int VOICE_RECOGNITION=6;}}',
  'android/media/AudioRecordingConfiguration.java':'package android.media;public class AudioRecordingConfiguration {public int getClientAudioSessionId(){return 0;}public boolean isClientSilenced(){return false;}}',
  'android/media/AudioPlaybackConfiguration.java':'package android.media;public class AudioPlaybackConfiguration {public AudioAttributes getAudioAttributes(){return new AudioAttributes();}}',
  'android/media/AudioManager.java':`package android.media;public class AudioManager {
   public static final int ERROR=-1;public boolean modeRegistered,recordingRegistered,playbackRegistered;
   public interface OnModeChangedListener {void onModeChanged(int value);}
   public static class AudioRecordingCallback {public void onRecordingConfigChanged(java.util.List<AudioRecordingConfiguration> configs){}}
   public static class AudioPlaybackCallback {public void onPlaybackConfigChanged(java.util.List<AudioPlaybackConfiguration> configs){}}
   public int getMode(){return 0;}public java.util.List<AudioRecordingConfiguration> getActiveRecordingConfigurations(){return java.util.List.of();}public java.util.List<AudioPlaybackConfiguration> getActivePlaybackConfigurations(){return java.util.List.of();}
   public void addOnModeChangedListener(java.util.concurrent.Executor executor,OnModeChangedListener listener){modeRegistered=true;}public void removeOnModeChangedListener(OnModeChangedListener listener){modeRegistered=false;}
   public void registerAudioRecordingCallback(AudioRecordingCallback callback,android.os.Handler handler){recordingRegistered=true;}public void unregisterAudioRecordingCallback(AudioRecordingCallback callback){recordingRegistered=false;}
   public void registerAudioPlaybackCallback(AudioPlaybackCallback callback,android.os.Handler handler){playbackRegistered=true;}public void unregisterAudioPlaybackCallback(AudioPlaybackCallback callback){playbackRegistered=false;}
  }`,
  'android/media/AudioRecord.java':`package android.media;public class AudioRecord {
   public static final int STATE_INITIALIZED=1,READ_BLOCKING=0;public boolean recording,released;public final java.util.concurrent.CountDownLatch began=new java.util.concurrent.CountDownLatch(1),unblock=new java.util.concurrent.CountDownLatch(1);
   public AudioRecord(int source,int rate,int channels,int encoding,int bytes){ai.eliza.sense.ServicePorts.record=this;ai.eliza.sense.ServicePorts.records.add(this);}public static int getMinBufferSize(int rate,int channels,int encoding){return 512;}
   public int getState(){return STATE_INITIALIZED;}public int getAudioSessionId(){return 1;}public void startRecording(){recording=true;began.countDown();}
   public int read(short[] buffer,int offset,int size,int mode){try{unblock.await();}catch(InterruptedException ignored){Thread.currentThread().interrupt();}return -1;}
   public void stop(){if(ai.eliza.sense.ServicePorts.stopFails)throw new IllegalStateException("stop failed");recording=false;unblock.countDown();}
   public void release(){if(ai.eliza.sense.ServicePorts.releaseFails)throw new IllegalStateException("release failed");released=true;recording=false;unblock.countDown();}
  }`,
  'ai/eliza/voice/NativeAsr.java':`package ai.eliza.voice;public class NativeAsr {
   public boolean closed;public int cancelled;public NativeAsr(){ai.eliza.sense.ServicePorts.engine=this;}
   public void cancel(){cancelled++;}public void close(){closed=true;}public String transcribe(float[] samples){return "alpha";}
  }`,
  'ai/eliza/voice/VoiceAssets.java':'package ai.eliza.voice;public class VoiceAssets {public static VoiceAssets install(android.content.Context context){if(ai.eliza.sense.ServicePorts.holdLoad){ai.eliza.sense.ServicePorts.loadEntered.countDown();try{ai.eliza.sense.ServicePorts.allowLoad.await();}catch(InterruptedException interrupted){Thread.currentThread().interrupt();throw new IllegalStateException(interrupted);}}return new VoiceAssets();}public NativeAsr openAsr(){return new NativeAsr();}}',
  'ai/eliza/sense/ListenerNotifications.java':`package ai.eliza.sense;final class ListenerNotifications {
   static final int ACTIVE_ID=1;static final String LOCK_SCREEN_SHOW_NOTIFICATIONS="lock";static void channels(android.content.Context context){}
   static boolean indicatorVisible(android.content.Context context){return ServicePorts.indicator;}static Object active(android.content.Context context,ListenerPolicy.State state){return new Object();}static void showStatus(android.content.Context context,ListenerPolicy.State state){ServicePorts.status=state.name();}
  }`,
  'ai/eliza/sense/AssistantInvocation.java':'package ai.eliza.sense;final class AssistantInvocation {static boolean start(android.content.Context context){ServicePorts.invocations++;return true;}}',
  'ai/eliza/sense/BuildConfig.java':'package ai.eliza.sense;public class BuildConfig {public static final String SENSE_STORAGE_NAME="listener-settings",SENSE_COMPONENT_PACKAGE="ai.alphacompute.alphaphone.sense",SENSE_HOST_PACKAGE="ai.alphacompute.alphaphone",APPLICATION_ID="ai.alphacompute.alphaphone.sense",SENSE_WAKE_NAMES="alpha";}',
 };
 for(const [name,text]of Object.entries(files)){const path=join(platform.directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);if(!platform.paths.includes(path))platform.paths.push(path);}
 // These owners, including the product-data component helper, are compiled
 // from the authenticated shared source instead of the store-only stand-ins.
 platform.paths=platform.paths.filter(path=>!path.endsWith('/ai/eliza/sense/Listener.java')&&!path.endsWith('/ai/eliza/sense/ListeningService.java')&&!path.endsWith('/ai/eliza/sense/SenseConfig.java'));
 return platform;
}
