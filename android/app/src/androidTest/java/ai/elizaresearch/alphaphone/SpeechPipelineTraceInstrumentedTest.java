package ai.elizaresearch.alphaphone;

import ai.eliza.voice.VoiceAssets;
import ai.eliza.voice.SessionSpeech;
import ai.eliza.voice.LocalSpeechEngine;
import ai.eliza.voice.*;
import android.content.Context;
import android.net.ConnectivityManager;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Diagnostic acquisition only: do not substitute this for unchanged voice acceptance. */
public final class SpeechPipelineTraceInstrumentedTest {
 private static final String[] CORPUS={
  "The quick brown fox jumps over the lazy dog.",
  "The lady put the blue coat beside the door.",
  "Busy bees buzz around the roses.",
  "Daisy found an easy way to close the box.",
  "Please move my meeting from Tuesday to Thursday.",
  "Save a note about the blue train and the green boat.",
  "Set a reminder for seven thirty tomorrow morning.",
  "My calendar has four events and two reminders."
 };
 private static String[] words(String text){return text.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9' ]"," ").trim().split("\\s+");}
 private static int edits(String expected,String observed){String[] a=words(expected),b=words(observed);int[][] d=new int[a.length+1][b.length+1];for(int i=0;i<=a.length;i++)d[i][0]=i;for(int j=0;j<=b.length;j++)d[0][j]=j;for(int i=1;i<=a.length;i++)for(int j=1;j<=b.length;j++)d[i][j]=Math.min(Math.min(d[i-1][j]+1,d[i][j-1]+1),d[i-1][j-1]+(a[i-1].equals(b[j-1])?0:1));return d[a.length][b.length];}
 private static String sha(byte[] bytes)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 private static void save(File dir,JSONObject report)throws Exception{try(Writer out=new OutputStreamWriter(new FileOutputStream(new File(dir,"comparison.json")),StandardCharsets.UTF_8)){out.write(report.toString(2));}}
 private static float[] resample(LocalSpeechEngine.Audio audio){float[] out=new float[(int)((long)audio.samples.length*16000/audio.sampleRate)];for(int i=0;i<out.length;i++){double pos=(double)i*audio.sampleRate/16000;int left=Math.min((int)pos,audio.samples.length-1),right=Math.min(left+1,audio.samples.length-1);out[i]=(float)(audio.samples[left]+(audio.samples[right]-audio.samples[left])*(pos-left));}return out;}
 @Test public void tracePackagedSynthesisPipeline()throws Exception{
  org.junit.Assume.assumeTrue("Explicit offline diagnostic", "1".equals(InstrumentationRegistry.getArguments().getString("speechPipelineTrace")));
  String mode=InstrumentationRegistry.getArguments().getString("speechPipelineMode","engine-warm");
  assertTrue(Arrays.asList("engine-cold","engine-warm","direct-first","direct-second").contains(mode));
  Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();assertNull("Networking must be disabled",app.getSystemService(ConnectivityManager.class).getActiveNetwork());
  File dir=new File(app.getExternalFilesDir(null),"speech-pipeline-trace-"+mode+"-"+UUID.randomUUID());assertTrue(dir.mkdirs());
  JSONObject report=new JSONObject().put("diagnosticOnly",true).put("qualityAccepted",false).put("complete",false).put("mode",mode).put("runDirectory",dir.getName());
  JSONArray rows=new JSONArray();report.put("samples",rows);long allStart=SystemClock.elapsedRealtime();
  SessionSpeech engine=null;ParadeeVoice direct=null;
  try{
   VoiceAssets.Bundle models=VoiceAssets.install(app);report.put("provider","fused-paradee-asr").put("bundleManifestSha256",sha(java.nio.file.Files.readAllBytes(new File(models.root,"installed-manifest.json").toPath())));
   // direct-first constructs no recognizer or hidden TTS before the direct speaker.
   if(!mode.equals("direct-first"))engine=new SessionSpeech(VoiceAssets.install(app).openInference(),true);
   if(mode.equals("engine-warm")){
    float[] human;try(InputStream in=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("speech-fixture/0.wav")){human=LocalSpeechEngine.readMono16kWav(in);}
    report.put("humanTranscript",engine.transcribe(human));assertEquals("",engine.transcribe(new float[16000]));
   }
   if(mode.startsWith("direct-")){
    direct=models.openVoice();report.put("g2pKind",direct.g2pKind());
   }
   // Acquire every waveform before creating a recognizer in direct-first mode.
   ArrayList<LocalSpeechEngine.Audio> audioRows=new ArrayList<>();
   for(int round=0;round<3;round++)for(int index=0;index<CORPUS.length;index++){
    String input=CORPUS[index],prepared=input;long start=SystemClock.elapsedRealtime();LocalSpeechEngine.Audio audio;
    if(direct==null)audio=engine.synthesize(input);else{ParadeeVoice.Audio generated=direct.synthesize(prepared,1.0f);audio=new LocalSpeechEngine.Audio(generated.samples,generated.sampleRate);}
    long ttsMs=SystemClock.elapsedRealtime()-start;assertTrue(audio.sampleRate>=8000&&audio.sampleRate<=48000);assertTrue(audio.samples.length>audio.sampleRate/10&&audio.samples.length<30*audio.sampleRate);
    byte[] wav=audio.wav();String name="r"+round+"-sentence"+index+".wav";try(OutputStream stream=new FileOutputStream(new File(dir,name))){stream.write(wav);}
    audioRows.add(audio);rows.put(new JSONObject().put("round",round).put("sentence",index).put("input",input).put("prepared",prepared).put("ttsMs",ttsMs).put("samples",audio.samples.length).put("sampleRate",audio.sampleRate).put("waveform",name).put("wavSha256",sha(wav)));save(dir,report);
   }
   if(engine==null)engine=new SessionSpeech(VoiceAssets.install(app).openInference(),true);
   for(int i=0;i<audioRows.size();i++){long start=SystemClock.elapsedRealtime();String transcript=engine.transcribe(resample(audioRows.get(i)));rows.getJSONObject(i).put("transcript",transcript).put("asrMs",SystemClock.elapsedRealtime()-start).put("wordEdits",edits(rows.getJSONObject(i).getString("input"),transcript));save(dir,report);}
   assertEquals(24,rows.length());assertNull(app.getSystemService(ConnectivityManager.class).getActiveNetwork());report.put("complete",true);
  }finally{if(direct!=null)direct.close();if(engine!=null)engine.close();report.put("elapsedMs",SystemClock.elapsedRealtime()-allStart);save(dir,report);android.util.Log.i("SpeechPipelineTrace",dir.getAbsolutePath());}
 }
}
