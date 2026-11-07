package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.SystemShade;

import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Rect;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Android's shade is the one notification and quick-settings surface (#416, #417). On the launcher
 * flavor launcher Home asks Android to open it (button and pull on empty Home, EXPAND_STATUS_BAR);
 * the standalone app is an ordinary app and never asks. Alpha draws no shade of its own.
 *
 * The Home method needs a test-mocks app build (it is skipped on any other): a production Android
 * build opens the Eliza Cloud sign-in gate over Home, which cannot be passed without an account. Emulator evidence only (see
 * docs/verification.md); not AOSP-image, Pixel 10a or TalkBack acceptance.
 */
@RunWith(AndroidJUnit4.class)
public class SystemShadeInstrumentedTest {
 private static String js(String code) throws Exception { return WebViewTestDriver.evaluate(code); }
 private static void until(String code) throws Exception {
  for (int i = 0; i < 200; i++) { if ("true".equals(js("Boolean(" + code + ")"))) return; SystemClock.sleep(100); }
  fail("System shade condition: " + code);
 }
 private static Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }

 /**
  * Counts, from the page, the touches that reach it and Alpha's requests for Android's shade.
  * Without them a pull can pass vacuously: on the API 35 emulator SystemUI's shade window kept
  * taking touches for a moment after it collapsed, so a swipe right after a collapse reached
  * Android, not Alpha, and Android itself reopened its shade (1 of 3 runs with Alpha as HOME).
  */
 private static final String COUNT_PULLS = "(()=>{if(window.__alphaPull)return;const c=window.__alphaPull={touches:0,focusedAtTouch:0,calls:0};"
  + "document.addEventListener('touchstart',e=>{if(e.target instanceof Element&&e.target.closest('[data-alpha-layer=\"home\"]')){c.touches++;if(document.activeElement?.matches?.('textarea[data-alpha-composer]'))c.focusedAtTouch++;}},true);"
  + "const send=Capacitor.nativePromise;Capacitor.nativePromise=function(plugin,method){if(plugin==='AlphaDevice'&&method==='openNotificationShade')c.calls++;return send.apply(this,arguments);};})()";
 private static int pullCount(String field) throws Exception { return Integer.parseInt(js("String(window.__alphaPull." + field + ")").replace("\"", "")); }

 /** A downward swipe that reached Alpha's Home: retried (up to five times) while it did not. */
 private static void pullOnHome(UiDevice device, int x, int y, int distance) throws Exception {
  int before = pullCount("touches");
  for (int attempt = 0; attempt < 5; attempt++) {
   SystemClock.sleep(500);
   device.swipe(x, y, x, y + distance, 20);
   SystemClock.sleep(1500);
   if (pullCount("touches") > before) return;
   // Android took the swipe (its collapsing shade window); put Alpha back in front and try again.
   if (AndroidShade.isOpen()) AndroidShade.collapse();
  }
  fail("No pull reached Alpha's Home in five swipes");
 }

 /** A status bar stand-in with Android's method name, for the outcome mapping only. */
 public static final class FakeStatusBar { public int calls; public void expandNotificationsPanel() { calls++; } }
 public static final class RefusingStatusBar { public void expandNotificationsPanel() { throw new SecurityException("refused"); } }
 private static SystemShade.Platform platform(boolean granted, Object service) {
  return new SystemShade.Platform() {
   @Override public boolean granted(String permission) { return granted && SystemShade.PERMISSION.equals(permission); }
   @Override public Object statusBar() { return service; }
  };
 }

 @Test public void everyOutcomeIsReportedAndOnlyAnAcceptedCallIsOpened() {
  FakeStatusBar bar = new FakeStatusBar();
  assertEquals(SystemShade.STANDALONE, SystemShade.expand(platform(true, bar), false));
  assertEquals("The standalone app never reaches the status bar", 0, bar.calls);
  assertEquals(SystemShade.PERMISSION_MISSING, SystemShade.expand(platform(false, bar), true));
  assertEquals(0, bar.calls);
  assertEquals(SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, null), true));
  assertEquals("A service without the method", SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, new Object()), true));
  assertEquals("A refused call", SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, new RefusingStatusBar()), true));
  assertEquals(SystemShade.OPENED, SystemShade.expand(platform(true, bar), true));
  assertEquals(1, bar.calls);
 }

 @Test public void onlyTheLauncherFlavorDeclaresAndHoldsExpandStatusBar() throws Exception {
  PackageInfo info = context().getPackageManager().getPackageInfo(context().getPackageName(), PackageManager.GET_PERMISSIONS);
  boolean declared = info.requestedPermissions != null && Arrays.asList(info.requestedPermissions).contains(SystemShade.PERMISSION);
  assertEquals("EXPAND_STATUS_BAR is declared by the launcher flavor only", BuildConfig.IS_LAUNCHER, declared);
  boolean granted = context().checkSelfPermission(SystemShade.PERMISSION) == PackageManager.PERMISSION_GRANTED;
  assertEquals("An install-time permission is held exactly when declared", BuildConfig.IS_LAUNCHER, granted);
 }

 @Test public void homeAsksAndroidForItsShadeOnTheLauncherOnly() throws Exception {
  // A production Android build covers Home with the Eliza Cloud sign-in gate; only a test-mocks
  // build offers "Continue offline" to reach Home without an account.
  assumeTrue("Home is reachable without an account only in a test-mocks app build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode(); js(AppNavigation.request("Home")); until(AppNavigation.selected("Home")); AppNavigation.declineStartupAccess();
   // Home must be in front with nothing over it. The connection panel (a production build's Cloud
   // sign-in gate) also reports Home as the active view while it covers Home and takes every
   // touch, so a pull would land on the panel and the standalone half would pass vacuously.
   until("!document.querySelector('.alpha-connection-scrim')");
   until(AndroidShade.ALPHA_SHADE_ABSENT);
   // The plugin call the button makes, with Alpha in front.
   js("window.__shadeOutcome=null;Capacitor.Plugins.AlphaDevice.openNotificationShade().then(r=>window.__shadeOutcome=r.status,()=>window.__shadeOutcome='rejected')");
   until("window.__shadeOutcome!==null");
   String outcome = js("window.__shadeOutcome");
   if (BuildConfig.IS_LAUNCHER) {
    assertEquals("\"opened\"", outcome);
    assertTrue("Android expanded its shade", AndroidShade.waitOpen(5000));
    AndroidShade.collapse();
   } else {
    assertEquals("\"standalone\"", outcome);
    SystemClock.sleep(1000);
    assertFalse("The standalone app does not open Android's shade", AndroidShade.isOpen());
   }
   assertTrue(device.wait(androidx.test.uiautomator.Until.hasObject(By.pkg(BuildConfig.APPLICATION_ID).depth(0)), 5000));
   until(AppNavigation.selected("Home"));

   // A pull down on empty Home, whether Home fits the screen (vertical drags go to the page) or
   // overflows it (Alpha takes a downward drag at Home's top from the WebView). Never skipped:
   // which case ran is in the assertion message. Every pull must reach Alpha's Home, and the
   // shade is attributed to Alpha only when Alpha asked for it.
   js("document.querySelector('[data-alpha-layer=\"home\"]').scrollTop=0");
   js(COUNT_PULLS);
   String fits = js("document.querySelector('[data-alpha-layer=\"home\"]')?.dataset.alphaHomeFits??'unknown'");
   Rect web = device.findObject(By.clazz("android.webkit.WebView")).getVisibleBounds();
   int x = web.centerX(), y = web.top + Math.round(web.height() * 0.45f);
   pullOnHome(device, x, y, web.height() / 3);
   if (BuildConfig.IS_LAUNCHER) {
    assertTrue("A pull down on empty launcher Home opens Android's shade (Home fits: " + fits + ")", AndroidShade.waitOpen(5000));
    assertEquals("Alpha asked Android once for that pull", 1, pullCount("calls"));
    assertEquals("No Alpha panel behind it", "true", js(AndroidShade.ALPHA_SHADE_ABSENT));
    AndroidShade.collapse();
    until(AppNavigation.selected("Home"));
    // With the composer focused (the keyboard may be up) the same pull belongs to the text field.
    js("document.querySelector('textarea[data-alpha-composer]')?.focus()");
    until("document.activeElement?.matches?.('textarea[data-alpha-composer]')");
    pullOnHome(device, x, web.top + Math.round(web.height() * 0.3f), web.height() / 4);
    assertTrue("The composer still had focus when the pull reached Home", pullCount("focusedAtTouch") > 0);
    assertEquals("A pull with the composer focused does not ask for Android's shade", 1, pullCount("calls"));
    assertFalse("A pull with the composer focused does not open Android's shade", AndroidShade.isOpen());
   } else {
    assertEquals("The standalone app never asks for Android's shade", 0, pullCount("calls"));
    assertFalse("The standalone app answers no pull on Home with Android's shade", AndroidShade.isOpen());
   }
  } finally {
   if (AndroidShade.isOpen()) AndroidShade.collapse();
  }
 }
}
