package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.app.NotificationManager;
import android.content.Context;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.*;
import java.time.temporal.TemporalAdjusters;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ReminderRecurrenceInstrumentedTest {
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private JSONObject rule(String kind,String zone,LocalDate day,LocalTime time)throws Exception{return new JSONObject().put("rule",kind).put("zone",zone).put("date",day.toString()).put("time",time.toString()).put("leadMinutes",0);}
 private void clean(String id)throws Exception{ReminderTestAccess.cancel(context(),id);assertTrue(new ReminderTestAccess.Envelope(context()).records().edit().remove(id).commit());}
 private StatusBarNotification notification(String id){for(StatusBarNotification n:context().getSystemService(NotificationManager.class).getActiveNotifications())if(id.equals(n.getTag()))return n;return null;}
 private JSONObject state(String id,String status)throws Exception{
  JSONObject initial=ReminderTestAccess.read(context(),id);
  // Delivery is deliberately inexact. The observed API35 emulator alarm policy
  // reports a 10-minute minimum window; 90 seconds from setup was only ~37s after due.
  // This is a bounded acceptance budget, not a guarantee of an Android deadline.
  long budget=status.equals("posted")?Math.min(13*60000L,Math.max(20000L,(initial==null?0:initial.optLong("at"))-System.currentTimeMillis()+12*60000L)):20000L;
  long end=SystemClock.elapsedRealtime()+budget;
  while(SystemClock.elapsedRealtime()<end){JSONObject row=ReminderTestAccess.read(context(),id);if(row!=null&&status.equals(row.optString("status")))return row;SystemClock.sleep(250);}
  JSONObject row=ReminderTestAccess.read(context(),id),diagnostic=new JSONObject().put("expectedStatus",status).put("actualStatus",row==null?"missing":row.optString("status"))
   .put("alarmAt",row==null?JSONObject.NULL:row.optLong("at")).put("dueAt",row==null?JSONObject.NULL:row.optLong("dueAt"))
   .put("observedAt",System.currentTimeMillis()).put("waitBudgetMs",budget).put("notificationsAllowed",ReminderTestAccess.allowed(context())).put("fixtureNotificationPresent",notification(id)!=null);
  throw new AssertionError("Occurrence wait exhausted: "+diagnostic);
 }
 private void until(String predicate)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Reminder UI missing: "+predicate);}
 @Test public void actualAlarmSnoozeAndVisibleDoneAdvanceOnceAndRejectOldOccurrence()throws Exception{
  org.junit.Assume.assumeTrue("Dedicated inexact alarm runner only", "1".equals(InstrumentationRegistry.getArguments().getString("recurrenceAlarm")));
  String id="repeat_"+UUID.randomUUID();Context c=context();
  // The external runner owns grant/restore: revoking this app's permission here can kill instrumentation.
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();ReminderTestAccess.channel(c);assertTrue("Use test-reminder-recurrence.mjs with notifications granted and channel enabled",ReminderTestAccess.allowed(c));
   ZonedDateTime first=ZonedDateTime.now().plusMinutes(1).withSecond(0).withNano(0);if(first.toInstant().toEpochMilli()-System.currentTimeMillis()<8000)first=first.plusMinutes(1);
   JSONObject created=ReminderTestAccess.schedule(c,id,"Recurring native fixture "+id,"Owned recurrence test",first.toInstant().toEpochMilli(),rule("daily",first.getZone().getId(),first.toLocalDate(),first.toLocalTime()));
   String occurrence=created.getString("occurrenceId");state(id,"posted");StatusBarNotification posted=notification(id);assertNotNull("Actual AlarmManager delivery",posted);
   ReminderUiTestDriver.notificationAction(posted,"Snooze 10 minutes").actionIntent.send();JSONObject snoozed=state(id,"scheduled");long deadline=snoozed.getLong("at");assertEquals(occurrence,snoozed.getString("occurrenceId"));assertTrue(deadline>System.currentTimeMillis()+590000);
   ReminderUiTestDriver.notificationAction(posted,"Snooze 10 minutes").actionIntent.send();InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertEquals("Duplicate snooze cannot extend deadline",deadline,ReminderTestAccess.read(c,id).getLong("at"));
   posted.getNotification().contentIntent.send();ReminderUiTestDriver.assertStaleTapRetained(c);ReminderUiTestDriver.openCurrent("Recurring native fixture "+id);until("document.body.innerText.includes('Snoozed until') && document.body.innerText.includes('Next occurrence is scheduled after Done') && document.querySelector('button[aria-label=\"Complete reminder occurrence\"]')");
   WebViewTestDriver.evaluate("document.querySelector('button[aria-label=\"Complete reminder occurrence\"]').click()");
   long end=SystemClock.elapsedRealtime()+15000;while(SystemClock.elapsedRealtime()<end&&occurrence.equals(ReminderTestAccess.read(c,id).getString("occurrenceId")))SystemClock.sleep(100);
   JSONObject next=ReminderTestAccess.read(c,id);assertNotEquals(occurrence,next.getString("occurrenceId"));assertEquals(1,next.getJSONArray("history").length());assertEquals(first.toLocalDate().plusDays(1).toString(),next.getJSONObject("recurrence").getString("date"));
   assertEquals("stale",ReminderTestAccess.decide(c,id,occurrence,"done").getString("status"));assertEquals("stale",ReminderTestAccess.decide(c,id,occurrence,"snooze").getString("status"));
   ReminderTestAccess.deliver(c,id,occurrence);assertNull("Old alarm cannot post next occurrence",notification(id));
   scenario.recreate();AppNavigation.liveMode();assertEquals(next.toString(),ReminderTestAccess.read(c,id).toString());
   ReminderTestAccess.restore(c);assertEquals("Restoration must not advance occurrence",next.getString("occurrenceId"),ReminderTestAccess.read(c,id).getString("occurrenceId"));
  }finally{clean(id);}
 }
 @Test public void civilScheduleSkipsWeekendHandlesGapAndEditInvalidatesOldDecisions()throws Exception{
  String id="civil_"+UUID.randomUUID();String zone="America/New_York";ZoneId z=ZoneId.of(zone);
  try{
   LocalDate march=LocalDate.of(LocalDate.now().getYear()+2,3,1).with(TemporalAdjusters.dayOfWeekInMonth(2,DayOfWeek.SUNDAY));LocalDate saturday=march.minusDays(1);LocalTime time=LocalTime.of(2,30);
   JSONObject initial=ReminderTestAccess.schedule(context(),id,"DST fixture","",saturday.atTime(time).atZone(z).toInstant().toEpochMilli(),rule("daily",zone,saturday,time));
   String old=initial.getString("occurrenceId");ReminderTestAccess.decide(context(),id,old,"done");JSONObject gap=ReminderTestAccess.read(context(),id);
   assertEquals("Future gap uses first valid time, not 03:30 normalization",march.atTime(3,0).atZone(z).toInstant().toEpochMilli(),gap.getLong("dueAt"));
   LocalDate friday=march.minusDays(2);JSONObject edited=ReminderTestAccess.schedule(context(),id,"Weekday fixture","",friday.atTime(9,0).atZone(z).toInstant().toEpochMilli(),rule("weekdays",zone,friday,LocalTime.of(9,0)));
   assertEquals("Old edit revision cannot affect the new series","stale",ReminderTestAccess.decide(context(),id,gap.getString("occurrenceId"),"done").getString("status"));
   ReminderTestAccess.decide(context(),id,edited.getString("occurrenceId"),"done");assertEquals(march.plusDays(1).toString(),ReminderTestAccess.read(context(),id).getJSONObject("recurrence").getString("date"));
   JSONObject weekly=ReminderTestAccess.schedule(context(),id,"Weekly fixture","",friday.atTime(9,0).atZone(z).toInstant().toEpochMilli(),rule("weekly",zone,friday,LocalTime.of(9,0)));
   ReminderTestAccess.decide(context(),id,weekly.getString("occurrenceId"),"done");assertEquals(friday.plusDays(7).toString(),ReminderTestAccess.read(context(),id).getJSONObject("recurrence").getString("date"));
   LocalDate fold=LocalDate.of(march.getYear(),11,1).with(TemporalAdjusters.firstInMonth(DayOfWeek.SUNDAY));LocalTime folded=LocalTime.of(1,30);
   long earlier=fold.atTime(5,30).toInstant(ZoneOffset.UTC).toEpochMilli();
   JSONObject foldedRow=ReminderTestAccess.schedule(context(),id,"Fold fixture","",earlier,rule("daily",zone,fold,folded));assertEquals(earlier,foldedRow.getLong("dueAt"));
   try{ReminderTestAccess.schedule(context(),id,"Invalid later fold","",earlier+3600000L,rule("daily",zone,fold,folded));fail("Later fold must not silently select a second occurrence");}catch(IllegalArgumentException expected){assertEquals(foldedRow.toString(),ReminderTestAccess.read(context(),id).toString());}
   try{ReminderTestAccess.schedule(context(),id,"Invalid first gap","",march.atTime(3,30).atZone(z).toInstant().toEpochMilli(),rule("daily",zone,march,time));fail("Initial missing wall time must be rejected");}catch(IllegalArgumentException expected){assertEquals(foldedRow.toString(),ReminderTestAccess.read(context(),id).toString());}
  }finally{clean(id);}
 }
}
