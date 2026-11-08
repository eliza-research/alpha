import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {listenerServicePlatform} from './listener-service-platform.mjs';

/** More detailed external audio and ASR ports for the actual listener input loop. */
export function listenerInputPlatform(){
 const platform=listenerServicePlatform();
 const update=(name,edit)=>{
  const path=join(platform.directory,name),before=readFileSync(path,'utf8'),after=edit(before);
  if(before===after)throw Error(`Missing listener fixture seam ${name}`);
  writeFileSync(path,after);
 };
 update('android/media/AudioRecord.java',source=>source
  .replace('public boolean recording,released;','public volatile boolean recording,released;\n'+
   'public final java.util.concurrent.BlockingQueue<short[]> input=new java.util.concurrent.LinkedBlockingQueue<>();\n'+
   'public final java.util.concurrent.atomic.AtomicInteger entered=new java.util.concurrent.atomic.AtomicInteger();\n'+
   'public final java.util.concurrent.atomic.AtomicInteger chunks=new java.util.concurrent.atomic.AtomicInteger(),samples=new java.util.concurrent.atomic.AtomicInteger();\n'+
   'public final java.util.concurrent.CountDownLatch allowRead=new java.util.concurrent.CountDownLatch(1);\n'+
   'public volatile long readTicket=-1;public volatile short[] lastFrame;')
  .replace('public void startRecording(){recording=true;began.countDown();}',`
   public void startRecording(){recording=true;began.countDown();try{allowRead.await();}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}}`)
  .replace('public int read(short[] buffer,int offset,int size,int mode){try{unblock.await();}catch(InterruptedException ignored){Thread.currentThread().interrupt();}return -1;}',`
   public int read(short[] buffer,int offset,int size,int mode){
    lastFrame=buffer;readTicket=ai.eliza.sense.ListenerInputPorts.ticket();entered.incrementAndGet();
    try{while(recording){short[] part=input.poll(20,java.util.concurrent.TimeUnit.MILLISECONDS);if(part!=null){
     if(part.length>size)throw new AssertionError("Fixture sent oversized input");System.arraycopy(part,0,buffer,offset,part.length);chunks.incrementAndGet();samples.addAndGet(part.length);return part.length;
    }}}catch(InterruptedException interrupted){Thread.currentThread().interrupt();}return -1;
   }`));
 update('android/media/AudioAttributes.java',()=>`package android.media;public class AudioAttributes {
  private final int usage;public AudioAttributes(int usage){this.usage=usage;}public int getUsage(){return usage;}
 }`);
 update('android/media/AudioPlaybackConfiguration.java',()=>`package android.media;public class AudioPlaybackConfiguration {
  private final AudioAttributes attributes;public AudioPlaybackConfiguration(AudioAttributes attributes){this.attributes=attributes;}
  public AudioAttributes getAudioAttributes(){return attributes;}
 }`);
 update('android/media/AudioRecordingConfiguration.java',()=>`package android.media;public class AudioRecordingConfiguration {
  private final int session;private final boolean silenced;
  public AudioRecordingConfiguration(int session,boolean silenced){this.session=session;this.silenced=silenced;}
  public int getClientAudioSessionId(){return session;}public boolean isClientSilenced(){return silenced;}
 }`);
 update('android/media/AudioManager.java',source=>source
  .replace('public static final int ERROR=-1;',`public static final int ERROR=-1;
   public OnModeChangedListener modeListener;public AudioRecordingCallback recordingListener;public AudioPlaybackCallback playbackListener;
   public int mode;
   public void mode(int next){mode=next;modeListener.onModeChanged(next);}
   public void recordings(java.util.List<AudioRecordingConfiguration> configs){recordingListener.onRecordingConfigChanged(configs);}
   public void playback(java.util.List<AudioPlaybackConfiguration> configs){playbackListener.onPlaybackConfigChanged(configs);}`)
  .replace('public int getMode(){return 0;}','public int getMode(){return mode;}')
  .replace('modeRegistered=true;','modeRegistered=true;modeListener=listener;')
  .replace('modeRegistered=false;','modeRegistered=false;modeListener=null;')
  .replace('recordingRegistered=true;','recordingRegistered=true;recordingListener=callback;')
  .replace('recordingRegistered=false;','recordingRegistered=false;recordingListener=null;')
  .replace('playbackRegistered=true;','playbackRegistered=true;playbackListener=callback;')
  .replace('playbackRegistered=false;','playbackRegistered=false;playbackListener=null;'));
 update('ai/eliza/voice/NativeAsr.java',source=>source.replace('return "alpha";','return ai.eliza.sense.ListenerInputPorts.transcribe(samples);'));
 return platform;
}
