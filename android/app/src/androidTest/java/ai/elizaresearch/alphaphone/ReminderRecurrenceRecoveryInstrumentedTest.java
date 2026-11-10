package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.ZonedDateTime;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** External runner owns actual permission changes and reboot; no simulated recovery broadcast. */
@RunWith(AndroidJUnit4.class)
public class ReminderRecurrenceRecoveryInstrumentedTest {
 private static final String FIXTURE="alpha-recurring-recovery-test";
 private void until(String expression)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Recurring reminder UI missing: "+expression);}
 private void open(Context c,String id,String occurrence)throws Exception{
  c.startActivity(new Intent(c,MainActivity.class).setAction("ai.elizaresearch.alphaphone.OPEN_REMINDER").putExtra(ReminderTestAccess.OPEN_ID,id).putExtra(ReminderTestAccess.OCCURRENCE,occurrence).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP));
  until("document.body.innerText.includes('Recurring recovery '+"+JSONObject.quote(id)+") && document.querySelector('button[aria-label=\"Complete reminder occurrence\"]')");
 }
 private void click(String label)throws Exception{String q="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(q);WebViewTestDriver.evaluate(q+".click()");}
 private JSONObject schedule(Context c,String id)throws Exception{
  ZonedDateTime date=ZonedDateTime.now().plusMinutes(1).withSecond(0).withNano(0);
  if(date.toInstant().toEpochMilli()-System.currentTimeMillis()<15000)date=date.plusMinutes(1);
  JSONObject rule=new JSONObject().put("rule","daily").put("zone",date.getZone().getId()).put("date",date.toLocalDate().toString()).put("time",date.toLocalTime().toString()).put("leadMinutes",0);
  return ReminderTestAccess.schedule(c,id,"Recurring recovery "+id,"Owned permission and reboot fixture",date.toInstant().toEpochMilli(),rule);
 }
 @Test public void permissionAndActualRebootPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("recurrencePhase","");
  org.junit.Assume.assumeTrue("Use test-reminder-recurrence-recovery.mjs",!phase.isEmpty());
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();SharedPreferences fixture=c.getSharedPreferences(FIXTURE,0);String id=fixture.getString("id",null);
  if(phase.equals("cleanup")){
   if(id!=null){ReminderTestAccess.cancel(c,id);assertTrue(new ReminderTestAccess.Envelope(c).records().edit().remove(id).commit());}assertTrue(fixture.edit().clear().commit());return;
  }
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   if(phase.equals("prepare")){
    assertNull("Previous recurrence fixture requires cleanup",id);id="recurring_recovery_"+UUID.randomUUID();
    assertTrue(fixture.edit().putString("id",id).commit());ReminderTestAccess.channel(c);assertTrue(ReminderTestAccess.allowed(c));JSONObject value=schedule(c,id);
    assertTrue(fixture.edit().putString("occurrenceId",value.getString("occurrenceId")).putString("revision",value.getString("revision")).commit());
   }else{
    assertNotNull(id);String occurrence=fixture.getString("occurrenceId",null);assertNotNull(occurrence);JSONObject before=ReminderTestAccess.read(c,id);
    assertEquals("Same persisted occurrence",occurrence,before.getString("occurrenceId"));assertEquals(0,before.getJSONArray("history").length());
    if(phase.equals("denied")){
     assertFalse(ReminderTestAccess.allowed(c));assertEquals("permission-denied",before.getString("status"));open(c,id,occurrence);
     until("document.body.innerText.includes('Not delivered · notifications were disabled')");scenario.recreate();AppNavigation.liveMode();open(c,id,occurrence);
     assertEquals(before.toString(),ReminderTestAccess.read(c,id).toString());
    }else if(phase.equals("retry")){
     assertTrue(ReminderTestAccess.allowed(c));assertEquals("Grant alone must not resume delivery","permission-denied",before.getString("status"));open(c,id,occurrence);click("Snooze reminder 10 minutes");
     long end=SystemClock.elapsedRealtime()+15000;JSONObject value;
     do{value=ReminderTestAccess.read(c,id);if("scheduled".equals(value.getString("status")))break;SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);
     assertEquals("scheduled",value.getString("status"));assertEquals(occurrence,value.getString("occurrenceId"));assertTrue(value.getLong("at")>System.currentTimeMillis()+580000);assertEquals(0,value.getJSONArray("history").length());
    }else if(phase.equals("prepare-reboot")){
     assertTrue(ReminderTestAccess.allowed(c));JSONObject value=schedule(c,id);assertNotEquals("Explicit schedule edit creates a revision",occurrence,value.getString("occurrenceId"));
     assertTrue(fixture.edit().putString("previousOccurrence",occurrence).putString("occurrenceId",value.getString("occurrenceId")).putString("revision",value.getString("revision")).commit());
    }else if(phase.equals("after-reboot-actions")){
     // Runner already witnessed the real reboot notification before instrumentation.
     assertEquals("posted",before.getString("status"));open(c,id,occurrence);click("Complete reminder occurrence");
     long end=SystemClock.elapsedRealtime()+15000;JSONObject value;
     do{value=ReminderTestAccess.read(c,id);if(!occurrence.equals(value.getString("occurrenceId")))break;SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);
     assertNotEquals(occurrence,value.getString("occurrenceId"));assertEquals(1,value.getJSONArray("history").length());assertEquals(occurrence,value.getJSONArray("history").getJSONObject(0).getString("occurrenceId"));
     assertEquals("stale",ReminderTestAccess.decide(c,id,occurrence,"done").getString("status"));assertEquals("stale",ReminderTestAccess.decide(c,id,occurrence,"snooze").getString("status"));
     assertEquals("stale",ReminderTestAccess.decide(c,id,fixture.getString("previousOccurrence",null),"done").getString("status"));
     assertEquals("Old decisions do not modify next occurrence",value.toString(),ReminderTestAccess.read(c,id).toString());
    }else fail("Unknown recurrence phase");
   }
  }
 }
}
