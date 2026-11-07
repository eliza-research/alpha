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

/** Synthetic article in a real isolated HTTPS child; actual private HTTP and MediaPlayer. */
public final class BrowserUnsupportedReadingInstrumentedTest {
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
  Server()throws Exception{future=worker.submit(()->{try{while(!socket.isClosed())try(Socket client=socket.accept()){client.setSoTimeout(10000);InputStream in=client.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();while(header.size()<16384){int c=in.read();if(c<0)throw new IOException();header.write(c);if(header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n"))break;}String headers=header.toString(StandardCharsets.US_ASCII);if(!headers.startsWith("POST /api/tts/local-inference HTTP/")||!headers.contains("Bearer browser-reading-synthetic"))throw new IOException();int length=0;for(String line:headers.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());if(length<1||length>32768)throw new IOException();byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException();bodies.add(new String(body,StandardCharsets.UTF_8));byte[] audio=wav();OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: "+audio.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(audio);out.flush();}}catch(IOException error){if(!socket.isClosed())throw new RuntimeException(error);}});}
  public void close()throws Exception{socket.close();worker.shutdownNow();future.get(5,TimeUnit.SECONDS);}
 }
 @Test public void unsupportedProviderRejectsWithoutExtractionOrOutboundSpeech()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading synthetic HTTP fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserUnsupportedReading")));
  assertTrue("Run against a test-mocks app build: only that build admits this fixture's loopback HTTP route (any other build refuses it, correctly)",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  assertFalse("Run this negative flow on a provider without isolated-world injection",androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD));
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
    assertEquals("true",child.child("window.__extractionAttempted=false;window.__previousQuery=document.querySelector;document.querySelector=function(){window.__extractionAttempted=true;return window.__previousQuery.apply(this,arguments);};true"));
    assertTrue(call(review).has("error"));assertEquals(0,server.bodies.size());
    assertEquals("false",child.child("window.__extractionAttempted"));
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesizeBrowserReading({"+binding+",readingToken:'not-issued',requestId:'unsupported-fixture'})").has("error"));assertEquals(0,server.bodies.size());

   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    try{child.child("if(window.__previousQuery){document.querySelector=window.__previousQuery;delete window.__previousQuery;}delete window.__extractionAttempted;true");call("Capacitor.Plugins.AlphaVoiceCloud.stopPlayback()");call("Capacitor.Plugins.AlphaBrowser.cancelReading(window.__readingTab||{})");call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})");if(installed)assertEquals("true",child.child("(()=>{const old=window["+JSONObject.quote(key)+"];if(!old)return false;document.body.replaceWith(old);delete window["+JSONObject.quote(key)+"];return !window["+JSONObject.quote(key)+"];})()"));js("if(window.__readingNative)Capacitor.nativePromise=window.__readingNative;for(const k of ['__readingNative','__readingTab','__readingArgs','__readingResult','__readingEnded'])delete window[k]");}catch(Exception|AssertionError failure){if(primary!=null)primary.addSuppressed(failure);else throw failure;}
   }
  }
 }
}
