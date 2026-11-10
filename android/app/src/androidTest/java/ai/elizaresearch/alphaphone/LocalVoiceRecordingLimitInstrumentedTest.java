package ai.elizaresearch.alphaphone;

import ai.eliza.voice.LocalSpeechEngine;
import android.content.Context;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.io.*;
import java.util.Arrays;
import java.util.concurrent.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real MediaRecorder deadline and full decoded duration; no truncated audio acceptance. */
@RunWith(AndroidJUnit4.class)
public final class LocalVoiceRecordingLimitInstrumentedTest {
 @Test public void nativeLocalDeadlineStopsBeforeAsrMaximum()throws Exception {
  org.junit.Assume.assumeTrue("Explicit microphone recording test required","1".equals(InstrumentationRegistry.getArguments().getString("localVoiceRecording")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals("Grant microphone permission on the disposable test device first",PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO));
  File fixtureCache=new File(context.getCacheDir(),"voice-limit-fixture-"+java.util.UUID.randomUUID());assertTrue(fixtureCache.mkdirs());
  Context isolated=new android.content.ContextWrapper(context){@Override public File getCacheDir(){return fixtureCache;}};
  BlockingQueue<JSONObject> events=new LinkedBlockingQueue<>();ai.eliza.voice.LocalVoiceRecording capture=new ai.eliza.voice.LocalVoiceRecording(isolated,"alpha-cloud-voice-",events::offer);
  JSONObject evidence=new JSONObject().put("pass",false);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
   JSONObject started=capture.start(29000);assertEquals(29000,started.getInt("maxDurationMs"));
   JSONObject stopped=events.poll(36,TimeUnit.SECONDS);assertNotNull("Native deadline fires without any renderer timer",stopped);assertEquals("recorded",stopped.getString("status"));
   File selected=capture.selected(started.getString("recordingId"));assertNotNull(selected);
   byte[] wav=ai.eliza.voice.RecordingPcm.decode(selected,()->false);float[] full;
   try{full=LocalSpeechEngine.readMono16kWav(new ByteArrayInputStream(wav));}finally{Arrays.fill(wav,(byte)0);}
   evidence.put("fullDecodedSamples",full.length).put("fullDecodedDurationMs",full.length/16).put("nativeReportedDurationMs",stopped.getLong("durationMs"));
   assertTrue("Captured a real near-limit recording",full.length>=16000*27);assertTrue("Entire decoded recording fits local ASR",full.length<=16000*30);Arrays.fill(full,0);
   evidence.put("pass",true).put("rendererTimerUsed",false).put("audioTruncated",false);
  } finally {
   capture.cancel();File[] leftovers=fixtureCache.listFiles();if(leftovers!=null)for(File file:leftovers)file.delete();fixtureCache.delete();File folder=new File(context.getExternalFilesDir(null),"local-speech-evidence");folder.mkdirs();try(Writer writer=new FileWriter(new File(folder,"recording-limit.json"))){writer.write(evidence.toString(2));}
  }
 }
}
