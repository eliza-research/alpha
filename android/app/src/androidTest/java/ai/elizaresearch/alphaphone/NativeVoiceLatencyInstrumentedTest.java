package ai.elizaresearch.alphaphone;

import ai.eliza.voice.VoiceLatencyTrials;
import ai.eliza.voice.VoiceLatencyProbe;
import ai.eliza.voice.LocalSpeechEngine;
import ai.eliza.voice.LiveVoiceCapture;
import ai.eliza.voice.LiveVadGate;
import ai.eliza.voice.NativeAsr;
import ai.eliza.voice.ParadeeVoice;
import ai.eliza.voice.VoiceAssets;
import android.Manifest;
import android.app.Instrumentation;
import android.content.Context;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Issue #395 native latency harness: last captured speech sample to first audible response sample,
 * on the native monotonic clock, with the production collector (VoiceLatencyProbe).
 *
 * <p>Pipeline per turn: the production LiveVoiceCapture (AudioRecord VOICE_RECOGNITION, Silero
 * VAD through libelizainference, LiveVadGate) → Phonon-2 streaming ASR in this process, fed and
 * partially decoded during speech and finished at the endpoint (the shipped live route runs the same
 * decoder in the resident agent) → a fixed reply → Paradee-8M → MediaPlayer, timed exactly as
 * AlphaVoiceCloudPlugin.play. <b>No language model runs</b>: there is no hosted inference binding
 * here, so every trial is labelled {@code harness-no-inference} and scripts/native-voice-latency.mjs
 * never counts it as voice-assistant acceptance.
 *
 * <p>The audio comes from whatever drives the microphone: on an emulator, speech WAVs injected into
 * the virtual microphone (scripts/inject-emulator-audio.py --repeat), with a gap long enough for
 * one reply per turn. A segment that starts while a reply is still in progress is skipped and
 * counted. Every {@code coldEvery}-th turn closes both engines first: the ASR reopens at speech start
 * and the TTS at the reply, so the reply-side load lands inside the measured interval.
 *
 * <p>Opt-in: {@code -e nativeVoiceLatency 1 [-e trials 60] [-e coldEvery 6] [-e timeoutMs 1800000]}.
 * {@code -e feed 1 [-e gapSeconds 8]} replaces the microphone with a paced feed of the WAVs pushed to
 * {@code <files>/latency-feed/} (debug build: {@code adb exec-in run-as}; for emulators whose virtual microphone delivers silence); those
 * trials carry the {@code synthetic-feed} capture clock and measure from the fed last speech sample.
 * Every trial is recorded with pipeline {@code harness-no-inference}. Writes the
 * alpha-native-voice-timing-v3 export plus harness details (transcripts on an emulator only) to
 * {@code <external files>/native-voice-latency/}. Emulator results are not device latency.
 */
@RunWith(AndroidJUnit4.class)
public final class NativeVoiceLatencyInstrumentedTest {
 private static final String[] REPLIES={
  "It is sunny and about seventy degrees right now.",
  "Okay, I set a timer for five minutes.",
  "Your next meeting starts at three this afternoon."
 };
 private static final int PARTIAL_EVERY=8; // renderer batches (about 96 ms each) between partial decodes

 private Context app;
 private VoiceAssets.Bundle bundle;
 private Handler playback;
 // Worker-thread state.
 private NativeAsr asr;
 private ParadeeVoice voice;
 private NativeAsr.Stream stream;
 private int batches,turns;
 private boolean coldNext;
 private final AtomicBoolean busy=new AtomicBoolean();
 private final AtomicInteger skipped=new AtomicInteger(),finished=new AtomicInteger();
 private final AtomicReference<String> captureError=new AtomicReference<>();
 private final JSONArray turnsLog=new JSONArray();
 // Microphone diagnostics: capture batches seen and the loudest peak, to tell silence from VAD misses.
 private final AtomicInteger batchesSeen=new AtomicInteger();
 private final float[] maxPeak={0f};

