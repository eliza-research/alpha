package ai.elizaresearch.alphaphone;

import android.app.Instrumentation;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.InputDevice;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real Android Settings handoff and the saved theme, through the rendered Settings. */
@RunWith(AndroidJUnit4.class)
public class SettingsFlowInstrumentedTest {
 private String shell(String command)throws Exception{
  try(var fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);var in=new java.io.FileInputStream(fd.getFileDescriptor())){return new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
 }
 private void until(String expression)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}
  fail("Settings condition did not become true: "+expression);
 }
 private void click(String label)throws Exception{
  String selector="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";
  until(selector);WebViewTestDriver.evaluate("("+selector+").click()");
 }
 private void tapBack()throws Exception{
  String value=WebViewTestDriver.evaluate("(()=>{const e=document.querySelector('button[aria-label=\"Back to Settings\"]');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:innerWidth,hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}})()");
  JSONObject point=new JSONObject(value);
  assertTrue("Back button center must receive touch",point.getBoolean("hit"));
  float[] coordinates=new float[2];
  WebViewTestDriver.withActivity(MainActivity.class,activity->{
   android.webkit.WebView web=activity.getBridge().getWebView();int[] location=new int[2];web.getLocationOnScreen(location);
   float scale=(float)(web.getWidth()/point.optDouble("width"));
   coordinates[0]=location[0]+(float)point.optDouble("x")*scale;coordinates[1]=location[1]+(float)point.optDouble("y")*scale;
  });
  long down=SystemClock.uptimeMillis();
  for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){
   MotionEvent event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,coordinates[0],coordinates[1],0);event.setSource(InputDevice.SOURCE_TOUCHSCREEN);
   try{assertTrue("Android accepted Back touch",InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event,true));}finally{event.recycle();}
  }
  until("!document.querySelector('button[aria-label=\"Back to Settings\"]')");
 }
 /** About shows the installed version and no prototype hardware or model claim (docs/ui-refresh-2026-11). */
 private void aboutShowsTheInstalledVersion()throws Exception{
  click("About");
  until("document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(BuildConfig.VERSION_NAME)+")");
  assertEquals("No prototype hardware attestation", "false",WebViewTestDriver.evaluate("document.querySelector('[data-screen]').textContent.includes('4.2 · attested')"));
  assertEquals("No prototype local model", "false",WebViewTestDriver.evaluate("document.querySelector('[data-screen]').textContent.includes('Core 7B')"));
  tapBack();
 }
 /** Settings has no battery, radio or sound pages: the launcher's one "Android settings" row opens
  * Android's own Settings, and Back returns to Alpha's Settings with a fresh native read. */
 @Test public void androidSettingsRowOpensAndroidsOwnSettingsAndReturns()throws Exception{
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
  AtomicReference<String> action=new AtomicReference<>();
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){
   @Override public Instrumentation.ActivityResult onStartActivity(Intent intent){action.set(intent.getAction());return null;}
  };
  // Removing a monitor that was never added throws and would hide the first failure.
  boolean monitored=false;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.documentElement.dataset.activeView");
   WebViewTestDriver.evaluate(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"));AppNavigation.declineStartupAccess();
   until("document.querySelector('button[aria-label=\"About\"]')");
   for(String removed:new String[]{"Wi-Fi","Bluetooth","Mobile data","Battery","Sound & vibration","Display","Models","Privacy & data"})assertEquals("Settings omits "+removed,"false",WebViewTestDriver.evaluate("Boolean(document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(removed))+"+']'))"));
   if(!BuildConfig.IS_LAUNCHER){
    // The standalone app is not the phone's system shell: no Android settings row.
    assertEquals("Standalone Settings has no Android settings row","false",WebViewTestDriver.evaluate("Boolean(document.querySelector('button[aria-label=\"Android settings\"]'))"));
    aboutShowsTheInstalledVersion();return;
   }
   instrumentation.addMonitor(monitor);monitored=true;
   click("Android settings");
   long end=SystemClock.elapsedRealtime()+15000;boolean foreground=false;
   while(SystemClock.elapsedRealtime()<end){foreground=shell("dumpsys activity activities").lines().anyMatch(line->line.contains("topResumedActivity")&&line.contains("com.android.settings"));if(foreground)break;SystemClock.sleep(100);}
   assertTrue("Real Android settings is foreground",foreground);assertEquals(Settings.ACTION_SETTINGS,action.get());
   instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
   until("document.querySelector('button[aria-label=\"Android settings\"]')");
   aboutShowsTheInstalledVersion();
  }finally{if(monitored)instrumentation.removeMonitor(monitor);}
 }

 /** A button by its accessible name: aria-label, else its trimmed text. */
 private void press(String name)throws Exception{
  String q="[...document.querySelectorAll('[data-screen] button')].find(b=>(b.getAttribute('aria-label')||b.textContent.trim())==="+JSONObject.quote(name)+"&&b.getClientRects().length&&!b.disabled&&!b.closest('[inert]'))";
  until(q);WebViewTestDriver.evaluate("("+q+").click()");
 }
 private static final String BG="getComputedStyle(document.querySelector('.os')).getPropertyValue('--bg').trim().toUpperCase()";
 private void chooseDarkTheme()throws Exception{
  AppNavigation.liveMode();
  WebViewTestDriver.evaluate(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"));
  press("Theme: Dark");
  until(BG+"==='#000000'");
 }
 private void assertDark(String when)throws Exception{
  until("document.querySelector('.os')&&"+BG+"==='#000000'");
  assertEquals("Dark --bg "+when,"\"#000000\"",WebViewTestDriver.evaluate(BG));
  assertEquals("The saved appearance is dark "+when,"\"dark\"",WebViewTestDriver.evaluate("localStorage.getItem('alpha.appearance.v1')"));
 }

 /** F18: Settings > Theme: Dark applies at once and is still applied after the activity and its
  * renderer are recreated. The restart runner covers a new process (themeProcessRestartPhase). */
 @Test public void darkThemeChosenInSettingsSurvivesRecreation()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   chooseDarkTheme();
   assertDark("right after choosing it");
   scenario.recreate();
   AppNavigation.liveMode();
   assertDark("after the activity was recreated");
  }finally{
   // The saved appearance outlives this method; later methods and classes expect the default Light.
   try(BoundedActivityScenario<MainActivity> reset=BoundedActivityScenario.launch(MainActivity.class)){
    until("document.documentElement.dataset.activeView");
    WebViewTestDriver.evaluate("localStorage.setItem('alpha.appearance.v1','light')");
   }
  }
 }

 /** node scripts/test-native-restart.ts theme: prepare chooses Dark, the runner force-stops the
  * app, verify reads it in a new process, cleanup returns to Light through the same control. */
 @Test public void themeProcessRestartPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("themePhase");
  org.junit.Assume.assumeTrue("Run by node scripts/test-native-restart.ts theme","prepare".equals(phase)||"verify".equals(phase)||"cleanup".equals(phase));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   if("prepare".equals(phase)){chooseDarkTheme();assertDark("before the process stops");return;}
   AppNavigation.liveMode();
   if("verify".equals(phase)){assertDark("in a new process");return;}
   WebViewTestDriver.evaluate(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"));
   press("Theme: Light");
   until(BG+"==='#FFFFFF'");
  }
 }
}
