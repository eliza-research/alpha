package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.os.SystemClock;
import ai.eliza.plugins.reminders.ReminderTestAccess;
import org.json.JSONObject;
import static org.junit.Assert.*;

/** Follow a stale notification with an explicit selection of the current Calendar row. */
final class ReminderUiTestDriver {
 private ReminderUiTestDriver() {}
 private static void until(String predicate)throws Exception {
  long end=SystemClock.elapsedRealtime()+20000;
  while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+predicate+")")))return;SystemClock.sleep(100);}
  fail("Reminder Calendar selection missing: "+predicate);
 }
 static void assertStaleTapRetained(Context context)throws Exception {
  long end=SystemClock.elapsedRealtime()+20000;JSONObject pending;
  do{pending=new ReminderTestAccess.Taps(context).pending();if(pending.has("token"))break;SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);
  assertTrue("Original notification route captured",pending.has("token"));
  assertFalse("Snooze changed the original reviewed revision",pending.getBoolean("retained"));
  assertEquals("Stale notification must not open a replacement","\"home\"",WebViewTestDriver.evaluate("document.documentElement.dataset.activeView"));
 }
 static void openCurrent(String title)throws Exception {
  WebViewTestDriver.evaluate(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));
  WebViewTestDriver.evaluate("document.querySelector('button[aria-label=\"Retry calendar and reminders\"]')?.click()");
  String row="[...document.querySelectorAll('button[aria-label]')].find(e=>e.getClientRects().length&&e.getAttribute('aria-label').startsWith("+JSONObject.quote(title+", ")+"))";
  until(row);WebViewTestDriver.evaluate(row+".click()");
 }
}
