package ai.eliza.plugins.reminders;

import android.app.NotificationManager;
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
 private SecureStringStore secure=new SecureStringStore(){public String identity(){return "isolated-deletion-fixture";}public String read(String key){return null;}public void write(String key,String value){throw new AssertionError("No notification tap must be created while suspended");}};
 private JSONObject row()throws Exception{return new JSONObject().put("id","one").put("title","Synthetic reminder").put("body","").put("status","scheduled").put("at",System.currentTimeMillis()-1000).put("createdAt",1).put("occurrenceId","original_occurrence");}
 private void seed(Context c,ReminderConfiguration config,JSONObject row)throws Exception{assertTrue(c.getSharedPreferences(config.envelopeName,0).edit().putString("envelope",new JSONObject().put("version",1).put("source","original_source").put("records",new JSONObject().put("one",row.toString())).put("operations",new JSONObject()).toString()).commit());}
 // Restoring a fresh store creates both channels on the real NotificationManager; remove them with the preference files.
 private void cleanup(Context c,ReminderConfiguration config){c.deleteSharedPreferences(config.envelopeName);c.deleteSharedPreferences(config.legacyName);c.deleteSharedPreferences(config.bootMarkerName());NotificationManager manager=c.getSystemService(NotificationManager.class);manager.deleteNotificationChannel(config.channelId);manager.deleteNotificationChannel(config.dueChannelId());}
 public void persistedSuspensionBlocksDueDeliveryAndUndoKeepsOriginalOccurrence()throws Exception{
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();String id="undo_"+UUID.randomUUID().toString().replace("-","");ReminderConfiguration config=config(id);JSONObject original=row();
  try{
   seed(c,config,original);ReminderStore store=new ReminderStore(config,secure);JSONObject selected=store.selected(c,"one");
   store.stageDeletion(c,"delete_one","manual-installation",selected,clock("boot",100));
   // A fresh store simulates loss of all in-process state while durable data remains.
   ReminderStore reopened=new ReminderStore(config,secure);reopened.deliver(c,"one","original_occurrence");reopened.restore(c);
   assertEquals("scheduled",reopened.read(c,"one").getString("status"));assertEquals("delete_one",reopened.read(c,"one").getString("pendingDeletion"));
   JSONObject undone=reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",9999),true);assertEquals("undone",undone.getString("phase"));
   assertEquals(original.toString(),reopened.read(c,"one").toString());assertEquals(selected.toString(),reopened.selected(c,"one").toString());
   assertEquals("undone",reopened.settleDeletion(c,"delete_one","manual-installation",clock("boot",20000),false).getString("phase"));
   reopened.cancel(c,"one");
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
