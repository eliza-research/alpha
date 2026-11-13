package ai.alphacompute.alphaphone;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.res.Configuration;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Accessibility across the lifecycle (PRD AP-15) at 200% system font scale, on every retained view:
 *
 * - repeated HOME: Android's HOME key three times from each view, Alpha brought back by its
 *   launcher start each time; the view, the one MainActivity, the measured text scale and the
 *   TalkBack order survive, and focus is not left in hidden content. (With Alpha selected as HOME,
 *   AccessibilityHomeRoleInstrumentedTest checks that HOME lands on an accessible Alpha Home.)
 * - rotation: each view on its side and back keeps its screen, every control on screen
 *   (RotationInstrumentedTest.CLIPPED) and its reading order.
 * - process death: processRestartPhase, run by `bun scripts/test-native-restart.ts
 *   accessibility`, leaves 200% font set, kills the process and reads the first screen of the new
 *   one (Home, or the required sign-in page of a signed-out flag-off build) in order.
 *
 * The views need the test-mocks pair or a phone its owner signed in (P-43). Emulator evidence only,
 * not TalkBack itself, Switch Access or a device.
 */
@RunWith(AndroidJUnit4.class)
public final class AccessibilityLifecycleInstrumentedTest {
 private static final Pattern TOP = Pattern.compile("(?:topResumedActivity|mResumedActivity)[=:][^\\n]*?\\s([A-Za-z0-9_.]+)/");
 private static String js(String code) throws Exception { return WebViewTestDriver.evaluate(code); }
 private static boolean until(String code, int tenths) throws Exception {
  for (int i = 0; i < tenths; i++) { if ("true".equals(js("Boolean(" + code + ")"))) return true; SystemClock.sleep(100); }
  return false;
 }
 private static void open(String view) throws Exception { js(AppNavigation.request(view)); assertTrue(view + " opens", until(AppNavigation.selected(view), 200)); }
 private static String foreground() throws Exception {
  String dump = AccessibilityViewsInstrumentedTest.shell("dumpsys activity activities");
  Matcher match = TOP.matcher(dump);
  return match.find() ? match.group(1) : null;
 }
 private static boolean awaitForeground(boolean alpha) throws Exception {
  String app = InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
  for (int i = 0; i < 100; i++) { String seen = foreground(); if (seen != null && app.equals(seen) == alpha) return true; SystemClock.sleep(150); }
  return false;
 }
 static void pressHome() {
  android.app.UiAutomation ui = InstrumentationRegistry.getInstrumentation().getUiAutomation(androidx.test.uiautomator.Configurator.getInstance().getUiAutomationFlags());
  long down = SystemClock.uptimeMillis();
  assertTrue("Android accepted HOME down", ui.injectInputEvent(new KeyEvent(down, down, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_HOME, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, KeyEvent.FLAG_FROM_SYSTEM, InputDevice.SOURCE_KEYBOARD), true));
  assertTrue("Android accepted HOME up", ui.injectInputEvent(new KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, KeyEvent.KEYCODE_HOME, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, KeyEvent.FLAG_FROM_SYSTEM, InputDevice.SOURCE_KEYBOARD), true));
 }
 /** The one MainActivity resumed (MainActivity "One live MainActivity"); null when that holds. */
 static String oneMainActivity() throws Exception {
  List<String> seen = new ArrayList<>();
  for (int attempt = 0; attempt < 100; attempt++) {
   seen.clear();
   BoundedActivityScenario.main(() -> {
    for (androidx.test.runner.lifecycle.Stage stage : androidx.test.runner.lifecycle.Stage.values()) {
     if (stage == androidx.test.runner.lifecycle.Stage.DESTROYED) continue;
     for (android.app.Activity activity : androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))
      if (activity.getClass() == MainActivity.class && !activity.isDestroyed()) seen.add(stage.name());
    }
   });
   if (seen.size() == 1 && "RESUMED".equals(seen.get(0))) return null;
   SystemClock.sleep(100);
  }
  return "MainActivity stages " + seen;
 }
 private static final String SCALE = "Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))";
 private static double scale() throws Exception { return Double.parseDouble(js(SCALE)); }
 private static void start() throws Exception {
  AppNavigation.liveMode();
  js(AppNavigation.request("Home")); assertTrue("Home ready", until(AppNavigation.selected("Home"), 200));
  AppNavigation.declineStartupAccess();
  assertTrue("The page measures the 200% text it is drawn at (measured " + js(SCALE) + ")", until("Math.abs(" + SCALE + "-2)<0.2", 100));
 }

 /** P-43: the views need a phone its owner signed in. */
 private static void assumeViews(String journey) throws Exception { AppNavigation.assumeNoRequiredSignIn(journey); }

 /** Android's HOME key from every view, three times, with Alpha brought back by its launcher start each time. */
 @Test public void repeatedHomeAndReturnKeepEveryViewAccessible() throws Exception {
  assumeViews("Repeated HOME across views");
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  Assume.assumeFalse("With Alpha selected as HOME the HOME key lands on Alpha Home (AccessibilityHomeRoleInstrumentedTest)", ChatContinuityInstrumentedTest.alphaIsHome(context));
  String previous = AccessibilityViewsInstrumentedTest.fontScale(null);
  UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  List<String> problems = new ArrayList<>();
  try {
   AccessibilityViewsInstrumentedTest.fontScale("2.0");
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    start();
    for (String view : AccessibilityViewsInstrumentedTest.VIEWS) {
     open(view);
     for (int press = 1; press <= 3; press++) {
      pressHome();
      if (!awaitForeground(false)) { problems.add(view + ": HOME " + press + " did not leave Alpha"); break; }
      // The launcher start of the app (an explicit start of the singleTask activity), not a HOME start.
      AccessibilityViewsInstrumentedTest.shell("am start -n " + context.getPackageName() + "/" + MainActivity.class.getName());
      if (!awaitForeground(true)) { problems.add(view + ": Alpha did not come back after HOME " + press); break; }
     }
     String one = oneMainActivity();
     if (one != null) problems.add(view + ": " + one);
     if (!until(AppNavigation.selected(view), 100)) problems.add(view + ": the view was not kept across HOME (now " + js("document.documentElement.dataset.activeView") + ")");
     if (Math.abs(scale() - 2) >= 0.2) problems.add(view + ": the text scale after returning is " + scale());
     String hidden = js("(()=>{const el=document.activeElement;return el&&el!==document.body&&el.closest('[inert],[aria-hidden=\"true\"],[hidden]')?(el.getAttribute('aria-label')||el.textContent.trim().slice(0,40)):null})()");
     if (!"null".equals(hidden)) problems.add(view + ": focus is left in hidden content (" + hidden + ")");
     for (String problem : TalkBackOrder.read(device, view + " after HOME", TalkBackOrder.Assistant.LAST_IF_PRESENT).problems) problems.add(view + " after HOME: " + problem);
     js(AppNavigation.request("Home"));
     if (!until(AppNavigation.selected("Home"), 200)) problems.add(view + ": did not return Home");
    }
   }
  } finally { AccessibilityViewsInstrumentedTest.restoreFontScale(previous); }
  assertTrue("Repeated HOME at 200% font:\n" + String.join("\n", problems), problems.isEmpty());
 }

 /** Each view on its side and back: its screen, every control on screen and its reading order. */
 @Test public void everyViewKeepsItsScreenAndControlsThroughRotation() throws Exception {
  assumeViews("Rotation across views");
  String previous = AccessibilityViewsInstrumentedTest.fontScale(null);
  UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  List<String> problems = new ArrayList<>();
  try {
   AccessibilityViewsInstrumentedTest.fontScale("2.0");
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    start();
    for (String view : AccessibilityViewsInstrumentedTest.VIEWS) {
     open(view);
     // The launcher is held portrait, so each view is checked upright.
     device.setOrientationNatural();
     boolean upright = true;
     try { RotationInstrumentedTest.awaitOrientation(Configuration.ORIENTATION_PORTRAIT); }
     catch (AssertionError error) { problems.add(view + ": did not reach portrait"); upright = false; }
     if (upright && !until(AppNavigation.selected(view), 100)) { problems.add(view + ": not in front in portrait"); upright = false; }
     if (upright) {
      SystemClock.sleep(400);
      String clipped = RotationInstrumentedTest.clipped();
      if (!"[]".equals(clipped)) problems.add(view + " portrait: controls clipped " + clipped);
      for (String problem : TalkBackOrder.read(device, view + " portrait", TalkBackOrder.Assistant.LAST_IF_PRESENT).problems) problems.add(view + " portrait: " + problem);
     }
     js(AppNavigation.request("Home"));
     if (!until(AppNavigation.selected("Home"), 200)) problems.add(view + ": did not return Home");
    }
   }
  } finally {
   device.setOrientationNatural(); device.unfreezeRotation();
   AccessibilityViewsInstrumentedTest.restoreFontScale(previous);
  }
  assertTrue("Rotation at 200% font:\n" + String.join("\n", problems), problems.isEmpty());
 }

 /**
  * Process death at 200% font, in phases each run by a new instrumentation process
  * (`bun scripts/test-native-restart.ts accessibility`): prepare sets the font scale and opens
  * Settings; the runner force-stops the app; verify reads the first screen of the new process in
  * order at the persisted scale; cleanup restores the font scale. Never run without its runner.
  */
 @Test public void processRestartPhase() throws Exception {
  String phase = InstrumentationRegistry.getArguments().getString("accessibilityPhase");
  Assume.assumeTrue("Explicit separate-process runner", phase != null);
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  File fixture = new File(context.getFilesDir(), "accessibility-restart-fixture.json");
  UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  if ("prepare".equals(phase)) {
   assertFalse("Never overwrite an existing recovery fixture", fixture.exists());
   JSONObject record = new JSONObject().put("previous", AccessibilityViewsInstrumentedTest.fontScale(null)).put("pid", android.os.Process.myPid());
   Files.write(fixture.toPath(), record.toString().getBytes(StandardCharsets.UTF_8));
   AccessibilityViewsInstrumentedTest.fontScale("2.0");
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    AppNavigation.liveMode();
    assertTrue("The page measures the 200% text it is drawn at", until("Math.abs(" + SCALE + "-2)<0.2", 100));
    if (!requiredSignIn(context)) { js(AppNavigation.request("Settings")); assertTrue("Settings opens before the process dies", until(AppNavigation.selected("Settings"), 200)); }
   }
  } else if ("verify".equals(phase)) {
   JSONObject record = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
   assertNotEquals("Verification runs in a different app process", record.getInt("pid"), android.os.Process.myPid());
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    AppNavigation.liveMode();
    assertTrue("The new process measures the persisted 200% text (measured " + js(SCALE) + ")", until("Math.abs(" + SCALE + "-2)<0.2", 100));
    if (requiredSignIn(context)) {
     assertTrue("The required sign-in page comes back", until("document.querySelector('.alpha-auth-page #cloud-sign-in-title')", 200));
     TalkBackOrder.check(device, "Required Cloud sign-in after process death", TalkBackOrder.Assistant.ABSENT);
    } else {
     js(AppNavigation.request("Home")); assertTrue("Home after process death", until(AppNavigation.selected("Home"), 200));
     AppNavigation.declineStartupAccess();
     TalkBackOrder.check(device, "Home after process death", TalkBackOrder.Assistant.REQUIRED_LAST);
     open("Settings");
     TalkBackOrder.check(device, "Settings after process death", TalkBackOrder.Assistant.REQUIRED_LAST);
    }
   }
  } else if ("cleanup".equals(phase)) {
   if (fixture.exists()) {
    JSONObject record = new JSONObject(new String(Files.readAllBytes(fixture.toPath()), StandardCharsets.UTF_8));
    AccessibilityViewsInstrumentedTest.restoreFontScale(record.optString("previous", "1.0"));
    assertTrue(fixture.delete());
   }
  } else fail("Unknown accessibility phase " + phase);
 }
 private static boolean requiredSignIn(Context context) throws Exception {
  return new AlphaCredentialStore(context).readCredentialSlot("cloud:production") == null;
 }
}
