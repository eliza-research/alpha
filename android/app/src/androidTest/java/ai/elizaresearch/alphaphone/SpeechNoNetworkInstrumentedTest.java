package ai.elizaresearch.alphaphone;

import ai.eliza.voice.SessionSpeech;
import ai.eliza.voice.LocalSpeechEngine;
import static org.junit.Assert.*;

import ai.eliza.voice.VoiceAssets;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.TrafficStats;
import android.os.Process;
import android.os.StrictMode;
import android.os.SystemClock;
import android.os.strictmode.Violation;
import android.system.Os;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.Writer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Local speech performs no network egress (#413). The product's on-device path, LocalSpeechEngine
 * over SessionSpeech (the engine AlphaVoiceCloudPlugin's submitLocal methods hold), installs the
 * packaged voice bundle, opens libelizainference ASR and Paradee TTS, transcribes the human fixture and
 * synthesizes speech while networking is AVAILABLE, so an egress attempt would be observable.
 *
 * Three independent observers cover the measured window:
 *  - TrafficStats per-UID counters (kernel eBPF accounting; covers Java and native sockets alike):
 *    the app UID must send and receive zero bytes.
 *  - A socket file-descriptor census of /proc/self/fd, sampled during the window: no socket may be
 *    opened by the process (native code included).
 *  - StrictMode: thread network detection on the speech worker and VM cleartext/untagged-socket
 *    detection, collected through penalty listeners.
 * An idle window of the same length is measured first; if the process is not quiet without speech the
 * result cannot be attributed and the test is skipped as inconclusive, never passed.
 *
 * Skips (assumption failure, never a vacuous pass) without the explicit localSpeech=1 opt-in, without
 * the qualified packaged voice bundle (assets/paradee-voice/v1 with the ASR slot) and native engine,
 * or without an active validated network. Emulator/device evidence class only: it proves neither
 * physical microphone capture, speaker output, nor the AOSP listener.
 */
@RunWith(AndroidJUnit4.class)
public final class SpeechNoNetworkInstrumentedTest {
 private static final long SAMPLE_MS = 5;

 /** Socket inodes the process holds now ("socket:[inode]" fd links). */
 private static Set<String> sockets(){
  Set<String> out=new HashSet<>();String[] fds=new File("/proc/self/fd").list();if(fds==null)return out;
  for(String fd:fds){try{String link=Os.readlink("/proc/self/fd/"+fd);if(link.startsWith("socket:"))out.add(link);}catch(Exception closed){/* fd closed between list and readlink */}}
  return out;
 }
 /** One measured window: UID byte deltas, sockets opened during it, StrictMode violations. */
 private static final class Window {
  final int uid=Process.myUid();long tx0,rx0,tx,rx;final Set<String> before=sockets(),opened=Collections.synchronizedSet(new HashSet<>());
  final List<String> violations=Collections.synchronizedList(new ArrayList<>());final AtomicBoolean sampling=new AtomicBoolean(true);Thread sampler;
  Window start(){
   tx0=TrafficStats.getUidTxBytes(uid);rx0=TrafficStats.getUidRxBytes(uid);
   sampler=new Thread(()->{while(sampling.get()){for(String s:sockets())if(!before.contains(s))opened.add(s);SystemClock.sleep(SAMPLE_MS);}},"speech-egress-socket-census");sampler.start();
   return this;
  }
  void stop()throws InterruptedException{
   // Let kernel accounting settle before the final read; the census keeps sampling meanwhile.
   SystemClock.sleep(2000);sampling.set(false);sampler.join(5000);for(String s:sockets())if(!before.contains(s))opened.add(s);
   tx=TrafficStats.getUidTxBytes(uid)-tx0;rx=TrafficStats.getUidRxBytes(uid)-rx0;
  }
  boolean quiet(){return tx==0&&rx==0&&opened.isEmpty()&&violations.isEmpty();}
  JSONObject json()throws Exception{synchronized(opened){synchronized(violations){return new JSONObject().put("txBytes",tx).put("rxBytes",rx).put("socketsOpened",new JSONArray(opened)).put("strictModeViolations",new JSONArray(violations));}}}
 }

 @Test public void localSpeechTranscribesAndSynthesizesWithNoEgressWhileNetworkIsAvailable()throws Exception{
  Assume.assumeTrue("Opt-in real local models required (localSpeech=1)","1".equals(InstrumentationRegistry.getArguments().getString("localSpeech")));
  Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();
  // Qualified speech assets: the packaged bundle manifest and its ASR slot. Absent assets skip.
  try(InputStream manifest=app.getAssets().open(VoiceAssets.ASSET_ROOT+"/manifest.json")){assertTrue(manifest.read()>=0);}
  catch(IOException absent){Assume.assumeNoException("Qualified local speech assets ("+VoiceAssets.ASSET_ROOT+") are not packaged in this APK; no egress claim is made",absent);}
  VoiceAssets.Bundle bundle=null;
  try{bundle=VoiceAssets.install(app);}catch(IOException unverified){Assume.assumeNoException("The packaged voice bundle does not verify; no egress claim is made",unverified);}
  Assume.assumeTrue("The packaged voice bundle has no ASR slot; recognition egress cannot be checked",new File(bundle.root,"asr").isDirectory());
  float[] human;try(InputStream in=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("speech-fixture/0.wav")){human=LocalSpeechEngine.readMono16kWav(in);}
  // An available network is what makes zero egress meaningful: with none, a connect() fails before
  // any byte is counted. The other speech classes run with networking off; this one must not.
  ConnectivityManager connectivity=app.getSystemService(ConnectivityManager.class);Network network=connectivity.getActiveNetwork();
  NetworkCapabilities caps=network==null?null:connectivity.getNetworkCapabilities(network);
  Assume.assumeTrue("An active validated network is required so that an egress attempt would be observable",caps!=null&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)&&caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
  assertNotEquals("Per-UID traffic accounting must be supported",TrafficStats.UNSUPPORTED,TrafficStats.getUidTxBytes(Process.myUid()));

  JSONObject evidence=new JSONObject().put("pass",false).put("execution","android-process-cpu").put("networkAvailable",true)
   .put("physicalMicrophoneVerified",false).put("physicalSpeakerVerified",false);
  File folder=new File(app.getExternalFilesDir(null),"speech-no-network-evidence");assertTrue(folder.isDirectory()||folder.mkdirs());
  ExecutorService worker=Executors.newSingleThreadExecutor(r->new Thread(r,"speech-no-network-worker"));
  ExecutorService listeners=Executors.newSingleThreadExecutor();
  StrictMode.VmPolicy previousVm=StrictMode.getVmPolicy();
  try{
   // Idle baseline of comparable length: the process must be quiet without speech.
   Window idle=new Window().start();SystemClock.sleep(3000);idle.stop();evidence.put("idle",idle.json());
   Assume.assumeTrue("The app process is not network-quiet without speech; egress cannot be attributed: "+idle.json(),idle.quiet());

   Window speech=new Window();
   StrictMode.setVmPolicy(new StrictMode.VmPolicy.Builder().detectCleartextNetwork().detectUntaggedSockets()
    .penaltyListener(listeners,(Violation v)->speech.violations.add("vm:"+v.getClass().getSimpleName())).build());
   speech.start();long started=SystemClock.elapsedRealtime();
   JSONObject result=worker.submit(()->{
    StrictMode.ThreadPolicy previousThread=StrictMode.getThreadPolicy();
    StrictMode.setThreadPolicy(new StrictMode.ThreadPolicy.Builder().detectNetwork()
     .penaltyListener(listeners,(Violation v)->speech.violations.add("thread:"+v.getClass().getSimpleName())).build());
    JSONObject out=new JSONObject();
    try{
     LocalSpeechEngine holder=new LocalSpeechEngine(()->new SessionSpeech(VoiceAssets.install(app).openInference(),true));
     try{
      // A developer APK without the native engine (or one built without ASR/Paradee) cannot load it:
      // that is "not packaged", a skip. A model load failure on a packaged engine is a real failure.
      try{holder.use(engine->null);}
      catch(LinkageError unavailable){out.put("engineUnavailable",String.valueOf(unavailable));return out;}
      catch(IllegalStateException unavailable){if(!String.valueOf(unavailable.getMessage()).contains("built without"))throw unavailable;out.put("engineUnavailable",String.valueOf(unavailable));return out;}
      String transcript=holder.use(engine->engine.transcribe(human));
      out.put("transcript",transcript);
      LocalSpeechEngine.Audio audio=holder.use(engine->engine.synthesize("Your calendar is ready. The quick brown fox jumps over the lazy dog.",()->false));
      out.put("ttsSamples",audio.samples.length).put("ttsRate",audio.sampleRate);
      // Release and reopen: a fresh model load is also part of the local path.
      holder.release();out.put("reopenedTranscript",holder.use(engine->engine.transcribe(human)));
     }finally{holder.close();}
    }finally{StrictMode.setThreadPolicy(previousThread);}
    return out;
   }).get(300,TimeUnit.SECONDS);
   evidence.put("speechMs",SystemClock.elapsedRealtime()-started);
   speech.stop();StrictMode.setVmPolicy(previousVm);
   evidence.put("speech",speech.json()).put("result",result);
   Assume.assumeFalse("The native speech engine is not packaged in this APK; no egress claim is made: "+result.optString("engineUnavailable"),result.has("engineUnavailable"));
   // The work really ran: the known human fixture is recognized and speech was synthesized.
   String lower=result.getString("transcript").toLowerCase(Locale.ROOT);
   for(String word:new String[]{"nightfall","yellow","lamps"})assertTrue("Human recording transcript contains "+word,lower.contains(word));
   assertEquals("Reopened engine recognizes the same speech",result.getString("transcript"),result.getString("reopenedTranscript"));
   assertTrue("Speech was synthesized",result.getInt("ttsSamples")>0);
   assertEquals("Local speech sent no bytes from the app UID: "+speech.json(),0,speech.tx);
   assertEquals("Local speech received no bytes on the app UID: "+speech.json(),0,speech.rx);
   assertTrue("Local speech opened no socket: "+speech.json(),speech.opened.isEmpty());
   assertTrue("Local speech raised no StrictMode network violation: "+speech.json(),speech.violations.isEmpty());
   assertNotNull("The network stayed available for the whole window",connectivity.getActiveNetwork());
   evidence.put("pass",true);
  }finally{
   StrictMode.setVmPolicy(previousVm);worker.shutdownNow();listeners.shutdownNow();java.util.Arrays.fill(human,0);
   try(Writer out=new FileWriter(new File(folder,"result.json"))){out.write(evidence.toString(2));}
  }
 }
}
