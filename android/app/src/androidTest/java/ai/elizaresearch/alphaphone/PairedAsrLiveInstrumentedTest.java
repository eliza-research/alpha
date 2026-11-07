package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.*;
import com.getcapacitor.JSObject;
import java.io.*;
import java.lang.reflect.Field;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in real paired host Whisper ASR, edited Notes review, TTS and MediaPlayer. Only recording ingress is synthetic. */
@RunWith(AndroidJUnit4.class)
public class PairedAsrLiveInstrumentedTest {
 private static void until(String expression,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Paired voice UI condition timed out");}
 private static void click(String label)throws Exception{String button="[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')==="+JSONObject.quote(label)+"||e.textContent.trim()==="+JSONObject.quote(label)+")&&e.getClientRects().length&&!e.disabled)";until(button,20000);WebViewTestDriver.evaluate(button+".click()");}
 private static MainActivity activity(){for(android.app.Activity a:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED))if(a instanceof MainActivity)return (MainActivity)a;throw new IllegalStateException();}
 private static AlphaVoiceCloudPlugin voice(){return (AlphaVoiceCloudPlugin)activity().getBridge().getPlugin("AlphaVoiceCloud").getInstance();}
 private static AlphaConnectionPlugin store(){return (AlphaConnectionPlugin)activity().getBridge().getPlugin("AlphaConnection").getInstance();}
 private static void field(Object object,String name,Object value)throws Exception{Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);field.set(object,value);}
 @Test public void actualPairedWhisperTranscriptReviewAndAudioPlayback()throws Exception{
  Assume.assumeTrue("Explicit live paired voice opt-in required","1".equals(InstrumentationRegistry.getArguments().getString("pairedAsrLive")));assertTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();File material=new File(context.getFilesDir(),"paired-asr-live.json");JSONObject input=new JSONObject(new String(Files.readAllBytes(material.toPath()),java.nio.charset.StandardCharsets.UTF_8));
  String origin=input.getString("origin");assertEquals("http://10.0.2.2:47846",origin);String code=input.getString("code"),slot="remote:"+origin;
  AtomicReference<String> originalCredential=new AtomicReference<>();String originalSelection=null;File audio=File.createTempFile("paired-asr-fixture-",".m4a",context.getCacheDir());
  // Synthetic AAC asset enters only at the recording boundary; no microphone is opened.
  try(InputStream stream=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("paired-whisper-fixture.m4a");OutputStream output=new FileOutputStream(audio)){byte[] buffer=new byte[8192];int count;while((count=stream.read(buffer))!=-1)output.write(buffer,0,count);}
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("window.Capacitor?.Plugins?.AlphaVoiceCloud&&document.querySelector('.os')",30000);
   originalSelection=WebViewTestDriver.evaluate("localStorage.getItem('alpha.connection.selection.v1')");
   BoundedActivityScenario.main(()->{try{originalCredential.set(store().readCredentialSlot(slot));assertTrue("Live Notes fixture requires no connected Cloud voice account",store().readCredentialSlot("cloud:production")==null&&store().readCredentialSlot("cloud:staging")==null);}catch(Exception e){throw new RuntimeException(e);}});
   try{
    String time=WebViewTestDriver.evaluate("performance.timeOrigin");WebViewTestDriver.evaluate("localStorage.removeItem('alpha.connection.selection.v1');location.replace(location.origin+location.pathname)");until("performance.timeOrigin!=="+time+"&&document.querySelector('.alpha-connection-scrim')",30000);
    WebViewTestDriver.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Local development agent').click()");
    WebViewTestDriver.evaluateSensitive("(()=>{const inputs=[...document.querySelectorAll('.alpha-connection details')].find(e=>e.querySelector('summary')?.textContent==='Local development agent').querySelectorAll('input');inputs[0].value="+JSONObject.quote(origin)+";inputs[1].value="+JSONObject.quote(code)+";})()");click("Connect local agent");
    until("!document.querySelector('.alpha-connection-scrim')",90000);AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"),30000);until("window.__alphaTestNavigation?.status==='complete'",30000);click("Record and transcribe");
    String clip=UUID.randomUUID().toString();
    // Intercept only recording ingress. All capability, synthesis, playback and cancellation calls remain native.
    WebViewTestDriver.evaluate("window.__voiceOriginalPromise=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method,options){if(plugin==='AlphaVoiceCloud'&&method==='startRecording')return Promise.resolve({recordingId:"+JSONObject.quote(clip)+",maxDurationMs:59000});return window.__voiceOriginalPromise.apply(this,arguments)}");
    click("Start recording");until("document.querySelector('button[aria-label=\"Stop recording\"]')",10000);
    BoundedActivityScenario.main(()->{try{Field f=ai.eliza.voice.LocalSpeechBridgePlugin.class.getDeclaredField("capture");f.setAccessible(true);Object capture=f.get(voice());field(capture,"file",audio);field(capture,"id",clip);field(capture,"durationMs",1000L);JSObject stopped=new JSObject();stopped.put("recordingId",clip);stopped.put("durationMs",1000);Field events=ai.eliza.voice.LocalVoiceRecording.class.getDeclaredField("events");events.setAccessible(true);((java.util.function.Consumer<JSObject>)events.get(capture)).accept(stopped);}catch(Exception e){throw new RuntimeException(e);}});
    WebViewTestDriver.evaluate("Capacitor.nativePromise=window.__voiceOriginalPromise;delete window.__voiceOriginalPromise");click("Transcribe with agent Whisper");
    until("document.querySelector('textarea[aria-label=\"Review transcript\"]')?.value.toLowerCase().includes('water the plants tomorrow morning')",150000);
    until("document.querySelector('textarea[aria-label=\"Review transcript\"]')",10000);
    WebViewTestDriver.evaluate("(()=>{const e=document.querySelector('textarea[aria-label=\"Review transcript\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Alpha Phone synthetic paired voice verification. The recording stays on this phone.');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    WebViewTestDriver.evaluate("window.__voiceEnded=0;window.__voiceFailed=0;window.__voiceListenersReady=false;Promise.all([Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackEnded',()=>window.__voiceEnded++),Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackFailed',()=>window.__voiceFailed++)]).then(handles=>{window.__voiceHandles=handles;window.__voiceListenersReady=true})");until("window.__voiceListenersReady",10000);
    click("Listen to transcript");until("window.__voiceEnded===1",150000);assertEquals("0",WebViewTestDriver.evaluate("window.__voiceFailed"));
    click("Listen to transcript");until("document.querySelector('button[aria-label=\"Stop audio\"]')",10000);click("Stop audio");until("document.querySelector('button[aria-label=\"Listen to transcript\"]')",15000);
    assertEquals("1",WebViewTestDriver.evaluate("window.__voiceEnded"));
    WebViewTestDriver.evaluate("window.dispatchEvent(new Event('alpha-back'))");until("!document.querySelector('textarea[aria-label=\"Review transcript\"]')",15000);
   }finally{
    WebViewTestDriver.evaluate("if(window.__voiceOriginalPromise)Capacitor.nativePromise=window.__voiceOriginalPromise;window.__voiceHandles?.forEach(h=>h.remove());window.__voiceCleaned=false;Promise.all([Capacitor.Plugins.AlphaVoiceCloud.cancelRecording(),Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()]).then(()=>window.__voiceCleaned=true)");
    until("window.__voiceCleaned",10000);
    BoundedActivityScenario.main(()->{try{if(originalCredential.get()!=null)store().writeCredentialSlot(slot,originalCredential.get());}catch(Exception e){throw new RuntimeException(e);}});
    if(originalCredential.get()==null){WebViewTestDriver.evaluate("window.__voiceRemoved=false;Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"}).then(()=>window.__voiceRemoved=true)");until("window.__voiceRemoved",10000);}
    if(originalSelection!=null)WebViewTestDriver.evaluate("(()=>{const value="+originalSelection+";if(value===null)localStorage.removeItem('alpha.connection.selection.v1');else localStorage.setItem('alpha.connection.selection.v1',value);})()");
    scenario.recreate();until("document.querySelector('.os')",30000);
   }
  }finally{material.delete();audio.delete();}
 }
}
