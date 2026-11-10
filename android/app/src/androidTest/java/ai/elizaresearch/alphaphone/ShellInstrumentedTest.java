package ai.elizaresearch.alphaphone;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ShellInstrumentedTest {
 private String evaluate(BoundedActivityScenario<MainActivity> scenario, String js) throws Exception {
  return WebViewTestDriver.evaluate(js);
 }
 @Test public void bundledRendererAndNativeBridgesWork() throws Exception {
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   String ready = "false";
   for(int i=0; i<100; i++) {
    ready=evaluate(scenario,"Boolean(document.querySelector('[data-screen]') && window.Capacitor && document.documentElement.dataset.activeView)");
    if (ready.equals("true")) break;
    SystemClock.sleep(100);
   }
   assertEquals("Bundled renderer must mount offline", "true",ready);
   evaluate(scenario,"Promise.all([Capacitor.Plugins.ElizaSystem.listLauncherApps(),Capacitor.Plugins.ElizaSystem.getStatus(),Capacitor.Plugins.ElizaSystem.getBuildInfo()]).then(v=>document.body.dataset.nativeResult=JSON.stringify(v)).catch(e=>document.body.dataset.nativeError=String(e))");
   String result="null";
   for(int i=0;i<100;i++) { result=evaluate(scenario,"document.body.dataset.nativeResult || null"); if(!result.equals("null"))break;SystemClock.sleep(100); }
   assertNotEquals("Native bridge failed: "+evaluate(scenario,"document.body.dataset.nativeError || null"),"null",result);
   String payload=(String)new org.json.JSONTokener(result).nextValue();
   org.json.JSONArray values = new org.json.JSONArray(payload);
   assertTrue("Installed apps are discoverable", values.getJSONObject(0).getJSONArray("apps").length()>0);
   assertEquals("ai.elizaresearch.alphaphone",values.getJSONObject(1).getString("packageName"));
   assertEquals(BuildConfig.IS_LAUNCHER,values.getJSONObject(2).getBoolean("launcher"));
   assertFalse("Setup must not claim a connected agent",evaluate(scenario,"document.body.innerText").contains("Agent connected"));
   Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).setPackage("ai.elizaresearch.alphaphone");
   boolean qualifies = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageManager().queryIntentActivities(home,0).size()>0;
   assertEquals("HOME qualification follows variant",BuildConfig.IS_LAUNCHER,qualifies);
  }
 }
 @Test public void signedInComposerAndNativeAppHandoffWork() throws Exception {
  AppNavigation.assumeNoRequiredSignIn("Shell composer and native app handoff");
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode();
   evaluate(scenario,AppNavigation.request("Home"));
   String homeReady="document.documentElement.dataset.activeView==='home'&&!document.querySelector('.alpha-connection-scrim')&&!document.querySelector('.os')?.inert";
   for(int i=0;i<200;i++){if("true".equals(evaluate(scenario,homeReady)))break;SystemClock.sleep(100);}
   assertEquals("Home must be interactive before opening the composer","true",evaluate(scenario,homeReady));
   evaluate(scenario,AppNavigation.type());
   String composer = AppNavigation.composer();
   for (int i=0;i<50;i++) { if ("true".equals(evaluate(scenario,"!!("+composer+")"))) break; SystemClock.sleep(100); }
   assertEquals("Actual Type control opens the agent composer", "true", evaluate(scenario,"!!("+composer+")"));
   evaluate(scenario,"(()=>{const e=("+composer+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Keyboard layout check');e.dispatchEvent(new Event('input',{bubbles:true}));e.focus();})()");
   SystemClock.sleep(200);
   WebViewTestDriver.withActivity(MainActivity.class, activity -> {
    android.view.inputmethod.InputMethodManager ime = (android.view.inputmethod.InputMethodManager) activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE);
    ime.showSoftInput(activity.getBridge().getWebView(), android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
   });
   java.util.concurrent.atomic.AtomicBoolean keyboard = new java.util.concurrent.atomic.AtomicBoolean(false);
   for(int i=0;i<50;i++) {
    WebViewTestDriver.withActivity(MainActivity.class, activity -> {
     androidx.core.view.WindowInsetsCompat insets = androidx.core.view.ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
     keyboard.set(insets != null && insets.isVisible(androidx.core.view.WindowInsetsCompat.Type.ime()));
    });
    if(keyboard.get())break;
    SystemClock.sleep(100);
   }
   assertTrue("Test keyboard must actually be visible",keyboard.get());
   SystemClock.sleep(500);
   String layout = evaluate(scenario,"JSON.stringify({height:innerHeight,viewport:visualViewport?.height,fields:[...document.querySelectorAll('textarea[data-alpha-composer]')].map(e=>({value:e.value,rect:e.getBoundingClientRect().toJSON(),hidden:!!e.closest('[inert], [aria-hidden=\"true\"]'),send:e.parentElement.querySelector('button[aria-label=Send]')?.getBoundingClientRect().toJSON()}))})");
   assertEquals("Composer remains above the real Android keyboard: "+layout, "true", evaluate(scenario,"(() => { const input=("+composer+"); const button=input?.parentElement.querySelector('button[aria-label=Send]'); if(!input||!button)return false; const field=input.getBoundingClientRect(); const send=button.getBoundingClientRect(); return field.top >= 0 && field.bottom <= innerHeight && field.width > 100 && send.top >= 0 && send.bottom <= innerHeight; })()"));
   evaluate(scenario,"Capacitor.Plugins.ElizaSystem.launchApp({packageName:'com.android.settings'})");
   boolean settingsOpened = false;
   String lastActivityState = "";
   for (int i=0; i<30; i++) {
    android.os.ParcelFileDescriptor pipe = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys activity activities");
    String activity;
    try (java.io.InputStream input = new android.os.ParcelFileDescriptor.AutoCloseInputStream(pipe)) {
     activity = new java.io.BufferedReader(new java.io.InputStreamReader(input, java.nio.charset.StandardCharsets.UTF_8)).lines().collect(java.util.stream.Collectors.joining("\n"));
    }
    lastActivityState = activity;
    // Launching Settings restores its existing task. A legitimate Settings child
    // (e.g. default-app picker) belongs to PermissionController, not Settings.
    // Require an actually resumed activity in the visible Settings task rather
    // than accepting a background task or assuming the child's package.
    boolean visibleSettingsTask = false;
    for (String line : activity.split("\\n")) {
     if (line.stripLeading().startsWith("* Task{"))
      visibleSettingsTask = line.contains("com.android.settings") && line.contains("visible=true");
     if (visibleSettingsTask && line.contains("topResumedActivity=ActivityRecord{")) {
      settingsOpened = true;
      break;
     }
    }
    if (!settingsOpened) settingsOpened = activity.lines().anyMatch(line -> (line.contains("mResumedActivity") || line.contains("topResumedActivity")) && line.contains("com.android.settings"));
    if(settingsOpened)break;
    SystemClock.sleep(100);
   }
   assertTrue("Native installed-app handoff must resume the Settings task: " + lastActivityState,settingsOpened);
  }
 }
}
