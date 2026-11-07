package ai.elizaresearch.alphaphone;

import ai.eliza.voice.SessionSpeech;
import ai.eliza.voice.LocalSpeechEngine;
import ai.eliza.voice.VoiceAssets;
import android.content.Context;
import android.net.ConnectivityManager;
import android.os.Build;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Locale;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * release-05 root-cause evidence for the canonical LocalSpeechInstrumentedTest round trip,
 * which stays unchanged. Synthesizes the same sentence and compares the in-process float buffer
 * given to ASR with the saved 16-bit PCM: peak, clipping, exact zeros, the 32767/32768 gain,
 * quantization error, and the transcript of each variant through the same linear resampler.
 * Both float buffers are retained as float32 little-endian files. Opt-in with -e localSpeech 1,
 * networking disabled; this test asserts only that the evidence was produced, never a keyword.
 */
@RunWith(AndroidJUnit4.class)
public final class VoiceFloatPathDiagnosticInstrumentedTest {
 static final String SENTENCE="The quick brown fox jumps over the lazy dog.";
 /** The canonical in-process resampler, copied exactly: linear interpolation to 16 kHz. */
 static float[] linear16k(float[] samples,int rate){
  float[] resampled=new float[(int)((long)samples.length*16000/rate)];
  for(int i=0;i<resampled.length;i++){double position=(double)i*rate/16000;int left=Math.min((int)position,samples.length-1),right=Math.min(left+1,samples.length-1);resampled[i]=(float)(samples[left]+(samples[right]-samples[left])*(position-left));}
  return resampled;
 }
 /** The saved WAV's samples as LocalSpeechEngine.readMono16kWav decodes PCM16 (int16 / 32768). */
 static float[] wavSamples(byte[] wav){
  ByteBuffer b=ByteBuffer.wrap(wav,44,wav.length-44).order(ByteOrder.LITTLE_ENDIAN);float[] out=new float[(wav.length-44)/2];
  for(int i=0;i<out.length;i++)out[i]=b.getShort()/32768f;return out;
 }
 static void writeFloats(File file,float[] samples)throws IOException{
  ByteBuffer b=ByteBuffer.allocate(samples.length*4).order(ByteOrder.LITTLE_ENDIAN);for(float x:samples)b.putFloat(x);
  try(OutputStream out=new FileOutputStream(file)){out.write(b.array());}
 }
 static boolean recognized(String transcript){String lower=transcript.toLowerCase(Locale.ROOT);for(String word:new String[]{"quick","brown","fox","lazy","dog"})if(!lower.contains(word))return false;return true;}
 @Test public void floatAndSavedPcmPathsAreComparedAndRetained()throws Exception {
  org.junit.Assume.assumeTrue("Opt-in real local models required","1".equals(InstrumentationRegistry.getArguments().getString("localSpeech")));
  Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertNull("Disable device networking before on-device diagnostics",app.getSystemService(ConnectivityManager.class).getActiveNetwork());
  File folder=new File(app.getExternalFilesDir(null),"local-speech-evidence");assertTrue(folder.isDirectory()||folder.mkdirs());
  JSONObject evidence=new JSONObject().put("complete",false).put("abi",Build.SUPPORTED_ABIS[0]).put("input",SENTENCE);
  try(SessionSpeech engine=new SessionSpeech(VoiceAssets.install(app).openInference(),true)){
   LocalSpeechEngine.Audio audio=engine.synthesize(SENTENCE);byte[] wav=audio.wav();float[] pcm=wavSamples(wav);
   double peak=0,maxError=0,errorEnergy=0,signalEnergy=0;int clipped=0,exactZeros=0;
   for(int i=0;i<audio.samples.length;i++){float x=audio.samples[i];peak=Math.max(peak,Math.abs(x));if(Math.abs(x)>=1f)clipped++;if(x==0f)exactZeros++;double e=x-pcm[i];maxError=Math.max(maxError,Math.abs(e));errorEnergy+=e*e;signalEnergy+=(double)x*x;}
   float[] floatInput=linear16k(audio.samples,audio.sampleRate),pcmInput=linear16k(pcm,audio.sampleRate);
   float[] unityGain=new float[pcmInput.length];for(int i=0;i<unityGain.length;i++)unityGain[i]=Math.max(-1f,Math.min(1f,pcmInput[i]*32768f/32767f));
   double resampledPeak=0;for(float x:floatInput)resampledPeak=Math.max(resampledPeak,Math.abs(x));
   // Same order as the canonical test's first synthesis transcription, then the PCM variants.
   String floatTranscript=engine.transcribe(floatInput),pcmTranscript=engine.transcribe(pcmInput),unityTranscript=engine.transcribe(unityGain),floatAgain=engine.transcribe(floatInput);
   evidence.put("sampleRate",audio.sampleRate).put("samples",audio.samples.length).put("floatPeak",peak).put("resampledPeak",resampledPeak).put("clippedSamples",clipped).put("exactZeroSamples",exactZeros)
    .put("pcmGain",32767.0/32768.0).put("quantizationMaxError",maxError).put("quantizationSnrDb",errorEnergy>0?10*Math.log10(signalEnergy/errorEnergy):JSONObject.NULL)
    .put("floatTranscript",floatTranscript).put("floatRecognized",recognized(floatTranscript)).put("floatRepeatTranscript",floatAgain).put("floatDeterministic",floatTranscript.equals(floatAgain))
    .put("savedPcmTranscript",pcmTranscript).put("savedPcmRecognized",recognized(pcmTranscript)).put("savedPcmUnityGainTranscript",unityTranscript).put("savedPcmUnityGainRecognized",recognized(unityTranscript));
   writeFloats(new File(folder,"float-path-synthesized-float32le.raw"),audio.samples);writeFloats(new File(folder,"float-path-asr-input-float32le-16k.raw"),floatInput);
   try(OutputStream out=new FileOutputStream(new File(folder,"float-path-synthesized.wav"))){out.write(wav);}
   evidence.put("originalFloatSamplesRetained",true).put("complete",true);
  } finally { try(Writer out=new FileWriter(new File(folder,"float-path-diagnostic.json"))){out.write(evidence.toString(2));} }
  assertTrue("Diagnostic evidence recorded",evidence.getBoolean("complete"));
 }
}
