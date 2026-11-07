package ai.elizaresearch.alphaphone;

import android.app.AlertDialog;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Normal chooser pairing -> review -> actual combined Kokoro, plus held-response Stop. */
public final class BrowserReadingLiveInstrumentedTest {
 private final BrowserFlowInstrumentedTest child=new BrowserFlowInstrumentedTest();
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private static MainActivity resumedActivity(){
  for(android.app.Activity activity:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))if(activity instanceof MainActivity)return (MainActivity)activity;
  throw new IllegalStateException("No resumed Alpha Activity");
 }
 private void waitFor(String expression,long timeout)throws Exception{long end=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<end){if("true".equals(js("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Live browser reading did not reach expected state");}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(e=>(e.getAttribute('aria-label')==="+JSONObject.quote(label)+"||e.textContent.trim()==="+JSONObject.quote(label)+")&&!e.disabled&&e.getClientRects().length)";waitFor(q,30000);js("("+q+").click()");}
 private AlertDialog dialog(BoundedActivityScenario<MainActivity> scenario)throws Exception{AtomicReference<AlertDialog> out=new AtomicReference<>();for(int i=0;i<200;i++){BoundedActivityScenario.main(()->{MainActivity activity=resumedActivity();try{Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field f=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("reading");f.setAccessible(true);Object helper=f.get(plugin);f=ai.eliza.plugins.browsersurface.BrowserReviewedReading.class.getDeclaredField("dialog");f.setAccessible(true);out.set((AlertDialog)f.get(helper));}catch(Exception e){throw new AssertionError(e);}});if(out.get()!=null&&out.get().isShowing())return out.get();SystemClock.sleep(100);}throw new AssertionError("Native reading dialog missing");}
 private JSONObject proxy(String origin)throws Exception{HttpURLConnection c=(HttpURLConnection)new URL(origin+"/__reading/state").openConnection();c.setConnectTimeout(5000);c.setReadTimeout(5000);try(InputStream in=c.getInputStream()){byte[] bytes=in.readNBytes(16385);assertTrue(bytes.length<=16384);return new JSONObject(new String(bytes,StandardCharsets.UTF_8));}finally{c.disconnect();}}
 private void progress(String name){android.os.Bundle b=new android.os.Bundle();b.putString("browserReadingStage",name);InstrumentationRegistry.getInstrumentation().sendStatus(0,b);}
 @Test public void selectedCombinedAgentReadsReviewedTextAndStopAbortsHeldResponse()throws Exception{
  org.junit.Assume.assumeTrue("Explicit combined-host browser campaign","1".equals(InstrumentationRegistry.getArguments().getString("browserReadingLive")));
  File fixture=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"browser-reading-fixture.json");JSONObject config=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),java.nio.charset.StandardCharsets.UTF_8));String origin=config.getString("origin");assertEquals("http://10.0.2.2:47861",origin);
  String article=config.getString("text"),key="__alphaReadingLive"+config.getString("runId").replace("-",""),old=null,deviceSlot=null;boolean changed=false,pairing=false;Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   waitFor("document.querySelector('.os')",30000);old=js("localStorage.getItem('alpha.connection.selection.v1')");String hashInput=(String)new JSONTokener(js("JSON.stringify(["+JSONObject.quote(origin)+","+JSONObject.quote(config.getString("ownerId"))+","+JSONObject.quote(config.getString("agentId"))+"])")).nextValue();StringBuilder digest=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(hashInput.getBytes(StandardCharsets.UTF_8)))digest.append(String.format(java.util.Locale.ROOT,"%02x",b&255));deviceSlot="device:"+digest;
   AtomicReference<String> credential=new AtomicReference<>(),device=new AtomicReference<>();final String slot=deviceSlot;BoundedActivityScenario.main(()->{MainActivity activity=resumedActivity();try{AlphaConnectionPlugin store=(AlphaConnectionPlugin)activity.getBridge().getPlugin("AlphaConnection").getInstance();credential.set(store.readCredentialSlot("remote:"+origin));device.set(store.readCredentialSlot(slot));}catch(Exception e){throw new AssertionError(e);}});assertNull("Do not overwrite existing pairing",credential.get());assertNull("Do not overwrite existing enrollment",device.get());
   try{
    String time=js("performance.timeOrigin");js("localStorage.removeItem('alpha.connection.selection.v1');location.replace(location.origin+location.pathname)");waitFor("performance.timeOrigin!=="+time+"&&document.querySelector('.alpha-connection-scrim')",30000);
    js("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Local development agent').click()");WebViewTestDriver.evaluateSensitive("(()=>{const fields=[...document.querySelectorAll('.alpha-connection details')].find(e=>e.querySelector('summary')?.textContent==='Local development agent').querySelectorAll('input');fields[0].value="+JSONObject.quote(origin)+";fields[1].value="+JSONObject.quote(config.getString("code"))+";})()");pairing=true;click("Connect local agent");waitFor("!document.querySelector('.alpha-connection-scrim')",90000);progress("paired");
    AppNavigation.liveMode();js(AppNavigation.request("Browser"));waitFor(AppNavigation.selected("Browser"),30000);waitFor("window.__alphaTestNavigation?.status==='complete'",30000);
    // The native page is withdrawn while the modal first-run access panel is open; answer it first, as an owner does.
    AppNavigation.declineStartupAccess();
    if("false".equals(js("!!document.querySelector('input[aria-label=Address]')")))click("Edit address");waitFor("document.querySelector('input[aria-label=Address]')",15000);js("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'https://example.com/');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");waitFor("document.querySelector('[role=img][aria-label=\"Secure connection\"]')",45000);
    assertEquals("true",child.child("typeof Capacitor==='undefined'&&location.origin==='https://example.com'"));String markup="<article><p>"+article+"</p><form>Hidden form canary<input type='password' value='excluded'></form><p hidden>Hidden canary</p></article>";
    assertEquals("true",child.child("(()=>{if(window["+JSONObject.quote(key)+"])return false;window["+JSONObject.quote(key)+"]=document.body;const n=document.createElement('body');n.innerHTML="+JSONObject.quote(markup)+";document.body.replaceWith(n);return true;})()"));changed=true;
    js("window.__readingFinished=0;window.__readingFailed=0;window.__readingHandles=[];Promise.all([Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackEnded',()=>window.__readingFinished++),Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackFailed',()=>window.__readingFailed++)]).then(v=>window.__readingHandles=v)");waitFor("window.__readingHandles.length===2",10000);
    click("Menu");click("Read aloud");AlertDialog cancel=dialog(scenario);assertEquals(0,proxy(origin).getInt("posts"));BoundedActivityScenario.main(()->cancel.getButton(AlertDialog.BUTTON_NEGATIVE).performClick());SystemClock.sleep(300);assertEquals(0,proxy(origin).getInt("posts"));progress("cancel-zero-transfer");
    click("Menu");click("Read aloud");AlertDialog approve=dialog(scenario);child.child("document.querySelector('article p').textContent='Not the reviewed payload';true");BoundedActivityScenario.main(()->approve.getButton(AlertDialog.BUTTON_POSITIVE).performClick());waitFor("window.__readingFinished===1",150000);assertEquals(1,proxy(origin).getInt("posts"));progress("real-kokoro-playback");
    // Let the controller retire the first immutable snapshot before the next request.
    SystemClock.sleep(300);child.child("document.querySelector('article p').textContent="+JSONObject.quote(article)+";true");click("Menu");click("Read aloud");AlertDialog second=dialog(scenario);BoundedActivityScenario.main(()->second.getButton(AlertDialog.BUTTON_POSITIVE).performClick());
    long deadline=SystemClock.elapsedRealtime()+150000;JSONObject status=null;while(SystemClock.elapsedRealtime()<deadline){status=proxy(origin);if(status.optBoolean("held"))break;SystemClock.sleep(100);}assertTrue("Actual successful upstream response held",status!=null&&status.optBoolean("held"));AlertDialog stop=dialog(scenario);BoundedActivityScenario.main(()->{MainActivity a=resumedActivity();assertEquals("Stop reading",stop.getButton(AlertDialog.BUTTON_NEGATIVE).getText().toString());stop.getButton(AlertDialog.BUTTON_NEGATIVE).performClick();});
    deadline=SystemClock.elapsedRealtime()+15000;while(SystemClock.elapsedRealtime()<deadline){status=proxy(origin);if(status.optBoolean("cancelled"))break;SystemClock.sleep(100);}assertTrue("Actual HTTP transport disconnected",status!=null&&status.optBoolean("cancelled"));SystemClock.sleep(500);assertEquals("No cancelled late playback","1",js("window.__readingFinished"));assertEquals(2,status.getInt("posts"));
    BoundedActivityScenario.main(()->{MainActivity a=resumedActivity();try{Object voice=a.getBridge().getPlugin("AlphaVoiceCloud").getInstance();for(String field:new String[]{"playbackFile","player","playbackId"}){java.lang.reflect.Field f=ai.eliza.voice.LocalSpeechBridgePlugin.class.getDeclaredField(field);f.setAccessible(true);assertNull("Cancelled private playback cleared",f.get(voice));}}catch(Exception e){throw new AssertionError(e);}});progress("held-response-cancelled");
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    try{if(changed)assertEquals("true",child.child("(()=>{const old=window["+JSONObject.quote(key)+"];if(!old)return false;document.body.replaceWith(old);delete window["+JSONObject.quote(key)+"];return true;})()"));js("window.__readingClean=false;Promise.all((window.__readingHandles||[]).map(h=>h.remove())).then(()=>window.__readingClean=true)");waitFor("window.__readingClean",10000);
     if(pairing){js("window.__readingRemoved=false;Promise.all([Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote("remote:"+origin)+"}),Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(deviceSlot)+"})]).then(()=>window.__readingRemoved=true)");waitFor("window.__readingRemoved",10000);}js("(()=>{const prior="+old+";if(prior===null)localStorage.removeItem('alpha.connection.selection.v1');else localStorage.setItem('alpha.connection.selection.v1',prior);})()");scenario.recreate();waitFor("document.querySelector('.os')",30000);
    }catch(Exception|AssertionError failure){if(primary!=null)primary.addSuppressed(failure);else throw failure;}
   }
  }finally{fixture.delete();}
 }
}
