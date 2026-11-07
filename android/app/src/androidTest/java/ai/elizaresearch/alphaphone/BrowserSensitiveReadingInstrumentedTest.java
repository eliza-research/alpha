package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserPageReading;

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
public final class BrowserSensitiveReadingInstrumentedTest {
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
 private void navigate(String url)throws Exception{
  JSONObject target=new JSONObject((String)new JSONTokener(js("JSON.stringify(window.__readingTab)")).nextValue());
  JSONObject navigation=call("Capacitor.Plugins.AlphaBrowser.navigate({...window.__readingTab,url:"+JSONObject.quote(url)+"})");
  // Successful native state includes error:""; a rejected bridge call has error:true.
  assertTrue("Native navigation must return a string error state",navigation.get("error") instanceof String);
  assertEquals("Native navigation must report no error","",navigation.getString("error"));
  assertEquals(target.getString("session"),navigation.getString("session"));
  assertEquals(target.getString("id"),navigation.getString("id"));
  assertEquals(url,navigation.getString("url"));
 }
 private static String text(View view){String out=view instanceof TextView?((TextView)view).getText().toString():"";if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)out+="\n"+text(group.getChildAt(i));}return out;}
 private AlertDialog dialog(BoundedActivityScenario<MainActivity> scenario)throws Exception{AtomicReference<AlertDialog> result=new AtomicReference<>();for(int i=0;i<150;i++){BoundedActivityScenario.main(()->{MainActivity activity=resumedActivity();try{Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field reading=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("reading");reading.setAccessible(true);Object helper=reading.get(plugin);java.lang.reflect.Field field=ai.eliza.plugins.browsersurface.BrowserReviewedReading.class.getDeclaredField("dialog");field.setAccessible(true);result.set((AlertDialog)field.get(helper));}catch(Exception e){throw new AssertionError(e);}});if(result.get()!=null&&result.get().isShowing())return result.get();SystemClock.sleep(100);}throw new AssertionError("Actual review dialog missing");}
 /** In-memory navigation fixture: exact synthetic routes only; never forwards network traffic. */
 private final class UrlFixture implements AutoCloseable {
  final android.webkit.WebView web;final android.webkit.WebViewClient original;
  final java.util.concurrent.atomic.AtomicInteger requests=new java.util.concurrent.atomic.AtomicInteger();
  final Set<String> urls=new HashSet<>();
  UrlFixture(String tabId)throws Exception{
   Object plugin=resumedActivity().getBridge().getPlugin("AlphaBrowser").getInstance();
   java.lang.reflect.Field tabs=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("tabs");tabs.setAccessible(true);
   Object tab=((Map<?,?>)tabs.get(plugin)).get(tabId);assertNotNull(tab);
   java.lang.reflect.Field field=tab.getClass().getDeclaredField("web");field.setAccessible(true);web=(android.webkit.WebView)field.get(tab);original=web.getWebViewClient();assertNotNull(original);
   for(String key:new String[]{"api_key","api-key","api%20key","apikey","%61pi%5fkey","API+KEY"})urls.add("https://reading.invalid/?"+key+"=SYNTHETIC-ONLY");
   urls.add("https://reading.invalid/gardening");
   web.setWebViewClient(new android.webkit.WebViewClient(){
    @Override public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebView v,android.webkit.WebResourceRequest request){
     if(request.isForMainFrame())requests.incrementAndGet();boolean allowed=request.isForMainFrame()&&urls.contains(request.getUrl().toString());
     String body=allowed?"<html><body><article><p>Synthetic article for explicit reading.</p></article></body></html>":"Fixture route refused";
     return new android.webkit.WebResourceResponse("text/html","UTF-8",allowed?200:403,allowed?"OK":"Forbidden",Collections.emptyMap(),new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
    @Override public void onPageStarted(android.webkit.WebView v,String url,android.graphics.Bitmap icon){original.onPageStarted(v,url,icon);}
    @Override public void onPageCommitVisible(android.webkit.WebView v,String url){original.onPageCommitVisible(v,url);}
    @Override public void onPageFinished(android.webkit.WebView v,String url){original.onPageFinished(v,url);}
    @Override public void onReceivedError(android.webkit.WebView v,android.webkit.WebResourceRequest r,android.webkit.WebResourceError e){original.onReceivedError(v,r,e);}
    @Override public void onReceivedHttpError(android.webkit.WebView v,android.webkit.WebResourceRequest r,android.webkit.WebResourceResponse e){original.onReceivedHttpError(v,r,e);}
   });
  }
  public void close(){web.setWebViewClient(original);}
 }
 private void urlVariants(String binding,Server server)throws Exception {
  AtomicReference<UrlFixture> fixture=new AtomicReference<>();String tabId=new JSONObject((String)new JSONTokener(js("JSON.stringify(window.__readingTab)")).nextValue()).getString("id");
  BoundedActivityScenario.main(()->{try{fixture.set(new UrlFixture(tabId));}catch(Exception e){throw new AssertionError(e);}});
  js("window.__urlFixtureState=null;window.__urlFixtureListener=Capacitor.Plugins.AlphaBrowser.addListener('stateChanged',state=>window.__urlFixtureState=state)");
  try{
   for(String key:new String[]{"api_key","api-key","api%20key","apikey","%61pi%5fkey","API+KEY"}){
    String url="https://reading.invalid/?"+key+"=SYNTHETIC-ONLY";
    navigate(url);
    waitFor("window.__urlFixtureState?.url==="+JSONObject.quote(url)+"&&window.__urlFixtureState.committed&&!window.__urlFixtureState.loading&&!window.__urlFixtureState.error");
    js("window.__readingArgs=window.__urlFixtureState");
    assertEquals(url,new JSONTokener(child.child("location.href")).nextValue());
    assertEquals("true",js("window.__readingArgs.url==="+JSONObject.quote(url)));
    int before=fixture.get().requests.get();
    js("window.__readingResult=null;Capacitor.Plugins.AlphaBrowser.reviewReading({...window.__readingArgs,"+binding+"}).then(v=>window.__readingResult=JSON.stringify(v),e=>window.__readingResult=JSON.stringify({error:true,message:e.message}))");
    JSONObject denied=result();assertTrue(denied.toString(),denied.optBoolean("error"));assertEquals("Reading unavailable on a sensitive or unverified page",denied.getString("message"));assertFalse(denied.has("readingToken"));
    BoundedActivityScenario.main(()->{try{Object plugin=resumedActivity().getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field field=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("reading");field.setAccessible(true);Object reading=field.get(plugin);java.lang.reflect.Field dialog=ai.eliza.plugins.browsersurface.BrowserReviewedReading.class.getDeclaredField("dialog");dialog.setAccessible(true);assertNull("Sensitive URL must not open review",dialog.get(reading));}catch(Exception e){throw new AssertionError(e);}});
    assertEquals("Review must not fetch another source",before,fixture.get().requests.get());assertEquals(0,server.bodies.size());
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesizeBrowserReading({"+binding+",readingToken:'not-issued',requestId:'blocked-url-fixture'})").has("error"));assertEquals(0,server.bodies.size());
   }
  }finally{js("Promise.resolve(window.__urlFixtureListener).then(handle=>handle.remove());delete window.__urlFixtureListener;delete window.__urlFixtureState");BoundedActivityScenario.main(()->fixture.get().close());}
 }
 private static byte[] wav(){int samples=1600;ByteBuffer b=ByteBuffer.allocate(44+samples*2).order(ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+samples*2).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples*2);return b.array();}
 private static final class Server implements AutoCloseable {
  final ServerSocket socket=new ServerSocket(0,2,InetAddress.getByName("127.0.0.1"));final List<String> bodies=new CopyOnWriteArrayList<>();final ExecutorService worker=Executors.newSingleThreadExecutor();final Future<?> future;
  Server()throws Exception{future=worker.submit(()->{try{while(!socket.isClosed())try(Socket client=socket.accept()){client.setSoTimeout(10000);InputStream in=client.getInputStream();ByteArrayOutputStream header=new ByteArrayOutputStream();while(header.size()<16384){int c=in.read();if(c<0)throw new IOException();header.write(c);if(header.toString(StandardCharsets.US_ASCII).endsWith("\r\n\r\n"))break;}String headers=header.toString(StandardCharsets.US_ASCII);if(!headers.startsWith("POST /api/tts/local-inference HTTP/")||!headers.contains("Bearer browser-reading-synthetic"))throw new IOException();int length=0;for(String line:headers.split("\r\n"))if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());if(length<1||length>32768)throw new IOException();byte[] body=in.readNBytes(length);if(body.length!=length)throw new IOException();bodies.add(new String(body,StandardCharsets.UTF_8));byte[] audio=wav();OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: "+audio.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(audio);out.flush();}}catch(IOException error){if(!socket.isClosed())throw new RuntimeException(error);}});}
  public void close()throws Exception{socket.close();worker.shutdownNow();future.get(5,TimeUnit.SECONDS);}
 }
 @Test public void sensitivePagesRejectBeforeReviewTokenOrOutboundSpeech()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading synthetic HTTP fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserSensitiveReading")));
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
    assertFalse(call("Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+JSONObject.quote(slot)+",value:JSON.stringify({origin:"+JSONObject.quote(origin)+",identityId:'synthetic-browser-owner',token:'browser-reading-synthetic',expiresAt:"+expiry+"})})").has("error"));
    urlVariants(binding,server);
    navigate("https://example.com/");
    waitFor("document.querySelector('[role=img][aria-label=\"Secure connection\"]')");
    for(int i=0;i<300&&!"true".equals(child.child("location.href==='https://example.com/'&&document.readyState==='complete'"));i++)SystemClock.sleep(100);
    assertEquals("true",child.child("location.href==='https://example.com/'&&document.readyState==='complete'"));
    String markup="<article><p>"+article+"</p><form><p>"+secret+"</p><input value='"+secret+"'></form><p hidden>"+secret+"</p><p style='opacity:0'>"+secret+"</p><p aria-hidden='true'>"+secret+"</p><div contenteditable>"+secret+"</div></article>";
    assertEquals("true",child.child("(()=>{if(window["+JSONObject.quote(key)+"])return false;const old=document.body;window["+JSONObject.quote(key)+"]=old;const next=document.createElement('body');next.innerHTML="+JSONObject.quote(markup)+";old.replaceWith(next);return true;})()"));installed=true;
    js("window.__readingArgs=null;Capacitor.Plugins.AlphaBrowser.command({...window.__readingTab,command:'stop'}).then(v=>window.__readingArgs={session:v.session,id:v.id,navigation:v.navigation,url:v.url})");waitFor("window.__readingArgs");
    String review="Capacitor.Plugins.AlphaBrowser.reviewReading({...window.__readingArgs,"+binding+"})";
    for(String url:new String[]{"https://pass.proton.me/","https://pass.proton.me./","https://vault.bitwarden.com/","https://accounts.google.com/","https://example.com/recovery","https://example.com/#/vault","https://example.com/?access_token=synthetic","https://example.com/%70assword"})assertTrue(url,BrowserPageReading.sensitiveUrl(url));
    assertFalse(BrowserPageReading.sensitiveUrl("https://example.com/gardening"));
    for(String sensitive:new String[]{"<article><div>Your vault</div><div>synthetic-only</div></article>","<article><div>Password: synthetic-only</div></article>","<aside>Recovery codes: synthetic-only</aside><article>Garden journal</article>","<article><span>Verification</span><span>code</span><div>123456</div></article>","<article>123456</article>","<input type='password' hidden><article>Garden journal</article>","<input autocomplete='one-time-code'><article>Garden journal</article>","<article>"+"garden ".repeat(10000)+"</article>"}){
     assertEquals("true",child.child("document.body.innerHTML="+JSONObject.quote(sensitive)+";true"));
     JSONObject denied=call(review);assertTrue(denied.toString(),denied.has("error"));assertFalse(denied.has("readingToken"));assertEquals(0,server.bodies.size());
     assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesizeBrowserReading({"+binding+",readingToken:'not-issued',requestId:'blocked-fixture'})").has("error"));assertEquals(0,server.bodies.size());
    }
    assertEquals("true",child.child("document.body.innerHTML="+JSONObject.quote(markup)+";true"));
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
}
