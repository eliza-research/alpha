package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserPageReading;
import ai.eliza.plugins.browsersurface.BrowserReadingWorld;
import ai.eliza.plugins.browsersurface.BrowserReviewedReading;

import android.net.Uri;
import android.os.SystemClock;
import android.webkit.*;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.*;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real WebView/proxy, deterministic delayed delivery through the registered listener. */
public final class BrowserReadingNavigationInstrumentedTest {
 private static Object field(Object target,String name)throws Exception {java.lang.reflect.Field f=target.getClass().getDeclaredField(name);f.setAccessible(true);return f.get(target);}
 private static void ready(BrowserReadingWorld world)throws Exception {
  for(int i=0;i<150;i++){AtomicReference<Boolean> value=new AtomicReference<>(false);BoundedActivityScenario.main(()->value.set(world.ready()));if(value.get())return;SystemClock.sleep(100);}fail("Isolated document handshake did not become ready");
 }
 /** The provider's own answer, checked against the product's, and recorded with the run. */
 private static boolean provider(){
  boolean capable=WebViewFeature.isFeatureSupported(WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD);
  assertEquals("The product reports the provider's isolated-world capability as it is",capable,BrowserReadingWorld.supported());
  android.os.Bundle seen=new android.os.Bundle();seen.putString("browserReadingProvider",capable?"isolated-world":"no-isolated-world");InstrumentationRegistry.getInstrumentation().sendStatus(0,seen);
  return capable;
 }
 private static String host(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private static void until(String js)throws Exception{for(int i=0;i<150;i++){if("true".equals(host("Boolean("+js+")")))return;SystemClock.sleep(100);}fail("Browser reading state missing: "+js);}
 private static void click(String label)throws Exception{String q="[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+org.json.JSONObject.quote(label)+"&&e.getClientRects().length)";until(q);host("("+q+").click()");}
 /** A call that records its answer; nothing is sent to a page. */
 private static final class RecordedCall extends com.getcapacitor.PluginCall {
  final AtomicReference<String> message=new AtomicReference<>(),code=new AtomicReference<>();final java.util.concurrent.atomic.AtomicBoolean resolved=new java.util.concurrent.atomic.AtomicBoolean();
  RecordedCall(){super(null,"AlphaBrowser","reading-unavailable-test","reviewQuestion",new com.getcapacitor.JSObject());}
  @Override public void reject(String msg,String errorCode,Exception ex,com.getcapacitor.JSObject data){message.set(msg);code.set(errorCode);}
  @Override public void resolve(com.getcapacitor.JSObject data){resolved.set(true);}
  @Override public void resolve(){resolved.set(true);}
 }
 /**
  * A provider without isolated-world injection (the SDK emulator's WebView 133 is one) gets no page
  * reading. This asserts the honest state: nothing is injected into the page's own world, the
  * native review refuses with the unavailable answer before any extraction, and the browser says
  * so in its menu and when either reading action is chosen.
  */
 @Test public void providerWithoutIsolatedWorldSaysReadingIsUnavailableAndInjectsNothing()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated provider qualification", "1".equals(InstrumentationRegistry.getArguments().getString("browserIsolatedReading")));
  org.junit.Assume.assumeFalse("This WebView provider has isolated-world injection; delayedSameOriginAndReloadReadyCannotAdoptOldDocument runs instead",provider());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView> webRef=new AtomicReference<>();AtomicReference<BrowserReadingWorld> worldRef=new AtomicReference<>();
   java.util.concurrent.CountDownLatch finished=new java.util.concurrent.CountDownLatch(1);
   try {
    BoundedActivityScenario.main(()->{
     android.app.Activity activity=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).iterator().next();
     WebView web=new WebView(activity);webRef.set(web);web.getSettings().setJavaScriptEnabled(true);
     BrowserReadingWorld world=new BrowserReadingWorld(web);worldRef.set(world);
     web.setWebViewClient(new WebViewClient(){
      @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){world.pageStarted(url);}
      @Override public void onPageFinished(WebView v,String url){finished.countDown();}
      @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(("<html><body><article>Current synthetic page "+request.getUrl().getPath()+"</article></body></html>").getBytes(StandardCharsets.UTF_8)));}
     });
     // The same calls the browser makes for a navigation; with no isolated world they prepare nothing.
     world.prepare("https://reading.invalid/first");web.loadUrl("https://reading.invalid/first");
    });
    assertTrue("Synthetic HTTPS document loads",finished.await(15,java.util.concurrent.TimeUnit.SECONDS));
    WebView web=webRef.get();BrowserReadingWorld world=worldRef.get();
    // The document is loaded and scriptable, so what follows is not an unloaded page.
    AtomicReference<String> page=new AtomicReference<>();
    for(int i=0;i<150&&(page.get()==null||!page.get().contains("Current synthetic page /first"));i++){
     AtomicReference<String> seen=new AtomicReference<>();BoundedActivityScenario.main(()->web.evaluateJavascript("JSON.stringify({text:document.body?document.body.innerText:'',readChannel:typeof __alphaBrowserReadWorld,capacitor:typeof Capacitor,bridge:typeof androidBridge})",seen::set));
     for(int j=0;j<50&&seen.get()==null;j++)SystemClock.sleep(100);page.set(seen.get());if(page.get()==null||!page.get().contains("Current synthetic page /first"))SystemClock.sleep(100);
    }
    assertNotNull("Synthetic document answers script",page.get());
    org.json.JSONObject worldOfPage=new org.json.JSONObject((String)new org.json.JSONTokener(page.get()).nextValue());
    assertTrue(worldOfPage.getString("text").contains("Current synthetic page /first"));
    // Never a main-world fallback: the page's own script sees no reading channel and no app bridge.
    assertEquals("No reading channel in the page's world","undefined",worldOfPage.getString("readChannel"));
    assertEquals("No Capacitor in the page's world","undefined",worldOfPage.getString("capacitor"));
    assertEquals("No app bridge in the page's world","undefined",worldOfPage.getString("bridge"));
    AtomicReference<String> extracted=new AtomicReference<>();RecordedCall call=new RecordedCall();AtomicReference<Throwable> error=new AtomicReference<>();
    BoundedActivityScenario.main(()->{try{
     assertFalse("No isolated world exists on this provider",world.available());
     assertFalse("A loaded document never becomes ready for reading",world.ready());
     world.evaluate(BrowserPageReading.EXTRACT,value->extracted.set("RESULT:"+value),()->extracted.set("REFUSED"));
     assertEquals("Extraction is refused at once, without running any script","REFUSED",extracted.get());
     // The native review of this loaded, non-sensitive HTTPS document: refused as unavailable, nothing shown.
     // The shared reviewed reading (plugin-native-browser-surface); reviewQuestion is package-private there.
     BrowserReviewedReading reading=new BrowserReviewedReading(web.getContext() instanceof android.app.Activity?(android.app.Activity)web.getContext():null,id->{},BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
     java.lang.reflect.Method review=BrowserReviewedReading.class.getDeclaredMethod("reviewQuestion",com.getcapacitor.PluginCall.class,WebView.class,BrowserReadingWorld.class,java.util.function.BooleanSupplier.class);review.setAccessible(true);
     review.invoke(reading,call,web,world,(java.util.function.BooleanSupplier)()->true);
     java.lang.reflect.Field dialog=BrowserReviewedReading.class.getDeclaredField("dialog");dialog.setAccessible(true);assertNull("No review dialog is shown",dialog.get(reading));
    }catch(Throwable failure){error.set(failure);}});
    if(error.get()!=null)throw new AssertionError(error.get());
    assertFalse("The review never resolves",call.resolved.get());
    assertEquals("The refusal names the missing capability, not the page",BrowserPageReading.UNSUPPORTED_MESSAGE,call.message.get());
    assertEquals(BrowserPageReading.READING_UNSUPPORTED,call.code.get());
    assertTrue("The refusal tells the owner what to do",call.message.get().contains("unavailable on this device")&&call.message.get().contains("Update Android System WebView"));
   }finally{BoundedActivityScenario.main(()->{if(worldRef.get()!=null)worldRef.get().close();if(webRef.get()!=null)webRef.get().destroy();});}
   // The product's surface: the plugin answers the capability question, and the browser says so.
   until("document.documentElement.dataset.activeView");
   host("window.__readingSupport=null;Capacitor.Plugins.AlphaBrowser.readingSupport().then(v=>window.__readingSupport=JSON.stringify(v),()=>window.__readingSupport='error')");
   until("window.__readingSupport!==null");
   assertEquals("{\"available\":false}",(String)new org.json.JSONTokener(host("window.__readingSupport")).nextValue());host("delete window.__readingSupport");
   host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
   String note="document.querySelector('[data-alpha-browser-menu] [data-alpha-reading-unavailable]')",said="document.querySelector('[data-alpha-toast]').innerText.includes("+org.json.JSONObject.quote(BrowserPageReading.UNSUPPORTED_MESSAGE)+")";
   click("Menu");until(note+"&&"+note+".getClientRects().length>0");
   assertEquals("The menu states that page reading is unavailable, in the same words as the native refusal",org.json.JSONObject.quote(BrowserPageReading.UNSUPPORTED_MESSAGE),host(note+".innerText.trim()"));
   assertEquals("note",(String)new org.json.JSONTokener(host(note+".getAttribute('role')")).nextValue());
   assertEquals("Nothing has been announced before an action is chosen","false",host(said));
   click("Read aloud");until("!document.querySelector('[data-alpha-browser-menu]')");until(said);
   // The toast leaves by itself; wait for that so the second action's announcement is its own.
   for(int i=0;i<150&&"true".equals(host(said));i++)SystemClock.sleep(100);assertEquals("The first announcement has left","false",host(said));
   click("Menu");click("Ask about page");until("!document.querySelector('[data-alpha-browser-menu]')");until(said);
  }
 }
 @Test public void delayedSameOriginAndReloadReadyCannotAdoptOldDocument()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated provider qualification", "1".equals(InstrumentationRegistry.getArguments().getString("browserIsolatedReading")));
  // Exactly one method of this class runs on any provider, and the run records which.
  org.junit.Assume.assumeTrue("This WebView provider has no isolated-world injection; providerWithoutIsolatedWorldSaysReadingIsUnavailableAndInjectsNothing runs instead",provider());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AtomicReference<WebView> webRef=new AtomicReference<>();AtomicReference<BrowserReadingWorld> worldRef=new AtomicReference<>();
   try {
    BoundedActivityScenario.main(()->{
     android.app.Activity activity=androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED).iterator().next();
     WebView web=new WebView(activity);webRef.set(web);web.getSettings().setJavaScriptEnabled(true);
     BrowserReadingWorld world=new BrowserReadingWorld(web);worldRef.set(world);
     web.setWebViewClient(new WebViewClient(){
      @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){world.pageStarted(url);}
      @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(("<html><body><article>Current synthetic page "+request.getUrl().getPath()+"</article></body></html>").getBytes(StandardCharsets.UTF_8)));}
     });
     world.prepare("https://reading.invalid/first");web.loadUrl("https://reading.invalid/first");
    });
    WebView web=webRef.get();BrowserReadingWorld world=worldRef.get();ready(world);
    for(String next:new String[]{"https://reading.invalid/second","https://reading.invalid/second"}){
     AtomicReference<Throwable> error=new AtomicReference<>();
     BoundedActivityScenario.main(()->{try{
      String oldNonce=(String)field(world,"nonce");JavaScriptReplyProxy oldProxy=(JavaScriptReplyProxy)field(world,"proxy");
      WebViewCompat.WebMessageListener listener=(WebViewCompat.WebMessageListener)field(world,"listener");
      // Replay a genuinely issued old-document message at the vulnerable boundary.
      world.prepare(next);world.pageStarted(next);
      listener.onPostMessage(web,new WebMessageCompat(oldNonce),Uri.parse("https://reading.invalid"),true,oldProxy);
      assertFalse("Old document must not bind after invalidation",world.ready());
      // Start a genuine new document, including an exact-URL reload on iteration two.
      world.prepare(next);if(next.equals(web.getUrl()))web.reload();else web.loadUrl(next);
     }catch(Throwable failure){error.set(failure);}});
     if(error.get()!=null)throw new AssertionError(error.get());ready(world);
     AtomicReference<String> extracted=new AtomicReference<>();
     BoundedActivityScenario.main(()->world.evaluate("document.body.innerText",extracted::set,()->extracted.set("FAILED")));
     for(int i=0;i<150&&extracted.get()==null;i++)SystemClock.sleep(100);
     assertNotNull(extracted.get());assertTrue(extracted.get(),extracted.get().contains("Current synthetic page /second"));
    }
    // Unprepared page-initiated navigation is deliberately unavailable, never origin adopted.
    BoundedActivityScenario.main(()->{world.pageStarted("https://reading.invalid/other");assertFalse(world.ready());});
   }finally{BoundedActivityScenario.main(()->{if(worldRef.get()!=null)worldRef.get().close();if(webRef.get()!=null)webRef.get().destroy();});}
  }
 }
}
