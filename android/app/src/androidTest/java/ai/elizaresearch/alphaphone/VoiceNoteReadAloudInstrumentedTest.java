package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.net.ConnectivityManager;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * daily-11: the note read-aloud route on Android. Through the real Capacitor bridge, the
 * renderer's local speech calls synthesize note text with the on-device engine
 * (synthesizeLocal, execution "device"), play it with MediaPlayer, finish with playbackEnded,
 * and a stop request ends a longer passage with playbackStopped. Opt-in with -e localSpeech 1
 * and networking disabled, like FusedSpeechInstrumentedTest. This is emulator or device evidence
 * for the playback route only, not speaker intelligibility to a listener.
 */
@RunWith(AndroidJUnit4.class)
public final class VoiceNoteReadAloudInstrumentedTest {
 private static void until(String expression,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Read-aloud condition timed out: "+expression);}
 /** Starts one local passage through the bridge; results land on window.__readAloud. */
 private static String speak(String text,boolean stopAfterStart){
  return "(()=>{const v=Capacitor.Plugins.AlphaVoiceCloud,r=window.__readAloud={events:[],state:'preparing'},requestId=crypto.randomUUID();"
   + "for(const e of ['playbackEnded','playbackFailed','playbackStopped'])v.addListener(e,x=>{r.events.push(e);if(x.playbackId===r.playbackId)r.state=e;});"
   + "v.synthesizeLocal({text:"+JSONObject.quote(text)+",requestId}).then(p=>{r.playbackId=p.playbackId;r.execution=p.execution;return v.play({playbackId:p.playbackId});})"
   + ".then(()=>{r.started=true;"+(stopAfterStart?"return v.stopPlayback({requestId});":"")+"}).catch(e=>{r.state='error';r.error=String(e&&e.message||e);});})()";
 }
 @Test public void noteTextPlaysLocallyAndStops()throws Exception {
  org.junit.Assume.assumeTrue("Opt-in real local models required","1".equals(InstrumentationRegistry.getArguments().getString("localSpeech")));
  Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertNull("Disable device networking before on-device acceptance",app.getSystemService(ConnectivityManager.class).getActiveNetwork());
  JSONObject evidence=new JSONObject().put("pass",false);File folder=new File(app.getExternalFilesDir(null),"local-speech-evidence");assertTrue(folder.isDirectory()||folder.mkdirs());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("window.Capacitor?.Plugins?.AlphaVoiceCloud&&document.querySelector('.os')",60000);
   long start=SystemClock.elapsedRealtime();
   WebViewTestDriver.evaluate(speak("Groceries. Milk and eggs.",false));
   until("window.__readAloud.state!=='preparing'",180000);
   evidence.put("shortPassageMs",SystemClock.elapsedRealtime()-start).put("shortExecution",WebViewTestDriver.evaluate("window.__readAloud.execution"));
   assertEquals("A short note plays to completion","\"playbackEnded\"",WebViewTestDriver.evaluate("window.__readAloud.state"));
   assertEquals("Read aloud runs on the device engine","\"device\"",WebViewTestDriver.evaluate("window.__readAloud.execution"));
   WebViewTestDriver.evaluate(speak("This is a longer note that keeps playing until it is stopped. It has several sentences so it lasts long enough to stop. The last sentence is never reached.",true));
   until("window.__readAloud.state!=='preparing'",180000);
   assertEquals("Stop ends the reading","\"playbackStopped\"",WebViewTestDriver.evaluate("window.__readAloud.state"));
   assertEquals("Playback had started before the stop","true",WebViewTestDriver.evaluate("window.__readAloud.started===true"));
   assertNull(app.getSystemService(ConnectivityManager.class).getActiveNetwork());
   evidence.put("pass",true).put("physicalSpeakerVerified",false);
  } finally { try(Writer out=new FileWriter(new File(folder,"note-read-aloud.json"))){out.write(evidence.toString(2));} }
 }
}
