package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Runner coordinates real permission revocation (which can kill the app) and emulator reboot. */
@RunWith(AndroidJUnit4.class)
public class ReminderRecoveryInstrumentedTest {
 private static final String PREFS="alpha-reminder-recovery-test";
 private static void until(String condition)throws Exception {for(int i=0;i<150;i++){if("true".equals(WebViewTestDriver.evaluate("Boolean("+condition+")")))return;SystemClock.sleep(100);}fail("Reminder UI condition missing: "+condition);}
 private static void click(String label)throws Exception {String target="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(target);WebViewTestDriver.evaluate(target+".click()");}
 private static JSONObject awaitStatus(Context c,String id,String status)throws Exception {for(int i=0;i<140;i++){JSONObject value=ReminderTestAccess.read(c,id);if(value!=null&&status.equals(value.optString("status")))return value;SystemClock.sleep(500);}throw new AssertionError("Reminder did not reach "+status);}
 private static void open(Context c,String id){c.startActivity(new Intent(c,MainActivity.class).setAction("ai.elizaresearch.alphaphone.OPEN_REMINDER").putExtra(ReminderTestAccess.OPEN_ID,id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP));}
 @Test public void permissionAndRebootPhase()throws Exception {
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  android.content.SharedPreferences state=c.getSharedPreferences(PREFS,Context.MODE_PRIVATE);
  String phase=InstrumentationRegistry.getArguments().getString("reminderPhase","");
  // Not a standalone test: the runner must perform actual external permission/reboot boundaries.
  org.junit.Assume.assumeTrue("Use test-reminder-recovery.mjs",!phase.isEmpty());
  String id=state.getString("id",null);
  if(phase.equals("prepare")){
   assertNull("Previous fixture requires cleanup",id);id="recovery_"+java.util.UUID.randomUUID();assertTrue(state.edit().putString("id",id).putInt("pid",android.os.Process.myPid()).commit());
   ReminderTestAccess.channel(c);assertTrue(ReminderTestAccess.allowed(c));ReminderTestAccess.schedule(c,id,"Recovery reminder "+id,"Disposable native lifecycle fixture",System.currentTimeMillis()+20000);
  }else if(phase.equals("denied")){
   assertNotNull(id);assertNotEquals("Permission boundary starts a new process",state.getInt("pid",0),android.os.Process.myPid());assertFalse(ReminderTestAccess.allowed(c));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));awaitStatus(c,id,"permission-denied");
    // Real reminder intent forces a fresh native list and opens the retained failed reminder.
    open(c,id);until("document.querySelector('button[aria-label=\"Edit event\"]')&&document.body.innerText.includes('Not delivered · notifications were disabled')");
    scenario.recreate();AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));open(c,id);until("document.body.innerText.includes('Not delivered · notifications were disabled')");
   }
  }else if(phase.equals("retry")){
   assertNotNull(id);assertTrue(ReminderTestAccess.allowed(c));assertEquals("Granting permission must not silently redeliver", "permission-denied",ReminderTestAccess.read(c,id).getString("status"));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));open(c,id);until("document.body.innerText.includes('Not delivered · notifications were disabled')");click("Edit event");click("Tomorrow");click("Save event");
    JSONObject saved=awaitStatus(c,id,"scheduled");assertTrue(saved.getLong("at")>System.currentTimeMillis());assertEquals("Same reminder is rescheduled",id,saved.getString("id"));
   }
  }else if(phase.equals("prepare-reboot")){
   assertNotNull(id);long at=System.currentTimeMillis()+20000;
   // The UI retry saved explicit timing; an intentional fixture edit must carry it too.
   ReminderTestAccess.schedule(c,id,"Reboot reminder "+id,"Disposable reboot fixture",at,null,new JSONObject().put("dueAt",at).put("alertMinutes",0));
   // Damaged unrelated data must not prevent recovery/listing of the actual fixture.
   assertTrue(new ReminderTestAccess.Envelope(c).records().edit().putString(id+"_damaged","invalid-json").commit());
  }else if(phase.equals("verify-reboot")){
   fail("Verify reboot externally: starting instrumentation force-stops the target and can cancel restored alarms");
  }else if(phase.equals("cleanup")){
   if(id!=null){ReminderTestAccess.cancel(c,id);assertTrue(new ReminderTestAccess.Envelope(c).records().edit().remove(id).remove(id+"_damaged").commit());}assertTrue(state.edit().clear().commit());
  }else fail("Unknown phase");
 }
}
