package ai.alphacompute.alphaphone;
import ai.eliza.plugins.reminders.ReminderLifecycleTestAccess;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Patch 0040: stable refusals, once-per-boot re-post, due channel and undated to-dos. Disposable fixtures only. */
@RunWith(AndroidJUnit4.class)
public class ReminderLifecycleInstrumentedTest {
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private NotificationManager manager(){return context().getSystemService(NotificationManager.class);}
 private StatusBarNotification notification(String id){for(StatusBarNotification n:manager().getActiveNotifications())if(id.equals(n.getTag()))return n;return null;}
 private void grant(){InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);}
 private void clean(String id)throws Exception{ReminderTestAccess.cancel(context(),id);assertTrue(new ReminderTestAccess.Envelope(context()).records().edit().remove(id).commit());}
 private JSONObject find(JSONArray rows,String id)throws Exception{for(int i=0;i<rows.length();i++)if(id.equals(rows.getJSONObject(i).getString("id")))return rows.getJSONObject(i);return null;}

 @Test public void dueRemindersUseASeparateHighImportanceChannel()throws Exception{
  Context c=context();ReminderTestAccess.channel(c);
  NotificationChannel due=manager().getNotificationChannel(ReminderLifecycleTestAccess.dueChannel()),legacy=manager().getNotificationChannel(ReminderTestAccess.CHANNEL);
  assertNotNull("Due channel created",due);assertNotNull("Configured channel kept for compatibility",legacy);
  assertNotEquals(legacy.getId(),due.getId());
  // A blocked configured channel migrates as blocked; otherwise due reminders are heads-up.
  if(legacy.getImportance()!=NotificationManager.IMPORTANCE_NONE)assertEquals(NotificationManager.IMPORTANCE_HIGH,due.getImportance());
 }

 @Test public void fullStoreRefusesWithStorageFullBeforeAnyWrite()throws Exception{
  Context base=context();String prefix="full_"+UUID.randomUUID().toString().replace("-","");
  Context c=new ContextWrapper(base){@Override public SharedPreferences getSharedPreferences(String name,int mode){return super.getSharedPreferences(name.equals("alpha-local-reminders-v1")||name.equals("alpha-reminder-envelope-v1")?prefix+"_"+name:name,mode);}};
  ReminderLifecycleTestAccess.Isolated store=new ReminderLifecycleTestAccess.Isolated(c);ArrayList<String> ids=new ArrayList<>();long future=System.currentTimeMillis()+86400000L;
  try{
   for(int i=0;i<250;i++){String id=prefix+"_"+i;ids.add(id);store.schedule(c,id,"Full fixture "+i,future+i*1000L);}
   String refused=prefix+"_refused";
   try{store.schedule(c,refused,"Refused",future);fail("Full store accepted a reminder");}catch(IllegalArgumentException full){assertTrue("Stable storage-full refusal",ReminderLifecycleTestAccess.storageFull(full));}
   try{store.saveTodo(c,refused,"Refused to-do");fail("Full store accepted a to-do");}catch(IllegalArgumentException full){assertTrue(ReminderLifecycleTestAccess.storageFull(full));}
   assertNull("Refusal leaves the ID absent",store.read(c,refused));
  }finally{
   for(String id:ids)store.cancel(c,id);
   assertTrue(base.getSharedPreferences(prefix+"_alpha-reminder-envelope-v1",0).edit().clear().commit());assertTrue(base.getSharedPreferences(prefix+"_alpha-local-reminders-v1",0).edit().clear().commit());
  }
 }

 @Test public void undatedTodoHasNoInstantOrAlarmAndCompletesAndReopens()throws Exception{
  Context c=context();String id="todo_"+UUID.randomUUID();
  try{
   JSONObject saved=ReminderLifecycleTestAccess.saveTodo(c,id,"Undated fixture "+id,"");
   assertEquals("todo",saved.getString("status"));assertTrue(saved.getBoolean("undated"));assertFalse("No instant",saved.has("at"));assertFalse(saved.has("dueAt"));assertEquals("none",saved.getString("mode"));
   assertEquals("Retried save is idempotent",saved.toString(),ReminderLifecycleTestAccess.saveTodo(c,id,"Undated fixture "+id,"").toString());
   try{ReminderLifecycleTestAccess.saveTodo(c,id,"Different text","");fail("Existing ID overwritten");}catch(IllegalArgumentException expected){}
   Intent alarm=new Intent(c,ReminderReceiver.class).setAction(AlphaReminders.CONFIGURATION.remindAction).setData(Uri.parse(AlphaReminders.CONFIGURATION.alarmUriPrefix+id+"/"+saved.getString("occurrenceId")));
   assertNull("No AlarmManager route",PendingIntent.getBroadcast(c,0,alarm,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE));
   // Notification decisions never apply to a to-do: Snooze would otherwise arm an alarm.
   for(String action:new String[]{"snooze","done"})try{ReminderTestAccess.decide(c,id,saved.getString("occurrenceId"),action);fail("reminderDecision changed a to-do: "+action);}catch(IllegalArgumentException expected){}
   assertEquals("Refused decisions leave the to-do unchanged",saved.toString(),ReminderTestAccess.read(c,id).toString());
   assertNull("No AlarmManager route after refused Snooze",PendingIntent.getBroadcast(c,0,alarm,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE));
   ReminderTestAccess.restore(c);assertNull("Restore never posts a to-do",notification(id));
   JSONObject listed=find(ReminderTestAccess.list(c),id);assertNotNull(listed);assertFalse(listed.has("at"));
   JSONObject target=ReminderTestAccess.selected(c,id);
   try{ReminderTestAccess.operate(c,UUID.randomUUID().toString(),ReminderTestAccess.digest("x"),new JSONObject().put("type","reminder_complete").put("target",target));fail("Reviewed operation changed a to-do");}catch(IllegalArgumentException expected){}
   JSONObject done=ReminderLifecycleTestAccess.todoDecision(c,target,"done");assertEquals("completed",done.getString("status"));
   try{ReminderLifecycleTestAccess.todoDecision(c,target,"reopen");fail("Stale target accepted");}catch(IllegalArgumentException expected){}
   JSONObject reopened=ReminderLifecycleTestAccess.todoDecision(c,done.getJSONObject("target"),"reopen");assertEquals("todo",reopened.getString("status"));
   assertNotEquals("Reopen starts a new occurrence",saved.getString("occurrenceId"),ReminderTestAccess.read(c,id).getString("occurrenceId"));
   assertEquals(1,ReminderTestAccess.read(c,id).getJSONArray("history").length());
   assertEquals("cancelled",ReminderLifecycleTestAccess.todoDecision(c,reopened.getJSONObject("target"),"cancel").getString("status"));
  }finally{clean(id);}
 }

 @Test public void rebootWithChangedBootIdRepostsPostedOnceWithSameRouteAndNoRecurrenceAdvance()throws Exception{
  Context c=context();grant();ReminderTestAccess.channel(c);
  org.junit.Assume.assumeTrue("Notifications must be enabled for the re-post scenario",ReminderTestAccess.allowed(c));
  String once="repost_"+UUID.randomUUID(),daily="repost_daily_"+UUID.randomUUID(),realBoot=ReminderLifecycleTestAccess.bootId(c);
  try{
   java.time.ZoneId zone=java.time.ZoneId.systemDefault();java.time.ZonedDateTime next=java.time.ZonedDateTime.now(zone).plusMinutes(1).withSecond(0).withNano(0);if(next.toInstant().toEpochMilli()-System.currentTimeMillis()<5000)next=next.plusMinutes(1);
   long dueAt=next.toInstant().toEpochMilli();
   ReminderTestAccess.schedule(c,once,"Re-post fixture "+once,"Disposable",System.currentTimeMillis()+1500);
   ReminderTestAccess.schedule(c,daily,"Re-post daily fixture "+daily,"Disposable",dueAt,new JSONObject().put("rule","daily").put("zone",zone.getId()).put("date",next.toLocalDate().toString()).put("time",next.toLocalTime().toString()).put("leadMinutes",0));
   while(System.currentTimeMillis()<dueAt+500)SystemClock.sleep(250);
   for(String id:new String[]{once,daily}){JSONObject row=ReminderTestAccess.read(c,id);ReminderTestAccess.deliver(c,id,row.getString("occurrenceId"));assertEquals("posted",ReminderTestAccess.read(c,id).getString("status"));}
   StatusBarNotification first=notification(once),firstDaily=notification(daily);assertNotNull(first);assertNotNull(firstDaily);
   assertEquals("Due channel",ReminderLifecycleTestAccess.dueChannel(),first.getNotification().getChannelId());
   String before=ReminderTestAccess.read(c,once).toString(),beforeDaily=ReminderTestAccess.read(c,daily).toString();
   JSONObject targetBefore=ReminderTestAccess.selected(c,once);
   // Android clears notifications on reboot; simulate that boundary, then restore under a new boot ID.
   manager().cancel(once,0);manager().cancel(daily,0);assertNull(notification(once));
   String boot="test-boot-"+UUID.randomUUID();
   ReminderLifecycleTestAccess.restore(c,boot);
   StatusBarNotification again=notification(once),againDaily=notification(daily);assertNotNull("Posted reminder re-posted after reboot",again);assertNotNull(againDaily);
   assertEquals("Same tap route",first.getNotification().contentIntent,again.getNotification().contentIntent);
   // Done, Snooze and the configured question action (AlphaReminders: "Ask Alpha", unlock required).
   assertEquals("Done action unchanged",ReminderNotificationActions.intent(first,ReminderNotificationActions.DONE),ReminderNotificationActions.intent(again,ReminderNotificationActions.DONE));
   assertEquals("Snooze action unchanged",ReminderNotificationActions.intent(first,ReminderNotificationActions.SNOOZE),ReminderNotificationActions.intent(again,ReminderNotificationActions.SNOOZE));
   assertEquals("Question route unchanged",ReminderNotificationActions.intent(first,ReminderNotificationActions.ASK),ReminderNotificationActions.intent(again,ReminderNotificationActions.ASK));
   if(android.os.Build.VERSION.SDK_INT>=31)assertTrue("Ask requires unlock",ReminderNotificationActions.action(again,ReminderNotificationActions.ASK).isAuthenticationRequired());
   assertEquals("Record, occurrence and target unchanged",before,ReminderTestAccess.read(c,once).toString());
   assertEquals("Recurrence not advanced",beforeDaily,ReminderTestAccess.read(c,daily).toString());
   assertTrue(ReminderTestAccess.Taps.same(targetBefore,ReminderTestAccess.selected(c,once)));
   manager().cancel(once,0);ReminderLifecycleTestAccess.restore(c,boot);assertNull("Only once per boot",notification(once));
   ReminderLifecycleTestAccess.restore(c,boot+"-next");assertNotNull("Next boot re-posts again",notification(once));
  }finally{clean(once);clean(daily);ReminderLifecycleTestAccess.markBoot(c,realBoot);}
 }
}