 @Test public void measuresLastSpeechToAudibleResponse()throws Exception{
  Bundle args=InstrumentationRegistry.getArguments();
  org.junit.Assume.assumeTrue("Opt-in native latency harness with a driven microphone","1".equals(args.getString("nativeVoiceLatency")));
  int target=Integer.parseInt(args.getString("trials","60")),coldEvery=Integer.parseInt(args.getString("coldEvery","6"));
  long timeoutMs=Long.parseLong(args.getString("timeoutMs","1800000"));
  boolean feed="1".equals(args.getString("feed"));
  double gapSeconds=Double.parseDouble(args.getString("gapSeconds","8"));
  assertTrue(target>0&&coldEvery>1&&timeoutMs>0);
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
  app=instrumentation.getTargetContext();
  instrumentation.getUiAutomation().grantRuntimePermission(app.getPackageName(),Manifest.permission.RECORD_AUDIO);
  bundle=VoiceAssets.install(app);
  assertTrue("the live capture's VAD is usable",LiveVoiceCapture.vadAvailable(VoiceAssets.sharedInference(app)));
  VoiceLatencyProbe.TRIALS.clear();
  ExecutorService worker=Executors.newSingleThreadExecutor();
  HandlerThread playbackThread=new HandlerThread("latency-playback");playbackThread.start();playback=new Handler(playbackThread.getLooper());
  // Warm start: the first trial is still marked cold (first turn of the process).
  worker.submit(()->{try{asr=bundle.openAsr();assertTrue(asr.supportsStreaming());voice=bundle.openVoice();}catch(Exception error){throw new RuntimeException(error);}}).get(300,TimeUnit.SECONDS);
  LiveVoiceCapture.SourceFactory source=feed?feedSource(new File(app.getFilesDir(),"latency-feed"),gapSeconds):()->new LiveVoiceCapture.MicrophoneSource(app,false);
  LiveVoiceCapture capture=new LiveVoiceCapture(app,UUID.randomUUID().toString(),new LiveVoiceCapture.Sink(){
   public void frames(String captureId,org.json.JSONArray frames,org.json.JSONArray vad,float peak){
    batchesSeen.incrementAndGet();synchronized(maxPeak){if(peak>maxPeak[0])maxPeak[0]=peak;}
    boolean start=false,end=false;
    for(int i=0;i<vad.length();i++){String type=vad.optJSONObject(i).optString("type");if("speech-start".equals(type))start=true;else if("speech-end".equals(type))end=true;}
    if(start&&!busy.compareAndSet(false,true)){skipped.incrementAndGet();return;}
    if(!start&&!busy.get())return;
    float[][] pcm=new float[frames.length()][];
    for(int i=0;i<pcm.length;i++)pcm[i]=decode(frames.optJSONObject(i).optString("pcm16"));
    boolean opening=start,closing=end;
    worker.submit(()->turn(opening,pcm,closing,coldEvery));
   }
   public void ended(String captureId,String error){if(error!=null)captureError.set(error);}
  },"harness-no-inference",source,LiveVoiceCapture.detectors(VoiceAssets.sharedInference(app)));
  started=System.currentTimeMillis();
  File dir=new File(app.getExternalFilesDir(null),"native-voice-latency");assertTrue(dir.isDirectory()||dir.mkdirs());
  out=new File(dir,"native-voice-latency-"+UUID.randomUUID()+".json");
  this.target=target;this.coldEvery=coldEvery;this.feed=feed;
  capture.start();
  // The campaign driver starts injecting speech when it sees this status. The export is rewritten
  // after every turn, so a run cut short (an overloaded host can stall the emulator) keeps its trials.
  Bundle ready=new Bundle();ready.putString("nativeVoiceLatencyReady","1");ready.putString("nativeVoiceLatencyExportPath",out.getAbsolutePath());instrumentation.sendStatus(1,ready);
  try{
   while(finished.get()<target&&captureError.get()==null&&System.currentTimeMillis()-started<timeoutMs)Thread.sleep(500);
  }finally{
   capture.stop();
   worker.submit(this::closeEngines);worker.shutdown();worker.awaitTermination(60,TimeUnit.SECONDS);
   playbackThread.quitSafely();
  }
  JSONObject export=writeExport();
  Bundle status=new Bundle();status.putString("nativeVoiceLatencyExport",out.getAbsolutePath());status.putInt("nativeVoiceLatencyTrials",export.getJSONArray("records").length());
  instrumentation.sendStatus(0,status);
  assertNull("capture failed: "+captureError.get(),captureError.get());
  assertTrue("collected "+finished.get()+" of "+target+" trials",finished.get()>=target);
 }

