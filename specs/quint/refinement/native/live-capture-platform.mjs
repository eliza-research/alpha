import {readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {sharedRecordingPlatform} from './shared-recording-platform.mjs';

/** Android audio/inference primitives. Shared bridge, controller and capture classes execute. */
export function liveCapturePlatform(){
 const base=sharedRecordingPlatform();
 for(const name of ['ai/eliza/voice/LiveCaptureController.java','ai/eliza/voice/LiveVoiceCapture.java'])unlinkSync(join(base.directory,name));
 const paths=base.paths.filter(path=>!path.endsWith('/LiveCaptureController.java')&&!path.endsWith('/LiveVoiceCapture.java'));
 const files={
  'android/content/pm/PackageManager.java':'package android.content.pm;public class PackageManager {public static final int PERMISSION_GRANTED=0;}',
  'android/media/AudioFormat.java':'package android.media;public class AudioFormat {public static final int CHANNEL_IN_MONO=16,ENCODING_PCM_16BIT=2;}',
  'android/media/AudioTimestamp.java':'package android.media;public class AudioTimestamp {public long framePosition,nanoTime;}',
  'android/media/AudioRecord.java':`package android.media;
import ai.alphacompute.alphaphone.LiveCapturePorts;
public class AudioRecord {
 public static final int STATE_INITIALIZED=1;
 public volatile boolean recording,released;
 public AudioRecord(int source,int rate,int channels,int format,int bytes){
  synchronized(LiveCapturePorts.records){LiveCapturePorts.records.add(this);}
  LiveCapturePorts.opening.countDown();
  if(LiveCapturePorts.holdOpen)try{LiveCapturePorts.allowOpen.await();}catch(InterruptedException stopped){Thread.currentThread().interrupt();throw new IllegalStateException(stopped);}
 }
 public static int getMinBufferSize(int rate,int channels,int format){return 1024;}
 public int getState(){return STATE_INITIALIZED;}
 public int getAudioSessionId(){return 1;}
 public synchronized void startRecording(){if(LiveCapturePorts.failStart){LiveCapturePorts.failStart=false;throw new IllegalStateException("start fixture");}recording=true;if(ai.alphacompute.alphaphone.NoteBridgePorts.audio.mode!=AudioManager.MODE_NORMAL)LiveCapturePorts.startsDuringCall++;}
 public synchronized int read(short[] buffer,int offset,int length){while(recording)try{wait();}catch(InterruptedException stopped){Thread.currentThread().interrupt();return -1;}return 0;}
 public synchronized void stop(){recording=false;notifyAll();}
 public synchronized void release(){if(LiveCapturePorts.failRelease){LiveCapturePorts.failRelease=false;throw new IllegalStateException("release fixture");}released=true;recording=false;notifyAll();}
}`,
  'android/media/audiofx/AudioEffect.java':'package android.media.audiofx;public class AudioEffect {public static final int SUCCESS=0;}',
  'android/media/audiofx/AcousticEchoCanceler.java':`package android.media.audiofx;
public class AcousticEchoCanceler {public static boolean isAvailable(){return false;}public static AcousticEchoCanceler create(int id){return null;}public int setEnabled(boolean value){return 0;}public boolean getEnabled(){return true;}public void release(){}}`,
  'android/media/audiofx/NoiseSuppressor.java':'package android.media.audiofx;public class NoiseSuppressor {public static boolean isAvailable(){return false;}public static NoiseSuppressor create(int id){return null;}public int setEnabled(boolean value){return 0;}public void release(){}}',
  'android/util/Base64.java':'package android.util;public class Base64 {public static final int NO_WRAP=2;public static String encodeToString(byte[] bytes,int flags){return java.util.Base64.getEncoder().encodeToString(bytes);}}',
  'ai/eliza/voice/InferenceSession.java':`package ai.eliza.voice;
public class InferenceSession {public static class Vad {public float[] process(float[] window){return new float[]{0};}public void reset(){}public void close(){}}public Vad openVad(){return new Vad();}}`,
  'ai/eliza/voice/VoiceAssets.java':'package ai.eliza.voice;public class VoiceAssets {public static InferenceSession sharedInference(android.content.Context context){return new InferenceSession();}}',
 };
 const bodies=sourceBodies(base.directory);
 files['android/content/Context.java']=bodies.context.replace('public class Context {','public class Context {\n public int checkSelfPermission(String permission){return ai.alphacompute.alphaphone.NoteBridgePorts.permission==com.getcapacitor.PermissionState.GRANTED?0:-1;}');
 files['android/media/MediaRecorder.java']=bodies.recorder.replace('public static final int MIC=1;','public static final int MIC=1,VOICE_RECOGNITION=6,VOICE_COMMUNICATION=7;');
 files['ai/eliza/voice/VoiceLatencyProbe.java']=bodies.latency.replace('public static final float AUDIBLE_LEVEL=0.01f;','public static final float AUDIBLE_LEVEL=0.01f;\n public static void prepareIdentity(android.content.Context context){}\n public static long captureTimeNs(android.media.AudioRecord record,android.media.AudioTimestamp stamp,long frame,int rate){return VoiceLatencyTrials.UNSET;}');
 for(const [name,body] of Object.entries(files)){const path=join(base.directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);if(!paths.includes(path))paths.push(path);}
 return {directory:base.directory,paths,close:base.close};
}
function sourceBodies(directory){return {context:readFileSync(join(directory,'android/content/Context.java'),'utf8'),recorder:readFileSync(join(directory,'android/media/MediaRecorder.java'),'utf8'),latency:readFileSync(join(directory,'ai/eliza/voice/VoiceLatencyProbe.java'),'utf8')};}
