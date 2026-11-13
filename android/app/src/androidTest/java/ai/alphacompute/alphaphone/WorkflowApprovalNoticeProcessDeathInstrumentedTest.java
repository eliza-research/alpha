package ai.alphacompute.alphaphone;

import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.util.*;
import static org.junit.Assert.*;

/** A pending phone-step approval notice across the death of the app's main process. Runs only in the
 * separate instrumentation host (WorkflowNoticeProcessRunner), so main dies while the test stays alive.
 * Test-mocks restores an explicitly synthetic loopback owner through real initialize; the initial post uses the actual main-process bridge, and the repeated succeeded request
 * inspects the same ledger from this helper process; the tap is captured by the restarted main's
 * own AlphaNotifications plugin. Synthetic route: no real account, review or device action.
 * Exact workflow review remains outside this native capture test. All three methods run in
 * scripts/android-workflow-native.ts phase approval-notice-recovery: the first two on the test-mocks
 * archive after a standard-runner prepare run in the same user, the last on the flag-off archive. */
public final class WorkflowApprovalNoticeProcessDeathInstrumentedTest {
 private static final String APP="ai.alphacompute.alphaphone";
 private static List<StatusBarNotification> approvals(NotificationManager manager){
  List<StatusBarNotification> found=new ArrayList<>();
  for(StatusBarNotification row:manager.getActiveNotifications())if(WorkflowNoticePoster.APPROVAL_CHANNEL.equals(row.getNotification().getChannelId()))found.add(row);
  return found;
 }
 /** Exactly one OS notice exists for this approval and no other approval notice does. */
 private static StatusBarNotification notice(NotificationManager manager,String id){
  List<StatusBarNotification> rows=approvals(manager);
  assertEquals("Exactly one approval notice",1,rows.size());StatusBarNotification row=rows.get(0);
  assertEquals("alpha-workflow-"+id,row.getTag());assertEquals(0,row.getId());return row;
 }
 private static void awaitTapCancellation(Context context,WorkflowNoticeTaps taps,String id)throws Exception{
  String token=taps.token(id);assertNotNull(token);Intent launch=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(launch);launch.setAction(WorkflowNoticeTaps.ACTION).setData(android.net.Uri.parse(WorkflowNoticeTaps.PREFIX+token));
  long end=SystemClock.elapsedRealtime()+10000;PendingIntent existing;
  do{existing=PendingIntent.getActivity(context,0,launch,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_NO_CREATE);if(existing==null)return;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);
  fail("Old PendingIntent remains registered after signed-out withdrawal");
 }

 @Test public void productionSignedOutColdStartWithdrawsPersistedSyntheticApproval()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated product cold-start campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNoticeProcessDeath")));
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue(android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);assertTrue("Main absent before native fixture seed",WorkflowNoticeProcessDeathInstrumentedTest.mainPids(context).isEmpty());
  assertNull(store.readCredentialSlot(WorkflowNoticeTaps.OWNER_SLOT));assertNull(store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertNull(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
  NotificationManager manager=context.getSystemService(NotificationManager.class);WorkflowNoticeTaps taps=WorkflowNoticeTapsFactory.create(context);WorkflowNoticeDelivery delivery=WorkflowNoticeTapsFactory.delivery(context);
  String id="approval-"+(UUID.randomUUID().toString()+UUID.randomUUID()).replace("-","");
  JSONObject owner=new JSONObject().put("origin","https://synthetic-owner.invalid").put("ownerId","synthetic-owner").put("agentId",UUID.randomUUID().toString());
  // Native-only fixture seed models an owner persisted by a prior process, never a credential.
  store.writeCredentialSlot(WorkflowNoticeTaps.OWNER_SLOT,new JSONObject().put("owner",owner).toString());
  JSONObject route=new JSONObject(owner.toString()).put("scope","a".repeat(64)).put("workflowId","fixture-flow").put("runId","signedout-product-fixture").put("versionId","fixture-version");
  try{
   long expires=System.currentTimeMillis()+600000,end=SystemClock.elapsedRealtime()+10000;String published;
   do{published=delivery.postApproval(taps,id,"b".repeat(64),route,expires,System.currentTimeMillis());if("succeeded".equals(published))break;assertEquals("unknown",published);SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);
   assertEquals("succeeded",published);PendingIntent original=notice(manager,id).getNotification().contentIntent;
   Intent launch=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(launch);context.startActivity(launch);WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);
   boolean settled=false;end=SystemClock.elapsedRealtime()+20000;
   do{String raw=store.readCredentialSlot(WorkflowNoticeTaps.OWNER_SLOT);settled=raw!=null&&new JSONObject(raw).has("owner")&&new JSONObject(raw).isNull("owner");if(settled&&approvals(manager).isEmpty())break;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);
   assertTrue("Actual product initializer settles signed-out owner",settled);assertTrue("Product cold startup withdraws persisted approval",approvals(manager).isEmpty());assertFalse(taps.pending().has("token"));
   assertEquals("suspended",new JSONObject(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(id).getString("status"));awaitTapCancellation(context,taps,id);assertThrows(PendingIntent.CanceledException.class,()->original.send());
  }finally{manager.cancel("alpha-workflow-"+id,0);}
 }

}
