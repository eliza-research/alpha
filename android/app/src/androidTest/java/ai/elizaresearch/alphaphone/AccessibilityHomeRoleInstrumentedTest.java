package ai.elizaresearch.alphaphone;

import static org.junit.Assert.*;

import android.content.Context;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.util.ArrayList;
import java.util.List;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * The launcher APK as the device's HOME at 200% system font scale (PRD AP-15, repeated HOME): from
 * every retained view, Android's HOME key pressed three times lands on Alpha Home each time, in the
 * one MainActivity, with focus on Home (runtime/view-focus.ts: TalkBack announces Home instead of
 * nothing), Home in TalkBack order with the assistant controls read last, and the measured text
 * scale unchanged. Runs only where Alpha already holds the HOME role; on an owned emulator the
 * runner selects and restores it:
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --serial emulator-NNNN \
 *     --variants launcher --home-role --classes AccessibilityHomeRole
 * Emulator evidence, not boot-time HOME, TalkBack itself or device acceptance.
 */
@RunWith(AndroidJUnit4.class)
public final class AccessibilityHomeRoleInstrumentedTest {
 private static String js(String code) throws Exception { return WebViewTestDriver.evaluate(code); }
 private static boolean until(String code, int tenths) throws Exception {
  for (int i = 0; i < tenths; i++) { if ("true".equals(js("Boolean(" + code + ")"))) return true; SystemClock.sleep(100); }
  return false;
 }
 private static final String SCALE = "Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))";
 private static final String HOME_READY = AppNavigation.selected("Home") + "&&!document.querySelector('[data-alpha-layer=\"drawer\"]')&&!document.querySelector('.os')?.inert";

 /** P-43: the views need the test-mocks pair (BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS) or a phone its owner signed in. */
 private static void assumeViews(String journey) throws Exception { if (!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS) AppNavigation.assumeNoRequiredSignIn(journey); }

 @Test public void homeKeyFromEveryViewLandsOnAnAccessibleAlphaHome() throws Exception {
  assumeViews("Repeated HOME with Alpha as HOME");
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  Assume.assumeTrue("HOME qualification exists only in the launcher variant", BuildConfig.IS_LAUNCHER);
  Assume.assumeTrue("Alpha must already be the selected HOME app; this test never changes roles", ChatContinuityInstrumentedTest.alphaIsHome(context));
  String previous = AccessibilityViewsInstrumentedTest.fontScale(null);
  UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  List<String> problems = new ArrayList<>();
  try {
   AccessibilityViewsInstrumentedTest.fontScale("2.0");
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    AppNavigation.liveMode();
    js(AppNavigation.request("Home")); assertTrue("Home ready", until(HOME_READY, 200));
    AppNavigation.declineStartupAccess();
    assertTrue("The page measures the 200% text it is drawn at", until("Math.abs(" + SCALE + "-2)<0.2", 100));
    for (String view : AccessibilityViewsInstrumentedTest.VIEWS) {
     js(AppNavigation.request(view));
     if (!until(AppNavigation.selected(view), 200)) { problems.add(view + ": did not open"); continue; }
     for (int press = 1; press <= 3; press++) {
      AccessibilityLifecycleInstrumentedTest.pressHome();
      if (!until(HOME_READY, 100)) { problems.add(view + ": HOME " + press + " did not land on Alpha Home (" + js("document.documentElement.dataset.activeView") + ")"); break; }
     }
     String one = AccessibilityLifecycleInstrumentedTest.oneMainActivity();
     if (one != null) problems.add(view + ": " + one);
     String focus = js(AccessibilityViewsInstrumentedTest.FOCUS_PROBLEM);
     if (!"null".equals(focus)) problems.add(view + ": after HOME, " + focus);
     else if (!"true".equals(js("!!document.activeElement?.closest('[data-alpha-layer=\"home\"],[data-alpha-layer=\"composer\"]')"))) problems.add(view + ": after HOME focus is not on Home");
     if (!"true".equals(js("Math.abs(" + SCALE + "-2)<0.2"))) problems.add(view + ": the text scale after HOME is " + js(SCALE));
     for (String problem : TalkBackOrder.read(device, "Home after HOME from " + view, TalkBackOrder.Assistant.REQUIRED_LAST).problems) problems.add(view + ": " + problem);
    }
   }
  } finally { AccessibilityViewsInstrumentedTest.restoreFontScale(previous); }
  assertTrue("HOME from every view at 200% font:\n" + String.join("\n", problems), problems.isEmpty());
 }
}
