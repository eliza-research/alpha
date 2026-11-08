package ai.elizaresearch.alphaphone;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Screen-off navigation through AlphaNavigationService, driven by scripts/maps/test-native-navigation.mjs
 * (simulator GPS through the actual Android location provider, explicit argument mapsBackground=1).
 * Proves guidance keeps updating with the screen off and that the notification's Stop ends the
 * session exactly once. It is emulator evidence, not physical-device or road-safety acceptance.
 */
@RunWith(AndroidJUnit4.class)
public final class MapsBackgroundNavigationInstrumentedTest {
 private String js(String script) throws Exception { return WebViewTestDriver.evaluate(script); }
 private void waitFor(String predicate) throws Exception {
  for (int i = 0; i < 300; i++) { if ("true".equals(js("Boolean(" + predicate + ")"))) return; SystemClock.sleep(100); }
  fail("Background navigation state missing: " + predicate + "; status=" + js("document.querySelector('[data-alpha-maps-status]')?.textContent.slice(0,220)"));
 }
 private void click(String label) throws Exception {
  String q = "[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.getAttribute('aria-label')===" + JSONObject.quote(label) + ")";
  waitFor(q); js("(" + q + ").click()");
 }
 private void input(String label, String value) throws Exception {
  String q = "document.querySelector('input[aria-label=" + JSONObject.quote(label) + "]')"; waitFor(q);
  js("(()=>{const e=" + q + ";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e," + JSONObject.quote(value) + ");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  waitFor(q + ".value===" + JSONObject.quote(value)); js(q + ".dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void phase(String phase) throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  java.io.File file = new java.io.File(context.getFilesDir(), "maps-navigation-phase.txt");
  try (java.io.FileOutputStream output = new java.io.FileOutputStream(file)) { output.write(phase.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
  java.io.File ack = new java.io.File(file.getParentFile(), "maps-navigation-ack.txt");
  for (int i = 0; i < 150; i++) {
   if (ack.isFile()) try (java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.FileReader(ack))) { if (phase.equals(reader.readLine())) return; }
   SystemClock.sleep(100);
  }
  fail("GPS runner did not acknowledge phase " + phase);
 }
 private int watches() throws Exception {
  java.util.concurrent.atomic.AtomicInteger count = new java.util.concurrent.atomic.AtomicInteger(-1);
  WebViewTestDriver.withActivity(MainActivity.class, activity -> {
   try { Object plugin = activity.getBridge().getPlugin("ElizaLocation").getInstance(); java.lang.reflect.Field field = plugin.getClass().getDeclaredField("watches"); field.setAccessible(true); count.set(((java.util.Map<?, ?>) field.get(plugin)).size()); }
   catch (Exception error) { throw new AssertionError(error); }
  });
  return count.get();
 }
 private void watches(int expected) throws Exception {
  for (int i = 0; i < 100; i++) { if (watches() == expected) return; SystemClock.sleep(100); }
  assertEquals("Actual native watch count", expected, watches());
 }
 private void shell(String command) throws Exception {
  try (android.os.ParcelFileDescriptor output = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
       java.io.InputStream stream = new android.os.ParcelFileDescriptor.AutoCloseInputStream(output)) { while (stream.read() != -1) { /* drain */ } }
 }
 private boolean interactive() {
  return InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(android.os.PowerManager.class).isInteractive();
 }
 private StatusBarNotification navigationNotification() {
  NotificationManager manager = InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(NotificationManager.class);
  for (StatusBarNotification item : manager.getActiveNotifications()) if (item.getId() == AlphaNavigationService.NOTIFICATION_ID) return item;
  return null;
 }

 @Test public void screenOffGuidanceContinuesAndNotificationStopEndsOnce() throws Exception {
  org.junit.Assume.assumeTrue("Explicit simulator GPS runner only", "1".equals(InstrumentationRegistry.getArguments().getString("mapsBackground")));
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertTrue("This build must declare AlphaNavigationService as a location foreground service", AlphaNavigationService.declared(context));
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode(); js(AppNavigation.request("Maps")); waitFor(AppNavigation.selected("Maps"));
   waitFor("document.querySelector('[data-alpha-map-plane]')?.dataset.mapReady==='true'");
   input("Search places", "Casino de Monte Carlo");
   String result = "[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.textContent.trim().startsWith('Casino de Monte Carlo'))"; waitFor(result); js("(" + result + ").click()");
   click("Directions"); input("Route origin coordinates", "43.7384, 7.4246");
   waitFor("document.querySelector('[data-alpha-maps-root]').textContent.includes('no live traffic')");
   phase("background-origin");
   int stopsBefore = Integer.parseInt(AlphaNavigationService.snapshot()[1]);
   String start = "[...document.querySelectorAll('[data-alpha-maps-root] button')].find(e=>e.textContent.trim()==='Start')"; waitFor(start); js("(" + start + ").click()");
   watches(1);
   waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('continues with the screen off')");
   String session = AlphaNavigationService.snapshot()[0];
   assertFalse("A native navigation session is active", session.isEmpty());
   for (int i = 0; i < 50 && navigationNotification() == null; i++) SystemClock.sleep(100);
   StatusBarNotification posted = navigationNotification();
   assertNotNull("Ongoing navigation notification is posted", posted);
   assertTrue("Navigation notification is ongoing", (posted.getNotification().flags & Notification.FLAG_ONGOING_EVENT) != 0);
   String titleBefore = AlphaNavigationService.snapshot()[3];

   // Screen off: the location watch, guidance and the native session continue.
   shell("input keyevent KEYCODE_SLEEP");
   for (int i = 0; i < 50 && interactive(); i++) SystemClock.sleep(100);
   assertFalse("Screen is off", interactive());
   phase("background-moving");
   String titleAfter = titleBefore;
   for (int i = 0; i < 200 && titleAfter.equals(titleBefore); i++) { SystemClock.sleep(100); titleAfter = AlphaNavigationService.snapshot()[3]; }
   assertNotEquals("Guidance updated the notification with the screen off", titleBefore, titleAfter);
   assertEquals("Session survives screen off", session, AlphaNavigationService.snapshot()[0]);
   assertEquals("Location watch survives screen off", 1, watches());
   assertEquals("Renderer kept navigating while hidden", "true", js("document.hidden && !!document.querySelector('[aria-label=\"End navigation\"]')"));

   // The notification's own Stop action ends the session once.
   StatusBarNotification current = navigationNotification();
   assertNotNull(current);
   Notification.Action[] actions = current.getNotification().actions;
   assertNotNull("Stop action", actions);
   assertEquals("Stop", String.valueOf(actions[0].title));
   actions[0].actionIntent.send();
   for (int i = 0; i < 100 && !AlphaNavigationService.snapshot()[0].isEmpty(); i++) SystemClock.sleep(100);
   assertEquals("Session ended", "", AlphaNavigationService.snapshot()[0]);
   watches(0);
   shell("input keyevent KEYCODE_WAKEUP"); shell("wm dismiss-keyguard");
   for (int i = 0; i < 50 && !interactive(); i++) SystemClock.sleep(100);
   waitFor("!document.querySelector('[aria-label=\"End navigation\"]')");
   waitFor("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Navigation stopped from the notification.')");
   SystemClock.sleep(2000);
   String[] after = AlphaNavigationService.snapshot();
   assertEquals("Exactly one terminal stop", stopsBefore + 1, Integer.parseInt(after[1]));
   assertEquals("Stopped by the notification", "notification", after[2]);
   assertNull("Notification removed", navigationNotification());
   assertEquals("No automatic resume", 0, watches());
  } finally {
   try { shell("input keyevent KEYCODE_WAKEUP"); } catch (Exception ignored) { /* best effort */ }
   new java.io.File(context.getFilesDir(), "maps-navigation-phase.txt").delete();
   new java.io.File(context.getFilesDir(), "maps-navigation-ack.txt").delete();
  }
 }
}
