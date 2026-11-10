package ai.elizaresearch.alphaphone;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;

/** Explicit real-renderer acceptance, independent of browser/provider feature gates. */
public final class StartupReadinessInstrumentedTest {
 @Test public void liveRendererSurvivesDocumentReplacement()throws Exception{
  org.junit.Assume.assumeTrue("Explicit startup fixture", "1".equals(InstrumentationRegistry.getArguments().getString("startupReadiness")));
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   assertEquals("true",WebViewTestDriver.evaluate("document.documentElement.dataset.connectionMode==='live'"));
   // Register the listener before requesting a real replacement document.
   try(StartupDocumentProbe probe=new StartupDocumentProbe()){
    probe.expectNavigation();
    WebViewTestDriver.withActivity(MainActivity.class,a->a.getBridge().getWebView().reload());
    assertEquals("live",probe.awaitReady(true));
   }
   assertEquals("true",WebViewTestDriver.evaluate("document.readyState==='complete'&&Boolean(document.documentElement.dataset.activeView)"));
  }
 }
}
