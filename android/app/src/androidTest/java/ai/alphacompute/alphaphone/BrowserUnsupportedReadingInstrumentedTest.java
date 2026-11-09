package ai.alphacompute.alphaphone;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;

/** Synthetic article in a real HTTPS child on a provider without isolated-world injection: the
 * review refuses without touching the page and nothing is sent. */
public final class BrowserUnsupportedReadingInstrumentedTest {
 private final BrowserReadingFixture reading=new BrowserReadingFixture();
 @Test public void unsupportedProviderRejectsWithoutExtractionOrOutboundSpeech()throws Exception{
  org.junit.Assume.assumeTrue("Explicit browser reading synthetic HTTP fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserUnsupportedReading")));
  assertTrue("Run against a test-mocks app build: only that build admits this fixture's loopback HTTP route (any other build refuses it, correctly)",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  assertFalse("Run this negative flow on a provider without isolated-world injection",androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD));
  try(BrowserReadingFixture.Server server=new BrowserReadingFixture.Server();BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   String origin=server.origin(),slot="remote:"+origin;long expiry=System.currentTimeMillis()+600000;
   String binding=BrowserReadingFixture.binding(origin,expiry);
   boolean installed=false;Throwable primary=null;
   try{
    reading.openExample();
    reading.installBody(BrowserReadingFixture.MARKUP);installed=true;
    reading.writeSpeechToken(slot,origin,expiry);
    reading.captureArgs();
    assertEquals("true",reading.child.child("window.__extractionAttempted=false;window.__previousQuery=document.querySelector;document.querySelector=function(){window.__extractionAttempted=true;return window.__previousQuery.apply(this,arguments);};true"));
    assertTrue(reading.call(BrowserReadingFixture.review(binding)).has("error"));assertEquals(0,server.bodies.size());
    assertEquals("false",reading.child.child("window.__extractionAttempted"));
    assertTrue(reading.call("Capacitor.Plugins.AlphaVoiceCloud.synthesizeBrowserReading({"+binding+",readingToken:'not-issued',requestId:'unsupported-fixture'})").has("error"));assertEquals(0,server.bodies.size());
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    reading.cleanup(primary,slot,installed,()->reading.child.child("if(window.__previousQuery){document.querySelector=window.__previousQuery;delete window.__previousQuery;}delete window.__extractionAttempted;true"));
   }
  }
 }
}