 private File out;
 private long started;
 private int target,coldEvery;
 private boolean feed;
 private synchronized JSONObject writeExport()throws Exception{
  JSONObject export=VoiceLatencyProbe.export(app);
  JSONArray turns;synchronized(turnsLog){turns=new JSONArray(turnsLog.toString());}
  export.put("harness",new JSONObject()
   .put("pipeline","harness-no-inference").put("source",feed?"synthetic-feed":"microphone")
   .put("description","LiveVoiceCapture (AudioRecord + Silero VAD) -> Phonon-2 streaming ASR in the app process -> fixed reply (no language model) -> Paradee-8M -> MediaPlayer; not device latency when environment is emulator")
   .put("trialsRequested",target).put("coldEvery",coldEvery).put("complete",finished.get()>=target).put("skippedSegments",skipped.get()).put("captureBatches",batchesSeen.get()).put("maxPeak",(double)maxPeak[0]).put("captureError",captureError.get()==null?JSONObject.NULL:captureError.get())
   .put("elapsedMs",System.currentTimeMillis()-started).put("turns",turns));
  File partial=new File(out.getPath()+".partial");
  try(OutputStream stream=new FileOutputStream(partial)){stream.write(export.toString(2).getBytes(StandardCharsets.UTF_8));}
  assertTrue(partial.renameTo(out));
  return export;
 }

 /** Runs on the single worker: open, feed and decode during speech; finish, reply and play at the endpoint. */
 private void turn(boolean opening,float[][] pcm,boolean closing,int coldEvery){
  try{
   if(opening){
    if(asr==null){asr=bundle.openAsr();}
    if(stream!=null){stream.close();}
    stream=asr.openStream(LiveVoiceCapture.SAMPLE_RATE);batches=0;
   }
   if(stream==null){if(closing)busy.set(false);return;}
   for(float[] chunk:pcm)stream.feed(chunk);
   if(!closing){if(++batches%PARTIAL_EVERY==0)stream.partial();return;}
   VoiceLatencyTrials.Trial trial=VoiceLatencyProbe.TRIALS.pending();
   String text=stream.finish();stream.close();stream=null;
   VoiceLatencyProbe.TRIALS.mark(trial,"asr-final",System.nanoTime());
   if(trial==null){busy.set(false);return;}
   if(coldNext){VoiceLatencyProbe.TRIALS.engineLoaded(trial,"asr-reload");coldNext=false;}
   // Transcripts of injected synthetic speech help check the harness; real speech is never written.
   JSONObject log=new JSONObject().put("sequence",trial.sequence).put("transcribed",text!=null&&!text.trim().isEmpty());
   if(VoiceLatencyProbe.emulator())log.put("transcript",text==null?"":text.trim());
   if(text==null||text.trim().isEmpty()){VoiceLatencyProbe.TRIALS.failed(trial,"no-transcript");endTurn(log,trial,coldEvery);return;}
   String reply=REPLIES[turns%REPLIES.length];log.put("reply",reply);
   VoiceLatencyProbe.TRIALS.mark(trial,"tts-start",System.nanoTime());
   if(voice==null){VoiceLatencyProbe.TRIALS.engineLoaded(trial,"tts-load");voice=bundle.openVoice();}
   ParadeeVoice.Audio audio=voice.synthesize(reply,1f);
   VoiceLatencyProbe.TRIALS.mark(trial,"tts-ready",System.nanoTime());
   int lead=VoiceLatencyProbe.leadInFrames(audio.samples),total=audio.samples.length,rate=audio.sampleRate;
   File wav=File.createTempFile("alpha-latency-",".wav",app.getCacheDir());
   try{
    try(OutputStream out=new FileOutputStream(wav)){out.write(new LocalSpeechEngine.Audio(audio.samples,rate).wav());}
    play(trial,wav,lead,total,rate);
   }finally{wav.delete();}
   endTurn(log,trial,coldEvery);
  }catch(Exception|Error failure){
   VoiceLatencyTrials.Trial trial=VoiceLatencyProbe.TRIALS.pending();
   if(trial!=null&&closing){VoiceLatencyProbe.TRIALS.failed(trial,"harness-"+failure.getClass().getSimpleName());try{endTurn(new JSONObject().put("sequence",trial.sequence).put("error",failure.getClass().getSimpleName()),trial,coldEvery);}catch(Exception ignored){busy.set(false);}}
   else if(closing)busy.set(false);
  }
 }

