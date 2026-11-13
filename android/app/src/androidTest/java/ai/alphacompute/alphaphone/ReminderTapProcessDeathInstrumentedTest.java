package ai.alphacompute.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.util.*;
import ai.alphacompute.alphaphone.WorkflowNoticeProcessDeathInstrumentedTest.Identity;
import static ai.alphacompute.alphaphone.WorkflowNoticeProcessDeathInstrumentedTest.awaitMain;
import static ai.alphacompute.alphaphone.WorkflowNoticeProcessDeathInstrumentedTest.killMainWithoutTasks;
import static ai.alphacompute.alphaphone.WorkflowNoticeProcessDeathInstrumentedTest.sendOriginalTap;
import static org.junit.Assert.*;

/** Runs only in the separate instrumentation host; main dies while the test remains alive. The death
 * boundary (Identity, killMainWithoutTasks, sendOriginalTap) is shared with WorkflowNoticeProcessDeathInstrumentedTest. */
public final class ReminderTapProcessDeathInstrumentedTest {
 private static final String APP="ai.alphacompute.alphaphone";
 private static StatusBarNotification notice(NotificationManager manager,String id){
  for(StatusBarNotification row:manager.getActiveNotifications())if(id.equals(row.getTag())&&row.getId()==0)return row;
  throw new AssertionError("Original reminder notification absent");
 }
 private static android.view.accessibility.AccessibilityNodeInfo visibleNode(android.view.accessibility.AccessibilityNodeInfo node,String label){
  if(node==null)return null;
  if(node.isVisibleToUser()&&(label.contentEquals(node.getText()==null?"":node.getText())||label.contentEquals(node.getContentDescription()==null?"":node.getContentDescription())))return node;
  for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo found=visibleNode(node.getChild(i),label);if(found!=null)return found;}
  return null;
 }
 private static android.view.accessibility.AccessibilityNodeInfo awaitVisible(String label)throws Exception{
  long end=SystemClock.elapsedRealtime()+20000;
  do{android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   if(root!=null&&APP.contentEquals(root.getPackageName())){android.view.accessibility.AccessibilityNodeInfo found=visibleNode(root,label);if(found!=null)return found;}
   SystemClock.sleep(100);
  }while(SystemClock.elapsedRealtime()<end);
  throw new AssertionError("Reminder recovery control unavailable: "+label);
 }
 @Test public void capturedReminderTapSurvivesMainDeathWithoutAnotherNotificationIntent()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated reminder process-death campaign","1".equals(InstrumentationRegistry.getArguments().getString("reminderTapProcessDeath")));
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue(android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  AlphaCredentialStore storage=new AlphaCredentialStore(context);assertNull("Fresh tap ledger required",storage.readCredentialSlot(ReminderTestAccess.Taps.SLOT));
  ReminderTestAccess.Taps taps=new ReminderTestAccess.Taps(context);NotificationManager manager=context.getSystemService(NotificationManager.class);
  String id="tap_death_"+UUID.randomUUID();
  try {
   ReminderTestAccess.channel(context);assertTrue(ReminderTestAccess.allowed(context));
   long at=System.currentTimeMillis()+1500;
   JSONObject scheduled=ReminderTestAccess.schedule(context,id,"Retained reminder tap","Original OS notification body",at,null);
   while(System.currentTimeMillis()<at)SystemClock.sleep(25);
   // Delivery uses the production due-time/permission/post/persistence path once.
   ReminderTestAccess.deliver(context,id,scheduled.getString("occurrenceId"));
   assertEquals("posted",ReminderTestAccess.read(context,id).getString("status"));
   StatusBarNotification original=null;long noticeEnd=SystemClock.elapsedRealtime()+5000;
   do{try{original=notice(manager,id);break;}catch(AssertionError notYet){SystemClock.sleep(50);}}while(SystemClock.elapsedRealtime()<noticeEnd);
   assertNotNull(original);PendingIntent originalIntent=original.getNotification().contentIntent;assertNotNull(originalIntent);
   assertEquals(0,original.getNotification().flags&Notification.FLAG_AUTO_CANCEL);
   assertFalse(taps.pending().has("token"));
   // Exactly one original OS tap. No second tap/intent is sent after capture.
   sendOriginalTap(context,originalIntent);Identity before=awaitMain(context);
   JSONObject captured=null;long captureEnd=SystemClock.elapsedRealtime()+15000;
   do{captured=taps.pending();if(captured.has("token"))break;SystemClock.sleep(25);}while(SystemClock.elapsedRealtime()<captureEnd);
   assertTrue("Main must durably capture the original tap",captured.has("token"));assertTrue(captured.getBoolean("retained"));
   assertTrue(ReminderTestAccess.Taps.same(ReminderTestAccess.selected(context,id),captured.getJSONObject("target")));
   String token=captured.getString("token"),committed=storage.readCredentialSlot(ReminderTestAccess.Taps.SLOT);
   killMainWithoutTasks(context,before);
   assertEquals(committed,storage.readCredentialSlot(ReminderTestAccess.Taps.SLOT));
   StatusBarNotification stillPosted=notice(manager,id);assertEquals(original.getKey(),stillPosted.getKey());assertEquals(original.getPostTime(),stillPosted.getPostTime());assertEquals(originalIntent,stillPosted.getNotification().contentIntent);
   // Normal app launch contains no reminder URI/extras: durable storage is the only route.
   Intent normal=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(normal);assertNull(normal.getData());assertFalse(normal.hasExtra(ReminderTestAccess.OPEN_ID));assertFalse(normal.hasExtra(ReminderTestAccess.OCCURRENCE));
   context.startActivity(normal);Identity after=awaitMain(context);assertTrue(before.pid!=after.pid||!before.start.equals(after.start));
   JSONObject recovered=new ReminderTestAccess.Taps(context).pending();assertEquals(token,recovered.getString("token"));assertTrue(recovered.getBoolean("retained"));assertTrue(ReminderTestAccess.Taps.same(captured.getJSONObject("target"),recovered.getJSONObject("target")));
   assertEquals(committed,storage.readCredentialSlot(ReminderTestAccess.Taps.SLOT));
   assertEquals(original.getPostTime(),notice(manager,id).getPostTime());
   // No chooser opens at start (decision P-43: the resident starts by itself), so the captured
   // route must open the reminder with no user action at all.
   awaitVisible("Retained reminder tap");awaitVisible("Complete reminder occurrence");
   long consumedEnd=SystemClock.elapsedRealtime()+10000;boolean consumed=false;
   do{JSONObject rows=new JSONObject(storage.readCredentialSlot(ReminderTestAccess.Taps.SLOT));consumed="consumed".equals(rows.getJSONObject(token).getString("state"));if(!consumed)SystemClock.sleep(50);}while(!consumed&&SystemClock.elapsedRealtime()<consumedEnd);
   assertTrue("Exact captured route must be acknowledged after detail render",consumed);
   assertFalse(new ReminderTestAccess.Taps(context).pending().has("token"));
   assertEquals("Opening detail must not complete the reminder","posted",ReminderTestAccess.read(context,id).getString("status"));
   assertTrue(ReminderTestAccess.Taps.same(captured.getJSONObject("target"),ReminderTestAccess.selected(context,id)));
   android.os.Bundle evidence=new android.os.Bundle();evidence.putString("reminderTapProcessDeath",new JSONObject().put("beforePid",before.pid).put("beforeStart",before.start).put("afterPid",after.pid).put("afterStart",after.start).put("uid",after.uid).put("postTime",original.getPostTime()).put("notificationSends",1).put("detailVisible",true).put("routeConsumed",true).put("recoveryLaunch","launcher-without-reminder-data").toString());InstrumentationRegistry.getInstrumentation().addResults(evidence);
  }finally{manager.cancel(id,0);/* Fresh-user supervisor owns all durable cleanup. */}
 }
}
