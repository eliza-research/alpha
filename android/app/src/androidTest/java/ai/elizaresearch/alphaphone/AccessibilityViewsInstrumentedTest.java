package ai.elizaresearch.alphaphone;

import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.matcher.ViewMatchers.isRoot;
import static org.junit.Assert.*;

import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.espresso.accessibility.AccessibilityChecks;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Every retained MVP view and the Apps drawer at 200% system font scale (PRD AP-15): the
 * Accessibility Test Framework checks of the native hierarchy, the TalkBack linear order of the
 * WebView's nodes (TalkBackOrder: labels, reading order, at most one assistant group read last),
 * the screen's name as the focused element after opening it (runtime/view-focus.ts) and the page's
 * own measure of the text size. Each view is checked and every problem collected before the test
 * fails, so one run reports all views. AccessibilityInstrumentedTest keeps the Home, Settings and
 * composer journey and the shade click; test/browser/accessibility-sweep.spec.ts makes the same
 * reading-order check in Chromium for every state. Emulator evidence only, not TalkBack itself or
 * a device.
 *
 * The views need the test-mocks pair or a phone its owner signed in: a flag-off build signed out
 * of Eliza Cloud shows only the required sign-in page (P-43), which AccessibilityInstrumentedTest
 * checks on its own.
 */
@RunWith(AndroidJUnit4.class)
public final class AccessibilityViewsInstrumentedTest {
 /** The retained MVP views (mvp-features.ts ENABLED_MVP_VIEWS) by their Home tile names. */
 static final String[] VIEWS = {"Inbox", "Calendar", "Browser", "Photos", "Notes", "Files", "Workflows", "Settings", "Maps", "Camera"};
 private static android.app.UiAutomation automation() {
  return InstrumentationRegistry.getInstrumentation().getUiAutomation(androidx.test.uiautomator.Configurator.getInstance().getUiAutomationFlags());
 }
 static String shell(String command) throws Exception {
  try (InputStream in = new ParcelFileDescriptor.AutoCloseInputStream(automation().executeShellCommand(command))) { return new String(in.readAllBytes(), StandardCharsets.UTF_8).trim(); }
 }
 /** System settings are per user; the instrumentation may run as a secondary one. */
 static String fontScale(String value) throws Exception {
  String user = String.valueOf(android.os.Process.myUid() / 100000);
  return value == null ? shell("settings get --user " + user + " system font_scale") : shell("settings put --user " + user + " system font_scale " + value);
 }
 static void restoreFontScale(String previous) throws Exception { fontScale(previous == null || previous.isEmpty() || "null".equals(previous) ? "1.0" : previous); }
 private static String js(String code) throws Exception { return WebViewTestDriver.evaluate(code); }
 private static boolean until(String code, int tenths) throws Exception {
  for (int i = 0; i < tenths; i++) { if ("true".equals(js("Boolean(" + code + ")"))) return true; SystemClock.sleep(100); }
  return false;
 }
 /** Where focus is after a screen change: null when it is on the screen in front, else what is wrong. */
 static final String FOCUS_PROBLEM = "(()=>{const el=document.activeElement;if(!el||el===document.body||el===document.documentElement)return 'focus is on the page body';"
  + "if(el.closest('[inert],[aria-hidden=\"true\"],[hidden]'))return 'focus is in hidden content: '+(el.getAttribute('aria-label')||el.textContent.trim().slice(0,40));"
  + "if(el.closest('[data-alpha-layer=\"home\"]')&&document.documentElement.dataset.activeView!=='home')return 'focus stayed on Home';return null;})()";

 /** P-43: the views need the test-mocks pair (BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS) or a phone its owner signed in. */
 private static void assumeViews(String journey) throws Exception { if (!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS) AppNavigation.assumeNoRequiredSignIn(journey); }

 @Test public void everyViewReadsInOrderAtDoubleFontScale() throws Exception {
  assumeViews("Every view at 200% font");
  String previous = fontScale(null);
  UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  List<String> problems = new ArrayList<>();
  try {
   fontScale("2.0");
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    AppNavigation.liveMode();
    js(AppNavigation.request("Home")); assertTrue("Home ready", until(AppNavigation.selected("Home"), 200));
    AppNavigation.declineStartupAccess();
    AccessibilityChecks.enable().setRunChecksFromRootView(true);
    assertTrue("The page measures the 200% text it is drawn at", until("Math.abs(Number(getComputedStyle(document.documentElement).getPropertyValue('--alpha-text-scale'))-2)<0.2", 100));
    // The Apps drawer is a dialog over Home: its own names and order, nothing of Home after it.
    js("document.querySelector('[data-alpha-layer=\"home\"] button[aria-label=\"Apps\"]')?.click()");
    if (until("document.querySelector('[data-alpha-layer=\"drawer\"]')", 100)) {
     TalkBackOrder.Result drawer = TalkBackOrder.read(device, "Apps", TalkBackOrder.Assistant.LAST_IF_PRESENT);
     for (String problem : drawer.problems) problems.add("Apps: " + problem);
     js("window.dispatchEvent(new Event('launcher-home'))");
     until("!document.querySelector('[data-alpha-layer=\"drawer\"]')", 100);
    } else problems.add("Apps: the drawer did not open");
    for (String view : VIEWS) {
     js(AppNavigation.request(view));
     if (!until(AppNavigation.selected(view), 200)) { problems.add(view + ": did not open"); continue; }
     SystemClock.sleep(600);
     try { onView(isRoot()).check(AccessibilityChecks.accessibilityAssertion()); }
     catch (Throwable error) { problems.add(view + ": Accessibility Test Framework: " + error.getMessage()); }
     String focus = js(FOCUS_PROBLEM);
     if (!"null".equals(focus)) problems.add(view + ": after opening, " + focus);
     TalkBackOrder.Result result = TalkBackOrder.read(device, view, TalkBackOrder.Assistant.LAST_IF_PRESENT);
     for (String problem : result.problems) problems.add(view + ": " + problem);
     js(AppNavigation.request("Home"));
     if (!until(AppNavigation.selected("Home"), 200)) problems.add(view + ": did not return Home");
    }
   }
  } finally { restoreFontScale(previous); }
  assertTrue("Views at 200% font:\n" + String.join("\n", problems), problems.isEmpty());
 }
}
