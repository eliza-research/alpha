package ai.alphacompute.alphaphone;

import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Synthetic article in a real isolated HTTPS child; actual private HTTP and MediaPlayer. The page
 * world tampers with the built-ins the reading extraction would use; the review must not be fooled. */
public final class BrowserIsolatedReadingInstrumentedTest {
 private final BrowserReadingFixture reading=new BrowserReadingFixture();
 @Test public void pageWorldTamperingCannotForgeSafeReading()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading synthetic HTTP fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserIsolatedReading")));
  assertTrue("Run against a test-mocks app build: only that build admits this fixture's loopback HTTP route (any other build refuses it, correctly)",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  assertTrue("A provider with isolated-world injection is required for this positive flow",androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD));
  try(BrowserReadingFixture.Server server=new BrowserReadingFixture.Server();BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   String origin=server.origin(),slot="remote:"+origin,poisonKey=reading.key+"Poison";long expiry=System.currentTimeMillis()+600000;
   String binding=BrowserReadingFixture.binding(origin,expiry);
   boolean installed=false;Throwable primary=null;
   try{
    reading.openExample();
    reading.installBody(BrowserReadingFixture.MARKUP);installed=true;
    reading.writeSpeechToken(slot,origin,expiry);
    reading.captureArgs();
    // The isolated reading world is invisible to the page and to frames it creates.
    assertEquals("true",reading.child.child("typeof __elizaBrowserReadWorld==='undefined'"));
    assertEquals("true",reading.child.child("(()=>{const frame=document.createElement('iframe');document.body.append(frame);const hidden=typeof frame.contentWindow.__elizaBrowserReadWorld==='undefined';frame.remove();return hidden;})()"));
    // Page-world built-ins that would make every page look harmless if the review used them.
    assertEquals("true",reading.child.child("(()=>{window["+JSONObject.quote(poisonKey)+"]={test:RegExp.prototype.test,normalize:String.prototype.normalize,query:Document.prototype.querySelector,style:window.getComputedStyle,json:JSON.stringify};RegExp.prototype.test=()=>false;String.prototype.normalize=()=> 'Garden journal';Document.prototype.querySelector=function(){return this.body;};window.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible',clip:'auto',clipPath:'none'});JSON.stringify=()=>'{\"text\":\"Forged harmless page\"}';return true;})()"));
    reading.sensitivePagesRefused(server,binding);
    assertEquals("true",reading.child.child("document.body.innerHTML="+JSONObject.quote(BrowserReadingFixture.MARKUP)+";true"));
    reading.cancelThenApproveOnce(server,binding);
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    reading.cleanup(primary,slot,installed,()->assertEquals("true",reading.child.child("(()=>{const saved=window["+JSONObject.quote(poisonKey)+"];if(saved){RegExp.prototype.test=saved.test;String.prototype.normalize=saved.normalize;Document.prototype.querySelector=saved.query;window.getComputedStyle=saved.style;JSON.stringify=saved.json;delete window["+JSONObject.quote(poisonKey)+"];}return true;})()")));
   }
  }
 }
}