 private void endTurn(JSONObject log,VoiceLatencyTrials.Trial trial,int coldEvery)throws Exception{
  // Wait for the collector to settle the trial (audible time or failure) before the next turn.
  String outcome=null;
  for(int i=0;i<600&&(outcome=VoiceLatencyProbe.TRIALS.outcome(trial))==null;i++)Thread.sleep(10);
  log.put("outcome",outcome==null?"pending":outcome);
  synchronized(turnsLog){turnsLog.put(log);}
  turns++;finished.incrementAndGet();
  try{writeExport();}catch(Exception|Error ignored){/* the final export reports the run */}
  if(turns%coldEvery==0){closeEngines();coldNext=true;}
  busy.set(false);
 }

 /** MediaPlayer exactly as AlphaVoiceCloudPlugin.play, with the same collector call; waits for completion. */
 private void play(VoiceLatencyTrials.Trial trial,File wav,int lead,int total,int rate)throws Exception{
  CountDownLatch done=new CountDownLatch(1);
  AtomicReference<MediaPlayer> current=new AtomicReference<>();
  playback.post(()->{
   MediaPlayer player=new MediaPlayer();current.set(player);
   try{
    player.setDataSource(wav.getAbsolutePath());
    player.setOnPreparedListener(p->{p.start();VoiceLatencyProbe.playbackStarted(trial,app,p,playback,lead,total,rate,()->current.get()==p);});
    player.setOnCompletionListener(p->{current.set(null);p.release();done.countDown();});
    player.setOnErrorListener((p,what,extra)->{current.set(null);p.release();done.countDown();return true;});
    player.prepareAsync();
   }catch(Exception error){current.set(null);player.release();done.countDown();}
  });
  if(!done.await(60,TimeUnit.SECONDS)){playback.post(()->{MediaPlayer player=current.getAndSet(null);if(player!=null)player.release();});throw new IllegalStateException("Playback did not complete");}
 }

 private void closeEngines(){
  if(stream!=null){stream.close();stream=null;}
  if(asr!=null){asr.close();asr=null;}
  if(voice!=null){voice.close();voice=null;}
 }

 /**
  * A paced feed of the speech WAVs in {@code dir} (16 kHz mono PCM16), in name order, each followed by
  * {@code gapSeconds} of silence, repeating. Samples become readable at the monotonic time they would
  * have been captured, and that time is their capture time ("synthetic-feed"): it replaces the
  * microphone and AudioRecord timestamps only, never the VAD, recognition, synthesis or playback.
  */
 private static LiveVoiceCapture.SourceFactory feedSource(File dir,double gapSeconds)throws Exception{
  File[] files=dir.listFiles((d,name)->name.endsWith(".wav"));
  assertNotNull("push the speech WAVs to "+dir,files);
  java.util.Arrays.sort(files);
  assertTrue("push the speech WAVs to "+dir,files.length>0);
  java.util.List<float[]> clips=new java.util.ArrayList<>();
  for(File file:files)try(java.io.InputStream in=new java.io.FileInputStream(file)){clips.add(LocalSpeechEngine.readMono16kWav(in));}
  int gap=(int)Math.round(gapSeconds*LiveVoiceCapture.SAMPLE_RATE);
  int cycle=0;for(float[] clip:clips)cycle+=clip.length+gap;
  short[] schedule=new short[cycle];int at=0;
  for(float[] clip:clips){for(float sample:clip)schedule[at++]=(short)Math.round(Math.max(-1,Math.min(1,sample))*32767);at+=gap;}
  return ()->new LiveVoiceCapture.Source(){
   final long start=System.nanoTime();long position;volatile boolean closed;
   public int read(short[] buffer,int offset,int length){
    long due=captureTimeNs(position+length-1);
    while(!closed&&System.nanoTime()<due){long wait=due-System.nanoTime();try{Thread.sleep(wait/1_000_000,(int)(wait%1_000_000));}catch(InterruptedException interrupted){Thread.currentThread().interrupt();return -1;}}
    if(closed)return -1;
    for(int i=0;i<length;i++)buffer[offset+i]=schedule[(int)((position+i)%schedule.length)];
    position+=length;return length;
   }
   public long captureTimeNs(long frame){return VoiceLatencyTrials.frameTimeNs(start,0,frame,LiveVoiceCapture.SAMPLE_RATE);}
   public String clock(){return "synthetic-feed";}
   public void requestStop(){closed=true;}
   public void close(){closed=true;}
  };
 }

 private static float[] decode(String base64){
  byte[] bytes=Base64.decode(base64,Base64.NO_WRAP);float[] out=new float[bytes.length/2];
  for(int i=0;i<out.length;i++)out[i]=(short)((bytes[i*2]&0xff)|(bytes[i*2+1]<<8))/32768f;
  return out;
 }
}
