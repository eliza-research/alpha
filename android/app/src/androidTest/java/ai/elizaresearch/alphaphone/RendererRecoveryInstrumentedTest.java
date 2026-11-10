package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.WebViewRenderProcess;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** A lost WebView renderer (MainActivity's onRenderProcessGone listener): the dead host WebView is
 * detached, the activity is recreated, and the page comes back in exactly one resumed MainActivity
 * with a new renderer. Runs on both variants; LauncherHomeInstrumentedTest repeats the kill while
 * Alpha holds HOME and returns through the HOME key.
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --classes RendererRecovery
 * The renderer is ended through androidx WebViewRenderProcess.terminate() where the provider
 * supports it, otherwise by loading chrome://crash into the host WebView of a debuggable build
 * (a Chromium debug URL; release builds are never driven this way). Emulator evidence only. */
@RunWith(AndroidJUnit4.class)
public class RendererRecoveryInstrumentedTest {
 private static final String MARKER = "__alphaRendererRecoveryMarker";

 /** The one live MainActivity, or null while it is being recreated. */
 private static MainActivity live() throws Exception {
  AtomicReference<MainActivity> found = new AtomicReference<>();
  BoundedActivityScenario.main(() -> {
   for (Stage stage : new Stage[]{Stage.RESUMED, Stage.STARTED, Stage.PAUSED})
    for (Activity activity : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))
     if (found.get() == null && activity.getClass() == MainActivity.class && !activity.isFinishing() && !activity.isDestroyed()) found.set((MainActivity) activity);
  });
  return found.get();
 }

 /** Live MainActivity instances outside DESTROYED, by stage name. */
 static List<String> mainActivityStages() throws Exception {
  List<String> seen = new ArrayList<>();
  BoundedActivityScenario.main(() -> {
   for (Stage stage : Stage.values()) {
    if (stage == Stage.DESTROYED) continue;
    for (Activity activity : ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))
     if (activity.getClass() == MainActivity.class && !activity.isDestroyed()) seen.add(stage.name());
   }
  });
  return seen;
 }

 /** Mark the current document, then end the host WebView's renderer. Returns the WebView that died. */
 static WebView killHostRenderer() throws Exception {
  assertEquals("Marker set in the live renderer", "1", WebViewTestDriver.evaluate("window." + MARKER + "=1"));
  AtomicReference<WebView> victim = new AtomicReference<>();
  AtomicBoolean terminated = new AtomicBoolean();
  WebViewTestDriver.withActivity(MainActivity.class, main -> {
   WebView web = main.getBridge().getWebView();
   victim.set(web);
   if (WebViewFeature.isFeatureSupported(WebViewFeature.GET_WEB_VIEW_RENDERER) && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_VIEW_RENDERER_TERMINATE)) {
    WebViewRenderProcess renderer = WebViewCompat.getWebViewRenderProcess(web);
    if (renderer != null) terminated.set(renderer.terminate());
   }
   if (!terminated.get()) {
    assertTrue("chrome://crash is only driven in a debuggable build", BuildConfig.DEBUG);
    web.loadUrl("chrome://crash");
   }
  });
  return victim.get();
 }

 /** After a kill: one resumed MainActivity, a new bridge WebView, and the app page with a fresh renderer. */
 static void awaitRecovered(WebView dead, String when) throws Exception {
  String last = "no live activity";
  for (int attempt = 0; attempt < 300; attempt++) {
   SystemClock.sleep(100);
   MainActivity main = live();
   if (main == null) { last = "no live activity"; continue; }
   AtomicReference<WebView> current = new AtomicReference<>();
   BoundedActivityScenario.main(() -> { if (main.getBridge() != null) current.set(main.getBridge().getWebView()); });
   if (current.get() == null || current.get() == dead) { last = "bridge still holds the dead WebView"; continue; }
   String state;
   try { state = WebViewTestDriver.evaluate("JSON.stringify({view:document.documentElement.dataset.activeView||null,marker:typeof window." + MARKER + "})"); }
   catch (AssertionError notYet) { last = "page not answering yet"; continue; }
   // evaluateJavascript answers JSON null, not the stringified object, while the new WebView has no
   // document to run in yet (measured on the API 36 emulator right after recreate()). Not ready yet.
   Object answer = new org.json.JSONTokener(state).nextValue();
   if (!(answer instanceof String)) { last = "new WebView has no document yet (answered " + state + ")"; continue; }
   org.json.JSONObject page = new org.json.JSONObject((String) answer);
   if (page.isNull("view")) { last = "page has no active view yet"; continue; }
   assertEquals("The recovered page runs in a new renderer, not the killed one", "undefined", page.getString("marker"));
   List<String> stages = mainActivityStages();
   if (stages.size() == 1 && "RESUMED".equals(stages.get(0))) return;
   last = "MainActivity instances " + stages;
  }
  fail("The page did not come back in one resumed MainActivity " + when + ": " + last);
 }

 @Test public void killedRendererRecreatesOneMainActivityWithThePage() throws Exception {
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   try {
    AppNavigation.liveMode();
    for (int i = 0; i < 150 && !"true".equals(WebViewTestDriver.evaluate("!!document.documentElement.dataset.activeView")); i++) SystemClock.sleep(100);
    MainActivity before = live();
    assertNotNull("MainActivity is live before the kill", before);
    WebView dead = killHostRenderer();
    awaitRecovered(dead, "after the renderer was killed");
    assertNotSame("The activity was recreated with a new bridge", before, live());
    // A second loss inside the budget window also recovers immediately (3 per 60 s, then a 5 s backoff).
    WebView second = killHostRenderer();
    awaitRecovered(second, "after a second renderer loss");
   } finally { finishRecreated(); }
  }
 }

 /** The scenario tracks the launched instance only; the product's own recreate() made a new one. */
 static void finishRecreated() throws Exception {
  MainActivity left = live();
  if (left != null) BoundedActivityScenario.main(left::finish);
  for (int i = 0; i < 150 && !mainActivityStages().isEmpty(); i++) SystemClock.sleep(100);
 }
}
