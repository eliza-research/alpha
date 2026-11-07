package ai.elizaresearch.alphaphone;

import android.app.AlertDialog;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Synthetic article in a real isolated HTTPS child; actual private HTTP and MediaPlayer. The
 * resident (execution 'device') path is covered by residentReadingTokenIsSingleUseAndBound. */
public final class BrowserReadingInstrumentedTest {
 private final BrowserFlowInstrumentedTest child=new BrowserFlowInstrumentedTest();
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private static MainActivity resumedActivity(){
  for(android.app.Activity activity:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))if(activity instanceof MainActivity)return (MainActivity)activity;
  throw new IllegalStateException("No resumed Alpha Activity");
 }
 private void waitFor(String condition)throws Exception{for(int i=0;i<300;i++){if("true".equals(js("Boolean("+condition+")")))return;SystemClock.sleep(100);}fail("Browser reading state timed out: "+condition);}
 private void invoke(String code)throws Exception{js("window.__readingResult=null;Promise.resolve("+code+").then(v=>window.__readingResult=JSON.stringify(v||{}),()=>window.__readingResult=JSON.stringify({error:true}))");}
 private JSONObject result()throws Exception{waitFor("window.__readingResult!==null");return new JSONObject((String)new JSONTokener(js("window.__readingResult")).nextValue());}
 private JSONObject call(String code)throws Exception{invoke(code);return result();}
 private static String text(View view){String out=view instanceof TextView?((TextView)view).getText().toString():"";if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)out+="\n"+text(group.getChildAt(i));}return out;}
 private AlertDialog dialog(BoundedActivityScenario<MainActivity> scenario)throws Exception{AtomicReference<AlertDialog> result=new AtomicReference<>();for(int i=0;i<150;i++){BoundedActivityScenario.main(()->{MainActivity activity=resumedActivity();try{Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field reading=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("reading");reading.setAccessible(true);Object helper=reading.get(plugin);java.lang.reflect.Field field=ai.eliza.plugins.browsersurface.BrowserReviewedReading.class.getDeclaredField("dialog");field.setAccessible(true);result.set((AlertDialog)field.get(helper));}catch(Exception e){throw new AssertionError(e);}});if(result.get()!=null&&result.get().isShowing())return result.get();SystemClock.sleep(100);}throw new AssertionError("Actual review dialog missing");}
 private static byte[] wav(){int samples=1600;ByteBuffer b=ByteBuffer.allocate(44+samples*2).order(ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+samples*2).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples*2);return b.array();}
 private static final class Server implements AutoCloseable {
  final ServerSocket socket=new ServerSocket(0,2,InetAddress.getByName("127.0.0.1"));final List<String> bodies=new CopyOnWriteArrayList<>();final ExecutorService worker=Executors.newSingleThreadExecutor();final Future<?> future;
  Server()throws Exception{future=worker.submit(()->{try{while(!socket.isClosed())try(Socket client=socket.accept()){client.setSoTimeout(10000);InputStream in=client.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();while(header.size()<16384){int c=in.read();if(c<0)throw new IOException();header.write(c);if(header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n"))break;}String headers=header.toString(StandardCharsets.US_ASCII);if(!headers.startsWith("POST /api/tts/paradee HTTP/")||!headers.contains("Bearer browser-reading-synthetic"))throw new IOException();String requestId="";for(String line:headers.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("x-request-id:"))requestId=line.substring(13).trim();int length=0;for(String line:headers.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());if(length<1||length>32768)throw new IOException();byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException();bodies.add(new String(body,StandardCharsets.UTF_8));byte[] audio=wav();OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: "+audio.length+"\r\nX-Request-Id: "+requestId+"\r\nX-Eliza-Speech-Provider: libelizainference-paradee\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(audio);out.flush();}}catch(IOException error){if(!socket.isClosed())throw new RuntimeException(error);}});}
  public void close()throws Exception{socket.close();worker.shutdownNow();future.get(5,TimeUnit.SECONDS);}
 }
 @Test public void explicitImmutableReviewExcludesSensitiveSubtreesAndRejectsReplay()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading synthetic HTTP fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserReading")));
  assertTrue("Run against a test-mocks app build: only that build admits this fixture's loopback HTTP route (any other build refuses it, correctly)",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(Server server=new Server();BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   String origin="http://127.0.0.1:"+server.socket.getLocalPort(),slot="remote:"+origin,key="__alphaReading"+UUID.randomUUID().toString().replace("-",""),article="Synthetic article for explicit reading.",secret="excluded-synthetic-marker";long expiry=System.currentTimeMillis()+600000;
   String binding="origin:"+JSONObject.quote(origin)+",ownerId:'synthetic-browser-owner',sessionId:'synthetic-browser-session',expiresAt:"+expiry;
   boolean installed=false;Throwable primary=null;
   try{
    AppNavigation.liveMode();js(AppNavigation.request("Browser"));waitFor(AppNavigation.selected("Browser"));waitFor("window.__alphaTestNavigation?.status==='complete'");
    // The native page is withdrawn while the modal first-run access panel is open; answer it first, as an owner does.
    AppNavigation.declineStartupAccess();
    js("window.__readingNative=Capacitor.nativePromise;Capacitor.nativePromise=function(p,m,a){if(p==='AlphaBrowser'&&m==='present'&&a.id)window.__readingTab={session:a.session,id:a.id};return window.__readingNative.apply(this,arguments);}");
    js("(()=>{const e=document.querySelector('input[aria-label=Address]');if(e){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'https://example.com/');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}else [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Edit address').click();})()");
    if("true".equals(js("!!document.querySelector('input[aria-label=Address]')")))js("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'https://example.com/');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");
    waitFor("window.__readingTab&&document.querySelector('[role=img][aria-label=\"Secure connection\"]')");
    assertEquals("true",child.child("typeof Capacitor==='undefined'&&location.origin==='https://example.com'"));
    String markup="<article><p>"+article+"</p><form><p>"+secret+"</p><input value='"+secret+"'></form><p hidden>"+secret+"</p><p style='opacity:0'>"+secret+"</p><p aria-hidden='true'>"+secret+"</p><div contenteditable>"+secret+"</div></article>";
    assertEquals("true",child.child("(()=>{if(window["+JSONObject.quote(key)+"])return false;const old=document.body;window["+JSONObject.quote(key)+"]=old;const next=document.createElement('body');next.innerHTML="+JSONObject.quote(markup)+";old.replaceWith(next);return true;})()"));installed=true;
    assertFalse(call("Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+JSONObject.quote(slot)+",value:JSON.stringify({origin:"+JSONObject.quote(origin)+",identityId:'synthetic-browser-owner',token:'browser-reading-synthetic',expiresAt:"+expiry+"})})").has("error"));
    js("window.__readingArgs=null;Capacitor.Plugins.AlphaBrowser.command({...window.__readingTab,command:'stop'}).then(v=>window.__readingArgs={session:v.session,id:v.id,navigation:v.navigation,url:v.url})");waitFor("window.__readingArgs");
    String review="Capacitor.Plugins.AlphaBrowser.reviewReading({...window.__readingArgs,"+binding+"})";
    invoke(review);AlertDialog cancelled=dialog(scenario);BoundedActivityScenario.main(()->{MainActivity activity=resumedActivity();assertTrue(text(cancelled.getWindow().getDecorView()).contains(article));assertFalse(text(cancelled.getWindow().getDecorView()).contains(secret));cancelled.getButton(AlertDialog.BUTTON_NEGATIVE).performClick();});assertTrue(result().has("error"));assertEquals(0,server.bodies.size());
    invoke(review);AlertDialog approved=dialog(scenario);assertEquals(0,server.bodies.size());
    child.child("document.querySelector('article p').textContent='Changed after review';true");
    BoundedActivityScenario.main(()->approved.getButton(AlertDialog.BUTTON_POSITIVE).performClick());String token=result().getString("readingToken");
    String synth="Capacitor.Plugins.AlphaVoiceCloud.synthesizeBrowserReading({"+binding+",readingToken:"+JSONObject.quote(token)+",requestId:'69f8b4b6-cfe5-4de0-96ef-cdd304f4e4b2'})";
    JSONObject audio=call(synth);assertFalse(audio.toString(),audio.has("error"));assertEquals(1,server.bodies.size());assertEquals(article,new JSONObject(server.bodies.get(0)).getString("text"));assertFalse(server.bodies.get(0).contains(secret));
    js("window.__readingEnded=false;Capacitor.Plugins.AlphaVoiceCloud.addListener('playbackEnded',()=>window.__readingEnded=true)");assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.play({playbackId:"+JSONObject.quote(audio.getString("playbackId"))+"})").has("error"));waitFor("window.__readingEnded===true");assertTrue(call(synth).has("error"));assertEquals(1,server.bodies.size());
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    try{call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()");call("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__readingTab||{})");call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})");if(installed)assertEquals("true",child.child("(()=>{const old=window["+JSONObject.quote(key)+"];if(!old)return false;document.body.replaceWith(old);delete window["+JSONObject.quote(key)+"];return !window["+JSONObject.quote(key)+"];})()"));js("if(window.__readingNative)Capacitor.nativePromise=window.__readingNative;for(const k of ['__readingNative','__readingTab','__readingArgs','__readingResult','__readingEnded'])delete window[k]");}catch(Exception|AssertionError failure){if(primary!=null)primary.addSuppressed(failure);else throw failure;}
   }
  }
 }

 /** {ok, message} of a plugin call, so refusals can be told apart from a later speech failure. */
 private JSONObject settle(String code)throws Exception{
  js("window.__readingSettled=null;Promise.resolve("+code+").then(v=>window.__readingSettled={ok:true,value:v??{}},e=>window.__readingSettled={ok:false,message:String(e?.message??'')})");
  waitFor("window.__readingSettled!==null");return new JSONObject(js("window.__readingSettled"));
 }
 private static final String EXPIRED="Reading approval expired";
 /** Review and approve one device reading; returns its token. */
 private String approveDevice(BoundedActivityScenario<MainActivity> scenario,String binding)throws Exception{
  invoke("Capacitor.Plugins.AlphaBrowser.reviewReading({...window.__readingArgs,execution:'device',"+binding+"})");
  AlertDialog approved=dialog(scenario);
  BoundedActivityScenario.main(()->approved.getButton(AlertDialog.BUTTON_POSITIVE).performClick());
  JSONObject review=result();assertFalse("Device reading approved: "+review,review.has("error"));return review.getString("readingToken");
 }
 /**
  * The resident path production uses (createNativeReadingVoice prefers the resident binding and
  * calls AlphaVoiceCloud.synthesizeLocalBrowserReading with execution 'device'). One approved token:
  * execution other than 'device', a wrong session, a wrong owner and an unknown token are refused
  * without spending it; the exact binding is accepted once (synthesis may then fail on an image
  * without the packaged speech models, which is a later, different error); a replay is refused. An
  * expired binding and a cancelled review are refused too. Nothing is sent to any host.
  */
 @Test public void residentReadingTokenIsSingleUseAndBound()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserReading")));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   String key="__alphaReading"+UUID.randomUUID().toString().replace("-",""),article="Synthetic article for resident reading.";boolean installed=false;Throwable primary=null;
   try{
    AppNavigation.liveMode();js(AppNavigation.request("Browser"));waitFor(AppNavigation.selected("Browser"));waitFor("window.__alphaTestNavigation?.status==='complete'");
    AppNavigation.declineStartupAccess();
    js("window.__readingNative=Capacitor.nativePromise;Capacitor.nativePromise=function(p,m,a){if(p==='AlphaBrowser'&&m==='present'&&a.id)window.__readingTab={session:a.session,id:a.id};return window.__readingNative.apply(this,arguments);}");
    js("(()=>{const e=document.querySelector('input[aria-label=Address]');if(e){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'https://example.com/');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}else [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Edit address').click();})()");
    if("true".equals(js("!!document.querySelector('input[aria-label=Address]')")))js("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'https://example.com/');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");
    waitFor("window.__readingTab&&document.querySelector('[role=img][aria-label=\"Secure connection\"]')");
    assertEquals("true",child.child("(()=>{if(window["+JSONObject.quote(key)+"])return false;const old=document.body;window["+JSONObject.quote(key)+"]=old;const next=document.createElement('body');next.innerHTML="+JSONObject.quote("<article><p>"+article+"</p></article>")+";old.replaceWith(next);return true;})()"));installed=true;
    js("window.__readingArgs=null;Capacitor.Plugins.AlphaBrowser.command({...window.__readingTab,command:'stop'}).then(v=>window.__readingArgs={session:v.session,id:v.id,navigation:v.navigation,url:v.url})");waitFor("window.__readingArgs");
    long expiry=System.currentTimeMillis()+100_000;
    String binding="ownerId:'synthetic-resident-owner',sessionId:'synthetic-resident-session',expiresAt:"+expiry;
    String token=approveDevice(scenario,binding);
    String local="Capacitor.Plugins.AlphaVoiceCloud.synthesizeLocalBrowserReading({ownerId:%s,sessionId:%s,expiresAt:"+expiry+",readingToken:%s,execution:%s,requestId:'resident-reading-'+Date.now()})";
    java.util.function.BiFunction<String[],String,String> with=(parts,tok)->String.format(local,JSONObject.quote(parts[0]),JSONObject.quote(parts[1]),JSONObject.quote(tok),JSONObject.quote(parts[2]));
    String[] exact={"synthetic-resident-owner","synthetic-resident-session","device"};
    // Refusals that never spend the approval.
    assertEquals("Not device execution",EXPIRED,settle(with.apply(new String[]{exact[0],exact[1],"agent"},token)).optString("message"));
    assertEquals("Wrong session",EXPIRED,settle(with.apply(new String[]{exact[0],"other-session",exact[2]},token)).optString("message"));
    assertEquals("Wrong owner",EXPIRED,settle(with.apply(new String[]{"other-owner",exact[1],exact[2]},token)).optString("message"));
    assertEquals("Unknown token",EXPIRED,settle(with.apply(exact,UUID.randomUUID().toString())).optString("message"));
    // The exact binding is accepted once; any later failure is synthesis, never the approval.
    JSONObject accepted=settle(with.apply(exact,token));
    assertFalse("The valid token is accepted: "+accepted,!accepted.getBoolean("ok")&&EXPIRED.equals(accepted.optString("message")));
    call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()");call("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__readingTab||{})");
    assertEquals("A replayed token is refused",EXPIRED,settle(with.apply(exact,token)).optString("message"));
    // Expired: the binding's own expiry passes before the token is used.
    long soon=System.currentTimeMillis()+4000;
    String expiring=approveDevice(scenario,"ownerId:'synthetic-resident-owner',sessionId:'synthetic-resident-session',expiresAt:"+soon);
    SystemClock.sleep(Math.max(0,soon-System.currentTimeMillis())+500);
    assertEquals("An expired binding is refused",EXPIRED,settle(String.format("Capacitor.Plugins.AlphaVoiceCloud.synthesizeLocalBrowserReading({ownerId:'synthetic-resident-owner',sessionId:'synthetic-resident-session',expiresAt:"+soon+",readingToken:%s,execution:'device',requestId:'resident-expired'})",JSONObject.quote(expiring))).optString("message"));
    // Cancelled: cancelling the approved review withdraws its token.
    String cancelled=approveDevice(scenario,binding);
    assertFalse(call("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__readingTab||{})").has("error"));
    assertEquals("A cancelled review's token is refused",EXPIRED,settle(with.apply(exact,cancelled)).optString("message"));
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    try{call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()");call("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__readingTab||{})");if(installed)assertEquals("true",child.child("(()=>{const old=window["+JSONObject.quote(key)+"];if(!old)return false;document.body.replaceWith(old);delete window["+JSONObject.quote(key)+"];return !window["+JSONObject.quote(key)+"];})()"));js("if(window.__readingNative)Capacitor.nativePromise=window.__readingNative;for(const k of ['__readingNative','__readingTab','__readingArgs','__readingResult','__readingSettled'])delete window[k]");}catch(Exception|AssertionError failure){if(primary!=null)primary.addSuppressed(failure);else throw failure;}
   }
  }
 }
}
