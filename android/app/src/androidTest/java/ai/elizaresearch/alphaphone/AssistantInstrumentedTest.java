package ai.elizaresearch.alphaphone;

import android.app.role.RoleManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.SystemClock;
import androidx.lifecycle.Lifecycle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual Android assist activity and task boundary; does not silently change the user's role. */
@RunWith(AndroidJUnit4.class)
public class AssistantInstrumentedTest {
 /** Agent.launchSurface() as the renderer sees it: "true", "false" or "error". */
 private static String launchSurfaceAssistant(Class<? extends MainActivity> type) throws Exception {
  for (int i = 0; i < 100 && !"true".equals(WebViewTestDriver.evaluate(type, "Boolean(window.Capacitor?.Plugins?.Agent)")); i++) SystemClock.sleep(100);
  WebViewTestDriver.evaluate(type, "window.__launchSurface=null;Capacitor.Plugins.Agent.launchSurface().then(v=>window.__launchSurface=String(v.assistant===true),()=>window.__launchSurface='error')");
  for (int i = 0; i < 200; i++) {
   String raw = WebViewTestDriver.evaluate(type, "window.__launchSurface");
   if (raw != null && !"null".equals(raw)) return raw.replace("\"", "");
   SystemClock.sleep(50);
  }
  throw new AssertionError("launchSurface did not complete");
 }
 @Test public void assistantCandidateIsExportedAndHasSeparateTask() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  PackageManager packages = context.getPackageManager();
  Intent assist = new Intent(Intent.ACTION_ASSIST).setPackage(context.getPackageName());
  android.content.pm.ResolveInfo resolved = packages.resolveActivity(assist, PackageManager.MATCH_DEFAULT_ONLY);
  assertNotNull("ACTION_ASSIST resolves for user role selection", resolved);
  assertEquals(AlphaAssistActivity.class.getName(), resolved.activityInfo.name);
  assertTrue(resolved.activityInfo.exported);
  assertEquals(context.getPackageName() + ".assistant", resolved.activityInfo.taskAffinity);
  assertNotEquals(packages.getActivityInfo(new ComponentName(context, MainActivity.class), 0).taskAffinity, resolved.activityInfo.taskAffinity);
  assertTrue("Phone system offers the opt-in assistant role", context.getSystemService(RoleManager.class).isRoleAvailable(RoleManager.ROLE_ASSISTANT));
 }
 @Test public void explicitAssistDropsCallerContextAndCanFinish() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  Intent intent = new Intent(context, AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST)
   .setData(Uri.parse("https://example.com/private-context"))
   .putExtra(Intent.EXTRA_TEXT, "Never automatically forward caller content")
   .putExtra("query", "Never automatically execute caller instructions");
  try (BoundedActivityScenario<AlphaAssistActivity> scenario = BoundedActivityScenario.launch(intent)) {
   assertEquals("The renderer learns it is the assistant surface", "true", launchSurfaceAssistant(AlphaAssistActivity.class));
   WebViewTestDriver.withActivity(AlphaAssistActivity.class, activity -> {
    // Only Alpha's own launch flag survives; caller text, query and data are dropped.
    android.os.Bundle extras = activity.getIntent().getExtras();
    assertNotNull(extras);
    assertEquals(java.util.Set.of(AlphaAssistActivity.EXTRA_ASSISTANT), extras.keySet());
    assertTrue(extras.getBoolean(AlphaAssistActivity.EXTRA_ASSISTANT));
    assertNull(activity.getIntent().getData());
    assertTrue(activity.isAssistantSurface());
    assertNotNull(activity.getBridge());
    activity.finish();
   });
   for (int i = 0; i < 50 && scenario.getState() != Lifecycle.State.DESTROYED; i++) SystemClock.sleep(100);
   assertEquals("Assistant closes normally in both distribution variants", Lifecycle.State.DESTROYED, scenario.getState());
  }
 }
 /** Closing the assistant surface must not interrupt work owned by the main surface or clear the
  * shared owner enrollment. The in-flight stream here is a synthetic handle registered on the
  * MainActivity plugin instance; it proves ownership, not a live runtime stream. */
 @Test public void finishingAssistantKeepsMainStreamAndEnrollment() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  java.util.concurrent.atomic.AtomicBoolean mainInvalidated = new java.util.concurrent.atomic.AtomicBoolean(), assistInvalidated = new java.util.concurrent.atomic.AtomicBoolean();
  java.util.concurrent.atomic.AtomicReference<AlphaLocalAgentPlugin> mainPlugin = new java.util.concurrent.atomic.AtomicReference<>();
  try (BoundedActivityScenario<MainActivity> main = BoundedActivityScenario.launch(MainActivity.class)) {
   assertEquals("The main surface is not the assistant", "false", launchSurfaceAssistant(MainActivity.class));
   WebViewTestDriver.withActivity(MainActivity.class, activity -> {
    AlphaLocalAgentPlugin plugin = (AlphaLocalAgentPlugin) activity.getBridge().getPlugin("Agent").getInstance();
    mainPlugin.set(plugin);
    AlphaLocalAgentPlugin.enrollForTest("synthetic-root", "synthetic-owner-token", "synthetic-owner", System.currentTimeMillis() + 600_000);
    plugin.adoptStreamForTest("main-stream-000001", new ElizaAgentService.LocalStreamHandle(), () -> mainInvalidated.set(true));
   });
   assertEquals(1, mainPlugin.get().ownedWorkCount());
   Intent assist = new Intent(context, AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST);
   try (BoundedActivityScenario<AlphaAssistActivity> scenario = BoundedActivityScenario.launch(assist)) {
    assertEquals("The active assistant selects its own WebView", "true", launchSurfaceAssistant(AlphaAssistActivity.class));
    assertEquals("The driver still selects the exact main WebView", "false", launchSurfaceAssistant(MainActivity.class));
    WebViewTestDriver.withActivity(AlphaAssistActivity.class, activity -> {
     AlphaLocalAgentPlugin plugin = (AlphaLocalAgentPlugin) activity.getBridge().getPlugin("Agent").getInstance();
     assertNotSame("Each surface has its own plugin instance", mainPlugin.get(), plugin);
     plugin.adoptStreamForTest("assist-stream-0001", new ElizaAgentService.LocalStreamHandle(), () -> assistInvalidated.set(true));
     activity.finish();
    });
    for (int i = 0; i < 50 && scenario.getState() != Lifecycle.State.DESTROYED; i++) SystemClock.sleep(100);
    assertEquals(Lifecycle.State.DESTROYED, scenario.getState());
   }
   assertTrue("The assistant's own stream is cancelled with its surface", assistInvalidated.get());
   assertFalse("The main surface stream continues", mainInvalidated.get());
   assertEquals("The main surface still owns its stream", 1, mainPlugin.get().ownedWorkCount());
   assertTrue("Closing the assistant keeps the shared enrollment", AlphaLocalAgentPlugin.enrollmentPresent());
  } finally {
   AlphaLocalAgentPlugin.enrollForTest(null, null, null, 0);
  }
 }

 /** Evaluate in the assistant surface's own WebView (WebViewTestDriver.evaluate reads MainActivity only). */
 private static String evalAssist(String script) throws Exception {
  java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.atomic.AtomicReference<String> answer = new java.util.concurrent.atomic.AtomicReference<>();
  WebViewTestDriver.withActivity(AlphaAssistActivity.class, activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { answer.set(value); done.countDown(); }));
  assertTrue("Assistant WebView answered: " + script, done.await(8, java.util.concurrent.TimeUnit.SECONDS));
  return answer.get();
 }
 private static void untilAssist(String condition, String message) throws Exception {
  for (int i = 0; i < 200; i++) { if ("true".equals(evalAssist("!!(" + condition + ")"))) return; SystemClock.sleep(100); }
  fail(message);
 }
 private static boolean assistIme() throws Exception {
  java.util.concurrent.atomic.AtomicBoolean shown = new java.util.concurrent.atomic.AtomicBoolean();
  WebViewTestDriver.withActivity(AlphaAssistActivity.class, activity -> {
   androidx.core.view.WindowInsetsCompat insets = androidx.core.view.ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
   shown.set(insets != null && insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()));
  });
  return shown.get();
 }
 private static final String ASSIST_DRAFT = "Assistant keyboard draft 2291";
 private static String fits() {
  return "(()=>{const e=(" + AppNavigation.composer() + ");if(!e)return false;const r=e.getBoundingClientRect();const s=e.parentElement.querySelector('button[aria-label=Send]');if(!s)return false;const b=s.getBoundingClientRect();"
   + "return r.top>=0&&r.bottom<=innerHeight+0.5&&r.width>100&&b.top>=0&&b.bottom<=innerHeight+0.5&&b.width>0;})()";
 }

 /** ACTION_ASSIST with the real soft keyboard: the full-mode composer and Send stay inside
  * innerHeight once the ime() inset is visible; Back first dismisses the keyboard (the surface
  * stays, the draft is kept), and only the Back at the assistant's root finishes the activity. The
  * next ACTION_ASSIST reads the same persisted draft. Emulator evidence only. */
 @Test public void assistantComposerFitsAboveTheKeyboardAndBackFinishesOnlyAtRoot() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  Intent assist = new Intent(context, AlphaAssistActivity.class).setAction(Intent.ACTION_ASSIST);
  try (BoundedActivityScenario<AlphaAssistActivity> scenario = BoundedActivityScenario.launch(assist)) {
   untilAssist("document.documentElement.dataset.activeView!==undefined&&" + AppNavigation.composer(), "The assistant surface shows a composer");
   // Full mode: the assistant surface's chat at its largest size.
   if ("true".equals(evalAssist("[...document.querySelectorAll('[data-alpha-layer=\"conversation\"] button')].some(b=>b.getAttribute('aria-label')==='Expand chat'&&b.getClientRects().length)")))
    evalAssist("[...document.querySelectorAll('[data-alpha-layer=\"conversation\"] button')].find(b=>b.getAttribute('aria-label')==='Expand chat').click()");
   untilAssist("![...document.querySelectorAll('[data-alpha-layer=\"conversation\"] button')].some(b=>b.getAttribute('aria-label')==='Expand chat'&&b.getClientRects().length)", "The assistant chat is in full mode");
   evalAssist("(()=>{const e=(" + AppNavigation.composer() + ");e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e," + org.json.JSONObject.quote(ASSIST_DRAFT) + ");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   SystemClock.sleep(200);
   WebViewTestDriver.withActivity(AlphaAssistActivity.class, activity -> {
    android.view.inputmethod.InputMethodManager ime = (android.view.inputmethod.InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
    ime.showSoftInput(activity.getBridge().getWebView(), android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
   });
   boolean keyboard = false;
   for (int i = 0; i < 60 && !keyboard; i++) { keyboard = assistIme(); if (!keyboard) SystemClock.sleep(100); }
   assertTrue("The WindowInsetsCompat ime() inset must be visible", keyboard);
   untilAssist(fits(), "Composer and Send fit within innerHeight above the keyboard: " + evalAssist("JSON.stringify({innerHeight,viewport:visualViewport?.height})"));
   WebViewTestDriver.pressBack();
   boolean dismissed = false;
   for (int i = 0; i < 60 && !dismissed; i++) { dismissed = !assistIme(); if (!dismissed) SystemClock.sleep(100); }
   assertTrue("The first Back dismisses the keyboard", dismissed);
   assertEquals("The assistant is not finished while the keyboard is dismissed", Lifecycle.State.RESUMED, scenario.getState());
   untilAssist("(" + AppNavigation.composer() + ")?.value===" + org.json.JSONObject.quote(ASSIST_DRAFT), "The draft is kept after the keyboard closes");
   WebViewTestDriver.pressBack();
   for (int i = 0; i < 50 && scenario.getState() != Lifecycle.State.DESTROYED; i++) SystemClock.sleep(100);
   assertEquals("Back at the assistant's root finishes it", Lifecycle.State.DESTROYED, scenario.getState());
  }
  try (BoundedActivityScenario<AlphaAssistActivity> again = BoundedActivityScenario.launch(assist)) {
   untilAssist("(" + AppNavigation.composer() + ")?.value===" + org.json.JSONObject.quote(ASSIST_DRAFT), "The next ACTION_ASSIST reads the persisted draft");
   WebViewTestDriver.withActivity(AlphaAssistActivity.class, android.app.Activity::finish);
   for (int i = 0; i < 50 && again.getState() != Lifecycle.State.DESTROYED; i++) SystemClock.sleep(100);
  }
 }
}
