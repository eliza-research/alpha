package ai.eliza.plugins.reminders;

import android.app.AlarmManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.*;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.UUID;
import org.json.*;
import static org.junit.Assert.*;

/** Real isolated preference transactions and reminder engine; never touches production rows or tap routes. */
public final class ReminderDeletionJournalFixture {
 public static final class Receiver extends BroadcastReceiver{public void onReceive(Context c,Intent i){}}
 private ReminderConfiguration config(String id){return new ReminderConfiguration(id+"_envelope",id+"_legacy",id+"_taps",id+"_channel","Undo fixture","Isolated Undo fixture","Fixture",id+".remind",id+".decide",id+".open","fixture:"+id+"/alarm/","fixture:"+id+"/decision/","fixture:"+id+"/tap/","id","occurrence","decision",id+":",Receiver.class,android.app.Activity.class);}
 private JSONObject clock(String boot,long elapsed)throws Exception{return new JSONObject().put("continuity",boot).put("elapsed",elapsed).put("wall",1000000);}
 private final ReminderTestAccess.Recording secure=new ReminderTestAccess.Recording();
 private JSONObject row()throws Exception{return new JSONObject().put("id","one").put("title","Synthetic reminder").put("body","").put("status","scheduled").put("at",System.currentTimeMillis()-1000).put("createdAt",1).put("occurrenceId","original_occurrence");}
 private Context notifying(){
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  if(android.os.Build.VERSION.SDK_INT>=33)InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(c.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
  return c;
 }
 private boolean posted(Context c,ReminderConfiguration config){for(android.service.notification.StatusBarNotification n:c.getSystemService(NotificationManager.class).getActiveNotifications())if(config.notificationTag("one").equals(n.getTag()))return true;return false;}
 /** Drop alarm PendingIntents the store's own cancellation created, so only a later arm() can bring one back. */
 private void dropAlarms(Context c,ReminderConfiguration config){for(String occurrence:new String[]{"original_occurrence",null}){PendingIntent alarm=ReminderTestAccess.alarm(c,config,"one",occurrence);if(alarm!=null){c.getSystemService(AlarmManager.class).cancel(alarm);alarm.cancel();}}}
 /** After Undo the original occurrence is armed again and its delivery posts a notice with a saved tap route. */
 private void assertAlertReturns(Context c,ReminderConfiguration config,ReminderStore store)throws Exception{
  assertNotNull("Undo re-arms the original occurrence",ReminderTestAccess.alarm(c,config,"one","original_occurrence"));
  store.deliver(c,"one","original_occurrence");
  assertEquals("posted",store.read(c,"one").getString("status"));assertEquals("original_occurrence",store.read(c,"one").getString("occurrenceId"));
  assertNotNull("Delivery saved a tap route",secure.read(config.tapSlot));assertTrue(posted(c,config));
 }
 private void cleanup(Context c,ReminderConfiguration config){
  dropAlarms(c,config);c.getSystemService(NotificationManager.class).cancel(config.notificationTag("one"),0);
  c.getSystemService(NotificationManager.class).deleteNotificationChannel(config.channelId);c.getSystemService(NotificationManager.class).deleteNotificationChannel(config.dueChannelId());
  c.deleteSharedPreferences(config.envelopeName);c.deleteSharedPreferences(config.legacyName);c.deleteSharedPreferences(config.bootMarkerName());
 }
 private void seed(Context c,ReminderConfiguration config,JSONObject row)throws Exception{assertTrue(c.getSharedPreferences(config.envelopeName,0).edit().putString("envelope",new JSONObject().put("version",1).put("source","original_source").put("records",new JSONObject().put("one",row.toString())).put("operations",new JSONObject()).toString()).commit());}
 // Restoring a fresh store creates both channels on the real NotificationManager; remove them with the preference files.
 private void cleanup(Context c,ReminderConfiguration config){c.deleteSharedPreferences(config.envelopeName);c.deleteSharedPreferences(config.legacyName);c.deleteSharedPreferences(config.bootMarkerName());NotificationManager manager=c.getSystemService(NotificationManager.class);manager.deleteNotificationChannel(config.channelId);manager.deleteNotificationChannel(config.dueChannelId());}
 public void persistedSuspensionBlocksDueDeliveryAndUndoKeepsOriginalOccurrence()throws Exception{
  Context c=notifying();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);JSONObject original=row();
  try{
   seed(c,config,original);ReminderStore store=new ReminderStore(config,secure);store.channel(c);assertTrue("Enable notifications for this app before this test",store.allowed(c));JSONObject selected=store.selected(c,"one");
   store.stageDeletion(c,"delete_one","manual-installation",selected,clock("boot",100));
   // A fresh store simulates loss of all in-process state while durable data remains.
   ReminderStore reopened=new ReminderStore(config,secure);reopened.deliver(c,"one","original_occurrence");reopened.restore(c);
   assertEquals("scheduled",reopened.read(c,"one").getString("status"));assertEquals("delete_one",reopened.read(c,"one").getString("pendingDeletion"));
   assertEquals("No notification tap is created while suspended",0,secure.writes());assertFalse(posted(c,config));
   dropAlarms(c,config);assertNull(ReminderTestAccess.alarm(c,config,"one","original_occurrence"));
   JSONObject undone=reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",9999),true);assertEquals("undone",undone.getString("phase"));
   assertEquals(original.toString(),reopened.read(c,"one").toString());assertEquals(selected.toString(),reopened.selected(c,"one").toString());
   assertEquals("undone",reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",20000),false).getString("phase"));
   assertAlertReturns(c,config,reopened);
  }finally{cleanup(c,config);}
 }
 public void undoOfPostedReminderPostsItAgain()throws Exception{
  Context c=notifying();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);JSONObject original=row().put("status","posted").put("postedAt",System.currentTimeMillis()-500);
  try{
   seed(c,config,original);ReminderStore store=new ReminderStore(config,secure);store.channel(c);assertTrue("Enable notifications for this app before this test",store.allowed(c));
   store.stageDeletion(c,"delete_one","manual-installation",store.selected(c,"one"),clock("boot",100));assertFalse(posted(c,config));assertEquals(0,secure.writes());
   assertEquals("undone",store.settleDeletion(c,"delete_one","manual-installation",clock("boot",9999),true).getString("phase"));
   assertEquals(original.toString(),store.read(c,"one").toString());
   assertNotNull("Undo saved a tap route for the re-posted notice",secure.read(config.tapSlot));assertTrue("Undo re-posts the notice",posted(c,config));
  }finally{cleanup(c,config);}
 }
 public void undoFromPausedDeletionReArmsTheAlert()throws Exception{
  Context c=notifying();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);JSONObject original=row();
  try{
   seed(c,config,original);ReminderStore store=new ReminderStore(config,secure);store.channel(c);assertTrue("Enable notifications for this app before this test",store.allowed(c));
   store.stageDeletion(c,"delete_one","manual-installation",store.selected(c,"one"),clock("boot",100));
   store.pauseDeletion(c,"delete_one","manual-installation","review");assertEquals("paused",store.pendingDeletions(c).getJSONObject(0).getString("phase"));
   dropAlarms(c,config);assertNull(ReminderTestAccess.alarm(c,config,"one","original_occurrence"));
   // A paused deletion stays undoable after its window.
   assertEquals("undone",store.settleDeletion(c,"delete_one","manual-installation",clock("boot",90000),true).getString("phase"));
   assertEquals(original.toString(),store.read(c,"one").toString());
   assertAlertReturns(c,config,store);
  }finally{cleanup(c,config);}
 }
 public void expiryIsSingleWinnerAndChangedBootRequiresReview()throws Exception{
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);
  try{
   seed(c,config,row());ReminderStore store=new ReminderStore(config,secure);store.stageDeletion(c,"delete_one","manual-installation",store.selected(c,"one"),clock("boot",100));
   try{store.settleDeletion(c,"delete_one","manual-installation",clock("new-boot",90000),false);fail("Unknown clock dispatched deletion");}catch(IllegalStateException expected){}
   try{store.settleDeletion(c,"delete_one","other-owner",clock("boot",10100),false);fail("Other owner dispatched deletion");}catch(IllegalArgumentException expected){}
   ReminderStore reopened=new ReminderStore(config,secure);assertEquals("deleted",reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",10100),false).getString("phase"));
   assertEquals("deleted",reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",10101),true).getString("phase"));assertEquals("cancelled",reopened.read(c,"one").getString("status"));
  }finally{cleanup(c,config);}
 }
}
