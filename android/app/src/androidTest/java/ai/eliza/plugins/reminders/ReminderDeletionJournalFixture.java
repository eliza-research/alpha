package ai.eliza.plugins.reminders;

import android.content.*;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.UUID;
import org.json.*;
import static org.junit.Assert.*;

/** Real isolated preference transactions and reminder engine; never touches production rows. */
public final class ReminderDeletionJournalFixture {
 public static final class Receiver extends BroadcastReceiver{public void onReceive(Context c,Intent i){}}
 private ReminderConfiguration config(String id){return new ReminderConfiguration(id+"_envelope",id+"_legacy",id+"_taps",id+"_channel","Undo fixture","Isolated Undo fixture","Fixture",id+".remind",id+".decide",id+".open","fixture:"+id+"/alarm/","fixture:"+id+"/decision/","fixture:"+id+"/tap/","id","occurrence","decision",id+":",Receiver.class,android.app.Activity.class);}
 private JSONObject clock(String boot,long elapsed)throws Exception{return new JSONObject().put("continuity",boot).put("elapsed",elapsed).put("wall",1000000);}
 // Records notification taps: none while suspended, one route when a posted alert returns.
 private final ReminderTestAccess.MemorySecure secure=new ReminderTestAccess.MemorySecure();
 private JSONObject row()throws Exception{return new JSONObject().put("id","one").put("title","Synthetic reminder").put("body","").put("status","scheduled").put("at",System.currentTimeMillis()-1000).put("createdAt",1).put("occurrenceId","original_occurrence");}
 private void seed(Context c,ReminderConfiguration config,JSONObject row)throws Exception{assertTrue(c.getSharedPreferences(config.envelopeName,0).edit().putString("envelope",new JSONObject().put("version",1).put("source","original_source").put("records",new JSONObject().put("one",row.toString())).put("operations",new JSONObject()).toString()).commit());}
 private void grantNotifications(Context c){if(android.os.Build.VERSION.SDK_INT>=33)InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(c.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);}
 /** Drop the PendingIntents cancelAlarm leaves (with and without the occurrence), so only a later arm() can make the alarm exist again. */
 private void forgetAlarm(Context c,ReminderConfiguration config){for(String occurrence:new String[]{"original_occurrence",null}){android.app.PendingIntent alarm=ReminderTestAccess.alarm(c,config,"one",occurrence);if(alarm!=null){c.getSystemService(android.app.AlarmManager.class).cancel(alarm);alarm.cancel();}}assertNull(ReminderTestAccess.alarm(c,config,"one","original_occurrence"));}
 private boolean notified(Context c,ReminderConfiguration config){for(android.service.notification.StatusBarNotification n:c.getSystemService(android.app.NotificationManager.class).getActiveNotifications())if(config.notificationTag("one").equals(n.getTag()))return true;return false;}
 private void clean(Context c,ReminderConfiguration config){
  forgetAlarm(c,config);android.app.NotificationManager manager=c.getSystemService(android.app.NotificationManager.class);manager.cancel(config.notificationTag("one"),0);
  manager.deleteNotificationChannel(config.channelId);manager.deleteNotificationChannel(config.dueChannelId());
  c.deleteSharedPreferences(config.envelopeName);c.deleteSharedPreferences(config.legacyName);c.deleteSharedPreferences(config.bootMarkerName());
 }
 public void persistedSuspensionBlocksDueDeliveryAndUndoKeepsOriginalOccurrence()throws Exception{
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);JSONObject original=row();
  try{
   grantNotifications(c);seed(c,config,original);ReminderStore store=new ReminderStore(config,secure);JSONObject selected=store.selected(c,"one");
   store.stageDeletion(c,"delete_one","manual-installation",selected,clock("boot",100));
   // A fresh store simulates loss of all in-process state while durable data remains.
   ReminderStore reopened=new ReminderStore(config,secure);reopened.deliver(c,"one","original_occurrence");reopened.restore(c);
   assertEquals("scheduled",reopened.read(c,"one").getString("status"));assertEquals("delete_one",reopened.read(c,"one").getString("pendingDeletion"));
   assertEquals("No notification tap while suspended",0,secure.writes());assertFalse(notified(c,config));forgetAlarm(c,config);
   JSONObject undone=reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",9999),true);assertEquals("undone",undone.getString("phase"));
   assertNotNull("Undo re-arms the original occurrence",ReminderTestAccess.alarm(c,config,"one","original_occurrence"));
   assertEquals(original.toString(),reopened.read(c,"one").toString());assertEquals(selected.toString(),reopened.selected(c,"one").toString());
   assertEquals("undone",reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",20000),false).getString("phase"));
   // The re-armed alarm delivers the original occurrence as a real alert.
   assertTrue("Notifications allowed for this fixture",reopened.allowed(c));reopened.deliver(c,"one","original_occurrence");
   assertEquals("posted",reopened.read(c,"one").getString("status"));assertTrue("Posting saved a tap route",secure.writes()>0);assertTrue("Alert posted",notified(c,config));
  }finally{clean(c,config);}
 }
 public void undoOfPostedReminderPostsItAgain()throws Exception{
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);JSONObject original=row().put("status","posted").put("postedAt",System.currentTimeMillis());
  try{
   grantNotifications(c);seed(c,config,original);ReminderStore store=new ReminderStore(config,secure);assertTrue("Notifications allowed for this fixture",store.allowed(c));
   store.stageDeletion(c,"delete_one","manual-installation",store.selected(c,"one"),clock("boot",100));assertFalse(notified(c,config));assertEquals(0,secure.writes());
   assertEquals("undone",store.settleDeletion(c,"delete_one","manual-installation",clock("boot",200),true).getString("phase"));
   assertEquals(original.toString(),store.read(c,"one").toString());assertTrue("Undo posted a tap route",secure.writes()>0);assertTrue("Undo posts the alert again",notified(c,config));
  }finally{clean(c,config);}
 }
 public void undoFromPausedDeletionRearmsTheAlarm()throws Exception{
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);JSONObject original=row();
  try{
   seed(c,config,original);ReminderStore store=new ReminderStore(config,secure);
   store.stageDeletion(c,"delete_one","manual-installation",store.selected(c,"one"),clock("boot",100));store.pauseDeletion(c,"delete_one","manual-installation","review");forgetAlarm(c,config);
   // A paused deletion stays undoable after its window would have expired.
   assertEquals("undone",store.settleDeletion(c,"delete_one","manual-installation",clock("boot",90000),true).getString("phase"));
   assertEquals(original.toString(),store.read(c,"one").toString());assertNotNull("Undo re-arms the original occurrence",ReminderTestAccess.alarm(c,config,"one","original_occurrence"));
  }finally{clean(c,config);}
 }
 public void expiryIsSingleWinnerAndChangedBootRequiresReview()throws Exception{
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);
  try{
   seed(c,config,row());ReminderStore store=new ReminderStore(config,secure);store.stageDeletion(c,"delete_one","manual-installation",store.selected(c,"one"),clock("boot",100));
   try{store.settleDeletion(c,"delete_one","manual-installation",clock("new-boot",90000),false);fail("Unknown clock dispatched deletion");}catch(IllegalStateException expected){}
   try{store.settleDeletion(c,"delete_one","other-owner",clock("boot",10100),false);fail("Other owner dispatched deletion");}catch(IllegalArgumentException expected){}
   ReminderStore reopened=new ReminderStore(config,secure);assertEquals("deleted",reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",10100),false).getString("phase"));
   assertEquals("deleted",reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",10101),true).getString("phase"));assertEquals("cancelled",reopened.read(c,"one").getString("status"));
  }finally{clean(c,config);}
 }
}
