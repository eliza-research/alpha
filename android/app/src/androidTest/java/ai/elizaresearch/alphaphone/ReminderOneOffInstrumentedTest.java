package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ReminderOneOffInstrumentedTest {
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private StatusBarNotification notification(String id){for(StatusBarNotification n:context().getSystemService(NotificationManager.class).getActiveNotifications())if(id.equals(n.getTag()))return n;return null;}
 private JSONObject state(String id,String expected)throws Exception {
  long end=SystemClock.elapsedRealtime()+(expected.equals("posted")?13*60000L:20000L);
  while(SystemClock.elapsedRealtime()<end){JSONObject row=ReminderTestAccess.read(context(),id);if(row!=null&&expected.equals(row.optString("status")))return row;SystemClock.sleep(200);}
  JSONObject row=ReminderTestAccess.read(context(),id);throw new AssertionError("Expected "+expected+", observed "+(row==null?"missing":row.optString("status"))+", notificationsAllowed="+ReminderTestAccess.allowed(context()));
 }
 private void until(String predicate)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Reminder UI missing: "+predicate+"; safe state="+WebViewTestDriver.evaluate("JSON.stringify({view:document.documentElement.dataset.activeView,completed:document.body.innerText.includes('no further alarm scheduled'),receipt:document.body.innerText.includes(' · due '),done:!!document.querySelector('button[aria-label=\"Complete reminder occurrence\"]'),snooze:!!document.querySelector('button[aria-label=\"Snooze reminder 10 minutes\"]')})"));}
 private void clean(String id)throws Exception{ReminderTestAccess.cancel(context(),id);assertTrue(new ReminderTestAccess.Envelope(context()).records().edit().remove(id).commit());}
 @Test public void actualOneOffAlarmSnoozeVisibleDoneHistoryAndReplaySafety()throws Exception{
  org.junit.Assume.assumeTrue("Dedicated permission-restoring alarm runner required", "1".equals(InstrumentationRegistry.getArguments().getString("oneOffAlarm")));
  String id="once_"+UUID.randomUUID(),legacy="legacy_"+UUID.randomUUID();Context c=context();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();ReminderTestAccess.channel(c);assertTrue("Notifications must be granted by external runner",ReminderTestAccess.allowed(c));
   JSONObject created=ReminderTestAccess.schedule(c,id,"One-time native fixture "+id,"Owned one-off test",System.currentTimeMillis()+10000);
   String occurrence=created.getString("occurrenceId");assertFalse(created.has("recurrence"));state(id,"posted");
   StatusBarNotification posted=notification(id);assertNotNull("Real AlarmManager notification required",posted);
   ReminderNotificationActions.intent(posted,ReminderNotificationActions.SNOOZE).send();JSONObject snoozed=state(id,"scheduled");long deadline=snoozed.getLong("at");
   assertEquals(occurrence,snoozed.getString("occurrenceId"));assertTrue(deadline>System.currentTimeMillis()+590000);assertEquals(created.getLong("dueAt"),snoozed.getLong("dueAt"));
   ReminderNotificationActions.intent(posted,ReminderNotificationActions.SNOOZE).send();InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertEquals("Duplicate snooze cannot move deadline",deadline,ReminderTestAccess.read(c,id).getLong("at"));
   posted.getNotification().contentIntent.send();ReminderUiTestDriver.assertStaleTapRetained(c);ReminderUiTestDriver.openCurrent("One-time native fixture "+id);until("document.body.innerText.includes('Snoozed until') && document.body.innerText.includes('One-time reminder') && document.querySelector('button[aria-label=\"Complete reminder occurrence\"]')");
   WebViewTestDriver.evaluate("document.querySelector('button[aria-label=\"Complete reminder occurrence\"]').click()");
   JSONObject complete=state(id,"completed");assertEquals(id,complete.getString("id"));assertEquals(occurrence,complete.getString("occurrenceId"));assertEquals(1,complete.getJSONArray("history").length());assertFalse(complete.has("recurrence"));assertNull(notification(id));
   until("document.body.innerText.includes('no further alarm scheduled') && document.body.innerText.includes(' · due ') && !document.querySelector('button[aria-label=\"Complete reminder occurrence\"]') && !document.querySelector('button[aria-label=\"Snooze reminder 10 minutes\"]')");
   WebViewTestDriver.evaluate(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));
   until("[...document.querySelectorAll('button[aria-label]')].some(e=>e.getClientRects().length&&(e.getAttribute('aria-label')==='Open your calendar'||e.getAttribute('aria-label').startsWith('Open calendar event: ')))");
   assertEquals("A completed reminder with future snooze time is not an upcoming Home event","false",WebViewTestDriver.evaluate("[...document.querySelectorAll('button[aria-label]')].some(e=>e.getClientRects().length&&e.getAttribute('aria-label')==="+JSONObject.quote("Open calendar event: One-time native fixture "+id)+")"));
   ReminderNotificationActions.intent(posted,ReminderNotificationActions.DONE).send();ReminderNotificationActions.intent(posted,ReminderNotificationActions.SNOOZE).send();InstrumentationRegistry.getInstrumentation().waitForIdleSync();
   assertEquals("Old decisions cannot reopen or duplicate completion",complete.toString(),ReminderTestAccess.read(c,id).toString());
   ReminderTestAccess.restore(c);ReminderTestAccess.deliver(c,id,occurrence);assertNull(notification(id));assertEquals(complete.toString(),ReminderTestAccess.read(c,id).toString());
   scenario.diagnosticCheckpoint("oneoff-before-recreate");scenario.recreate();scenario.diagnosticCheckpoint("oneoff-after-recreate-before-content-intent");AppNavigation.liveMode();ReminderUiTestDriver.openCurrent("One-time native fixture "+id);scenario.diagnosticCheckpoint("oneoff-after-current-selection");until("document.body.innerText.includes('no further alarm scheduled') && document.body.innerText.includes(' · due ')");assertEquals(complete.toString(),ReminderTestAccess.read(c,id).toString());
   JSONObject edited=ReminderTestAccess.schedule(c,id,"Explicitly rescheduled fixture","",System.currentTimeMillis()+3600000);assertNotEquals(occurrence,edited.getString("occurrenceId"));assertEquals(1,edited.getJSONArray("history").length());
   assertEquals("stale",ReminderTestAccess.decide(c,id,occurrence,"done").getString("status"));assertEquals("stale",ReminderTestAccess.decide(c,id,occurrence,"snooze").getString("status"));ReminderTestAccess.deliver(c,id,occurrence);assertNull(notification(id));
   // An actual legacy-format stored row obtains deterministic identity across reads.
   // This is migration-state evidence; the real alarm evidence above uses a new row.
   JSONObject old=new JSONObject().put("id",legacy).put("title","Legacy fixture").put("body","").put("at",System.currentTimeMillis()+3600000).put("createdAt",1).put("status","scheduled").put("mode","inexact");
   assertTrue(new ReminderTestAccess.Envelope(c).records().edit().putString(legacy,old.toString()).commit());
   JSONObject migrated=ReminderTestAccess.read(c,legacy);assertEquals(migrated.getString("occurrenceId"),ReminderTestAccess.read(c,legacy).getString("occurrenceId"));assertEquals(old.getLong("at"),migrated.getLong("at"));
   assertEquals("completed",ReminderTestAccess.decide(c,legacy,migrated.getString("occurrenceId"),"done").getString("status"));ReminderTestAccess.deliver(c,legacy);assertNull(notification(legacy));assertEquals(1,ReminderTestAccess.read(c,legacy).getJSONArray("history").length());
  }finally{clean(id);clean(legacy);}
 }
}
