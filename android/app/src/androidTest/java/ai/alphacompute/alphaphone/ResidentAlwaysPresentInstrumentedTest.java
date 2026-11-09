package ai.alphacompute.alphaphone;

import android.app.UiAutomation;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Decision P-43 (owner, 2026-10-13, reconciled with #410/#478 in docs/decisions.md): the resident
 * agent is always present. Emulator check, flag-off builds only: signed out with the network off
 * and an older build's "local apps without AI" selection stored, the app starts the resident
 * instead of offering a no-agent mode. Every Alpha Phone signs in to Eliza Cloud, so signed out the
 * required sign-in page opens by itself over Home once the start has settled and cannot be dismissed.
 * The stored selection becomes the resident and no retired no-agent copy appears. The saved Cloud
 * credential and connection selection are restored afterwards. Emulator evidence (class E) for the
 * installed build only; it does not prove a full AOSP image, a physical device, that the resident
 * answers, or what a send dispatches.
 */
@RunWith(AndroidJUnit4.class)
public class ResidentAlwaysPresentInstrumentedTest {
 private static final String SELECTION = "alpha.connection.selection.v1";
 private static void until(String expression, long timeoutMs) throws Exception {
  long deadline = SystemClock.elapsedRealtime() + timeoutMs;
  while (SystemClock.elapsedRealtime() < deadline) {
   if ("true".equals(WebViewTestDriver.evaluate("Boolean(" + expression + ")"))) return;
   SystemClock.sleep(80);
  }
  fail("Renderer did not reach expected state: " + expression);
 }
 private static void until(String expression) throws Exception { until(expression, 20000); }
 private static void shell(String command) throws Exception {
  UiAutomation ui = InstrumentationRegistry.getInstrumentation().getUiAutomation();
  try (ParcelFileDescriptor.AutoCloseInputStream input = new ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand(command))) { input.readAllBytes(); }
 }
 @Test public void signedOutOfflineStartsTheResidentAndSendsNothing() throws Exception {
  Assume.assumeTrue("Product behavior only; test-mocks builds keep the development chooser", !BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  AlphaCredentialStore store = new AlphaCredentialStore(context);
  String savedCloud = store.readCredentialSlot("cloud:production");
  String savedSelection = null;
  shell("svc wifi disable"); shell("svc data disable");
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   until("document.querySelector('[data-screen]')");
   savedSelection = WebViewTestDriver.evaluate("localStorage.getItem('" + SELECTION + "')");
   if (savedCloud != null) store.removeCredentialSlot("cloud:production");
   String previous = WebViewTestDriver.evaluate("performance.timeOrigin");
   // An older build's "Use local apps without AI" choice.
   WebViewTestDriver.navigateHostDocument("localStorage.setItem('" + SELECTION + "',JSON.stringify({kind:'offline',localApps:true}));location.replace(location.origin+location.pathname)", true);
   until("performance.timeOrigin!==" + previous + "&&document.querySelector('[data-screen]')");
   // Signed out: AI is off until sign-in. P-43's required sign-in page opens by itself once the
   // resident's start has settled (connection-ui productionCloudSignInRequired).
   String page = "document.querySelector('.alpha-auth-page #cloud-sign-in-title')";
   until(page, 120000);
   assertEquals("The stored choice reads as the resident", "true", WebViewTestDriver.evaluate("localStorage.getItem('" + SELECTION + "')===JSON.stringify({kind:'resident'})"));
   assertEquals("No retired no-agent copy", "false", WebViewTestDriver.evaluate("['without AI','Continue offline','Connect an agent'].some(t=>document.body.innerText.includes(t))"));
   // The page has no close control and a close request leaves it open.
   assertEquals("The sign-in page cannot be dismissed", "false", WebViewTestDriver.evaluate("!!document.querySelector('.alpha-auth-page button[aria-label=\"" + AppNavigation.CLOSE_CONNECTION + "\"]')"));
   WebViewTestDriver.evaluate(AppNavigation.closeConnection());
   SystemClock.sleep(500);
   assertEquals("The sign-in page stays open", "true", WebViewTestDriver.evaluate("Boolean(" + page + ")"));
   assertEquals("Home is behind the page", "true", WebViewTestDriver.evaluate(AppNavigation.selected("Home")));
  } finally {
   shell("svc wifi enable"); shell("svc data enable");
   if (savedCloud != null) store.writeCredentialSlot("cloud:production", savedCloud);
   try (BoundedActivityScenario<MainActivity> restore = BoundedActivityScenario.launch(MainActivity.class)) {
    until("document.querySelector('[data-screen]')");
    WebViewTestDriver.evaluate(savedSelection != null && !"null".equals(savedSelection)
     ? "localStorage.setItem('" + SELECTION + "'," + savedSelection + ")"
     : "localStorage.removeItem('" + SELECTION + "')");
   }
  }
 }
}
