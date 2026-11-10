package ai.alphacompute.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserPageReading;

import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Synthetic article in a real isolated HTTPS child; actual private HTTP and MediaPlayer. Sensitive
 * URLs and page content are refused before a review dialog, a token or outbound speech. */
public final class BrowserSensitiveReadingInstrumentedTest {
 private final BrowserReadingFixture reading=new BrowserReadingFixture();
 private final BrowserFlowInstrumentedTest child=reading.child;
 private String js(String code)throws Exception{return reading.js(code);}
 private void waitFor(String condition)throws Exception{reading.waitFor(condition);}
 private JSONObject result()throws Exception{return reading.result();}
 private JSONObject call(String code)throws Exception{return reading.call(code);}
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
 /** In-memory navigation fixture: exact synthetic routes only; never forwards network traffic. */
 private final class UrlFixture implements AutoCloseable {
  final android.webkit.WebView web;final android.webkit.WebViewClient original;
  final java.util.concurrent.atomic.AtomicInteger requests=new java.util.concurrent.atomic.AtomicInteger();
  final Set<String> urls=new HashSet<>();
  UrlFixture(String tabId)throws Exception{
   Object plugin=BrowserReadingFixture.resumedActivity().getBridge().getPlugin("AlphaBrowser").getInstance();
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
 private void urlVariants(String binding,BrowserReadingFixture.Server server)throws Exception {
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
    BoundedActivityScenario.main(()->{try{Object plugin=BrowserReadingFixture.resumedActivity().getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field field=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("reading");field.setAccessible(true);Object reading=field.get(plugin);java.lang.reflect.Field dialog=ai.eliza.plugins.browsersurface.BrowserReviewedReading.class.getDeclaredField("dialog");dialog.setAccessible(true);assertNull("Sensitive URL must not open review",dialog.get(reading));}catch(Exception e){throw new AssertionError(e);}});
    assertEquals("Review must not fetch another source",before,fixture.get().requests.get());assertEquals(0,server.bodies.size());
    assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.synthesizeBrowserReading({"+binding+",readingToken:'not-issued',requestId:'blocked-url-fixture'})").has("error"));assertEquals(0,server.bodies.size());
   }
  }finally{js("Promise.resolve(window.__urlFixtureListener).then(handle=>handle.remove());delete window.__urlFixtureListener;delete window.__urlFixtureState");BoundedActivityScenario.main(()->fixture.get().close());}
 }

 @Test public void sensitivePagesRejectBeforeReviewTokenOrOutboundSpeech()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading synthetic HTTP fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserSensitiveReading")));
  assertTrue("Run against a test-mocks app build: only that build admits this fixture's loopback HTTP route (any other build refuses it, correctly)",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BrowserReadingFixture.Server server=new BrowserReadingFixture.Server();BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   String origin=server.origin(),slot="remote:"+origin;long expiry=System.currentTimeMillis()+600000;
   String binding=BrowserReadingFixture.binding(origin,expiry);
   boolean installed=false;Throwable primary=null;
   try{
    reading.openExample();
    reading.writeSpeechToken(slot,origin,expiry);
    urlVariants(binding,server);
    navigate("https://example.com/");
    waitFor("document.querySelector('[role=img][aria-label=\"Secure connection\"]')");
    for(int i=0;i<300&&!"true".equals(child.child("location.href==='https://example.com/'&&document.readyState==='complete'"));i++)SystemClock.sleep(100);
    assertEquals("true",child.child("location.href==='https://example.com/'&&document.readyState==='complete'"));
    reading.installBody(BrowserReadingFixture.MARKUP);installed=true;
    reading.captureArgs();
    for(String url:new String[]{"https://pass.proton.me/","https://pass.proton.me./","https://vault.bitwarden.com/","https://accounts.google.com/","https://example.com/recovery","https://example.com/#/vault","https://example.com/?access_token=synthetic","https://example.com/%70assword"})assertTrue(url,BrowserPageReading.sensitiveUrl(url));
    assertFalse(BrowserPageReading.sensitiveUrl("https://example.com/gardening"));
    reading.sensitivePagesRefused(server,binding);
    assertEquals("true",child.child("document.body.innerHTML="+JSONObject.quote(BrowserReadingFixture.MARKUP)+";true"));
    reading.cancelThenApproveOnce(server,binding);
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{reading.cleanup(primary,slot,installed);}
  }
 }
}
