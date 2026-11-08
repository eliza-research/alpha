package ai.elizaresearch.alphaphone;

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
 * scripts/android-workflow-native.mjs phase approval-notice-recovery: the first two on the test-mocks
 * archive after a standard-runner prepare run in the same user, the last on the flag-off archive. */
public final class WorkflowApprovalNoticeProcessDeathInstrumentedTest {
 private static final String APP="ai.elizaresearch.alphaphone";
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
 private static void assertOriginalPublication(Context context,NotificationManager manager,AlphaCredentialStore store,WorkflowNoticeTaps taps,String id)throws Exception{
  JSONObject prepared=WorkflowNoticeOwnerFixture.publication(context);StatusBarNotification retained=notice(manager,id);
  assertEquals("Original notice survived runner transition",prepared.getString("key"),retained.getKey());assertEquals(prepared.getLong("postTime"),retained.getPostTime());
  Intent launch=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(launch);launch.setAction(WorkflowNoticeTaps.ACTION).setData(android.net.Uri.parse(WorkflowNoticeTaps.PREFIX+prepared.getString("token")));
  PendingIntent original=PendingIntent.getActivity(context,0,launch,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_NO_CREATE);assertNotNull(original);assertEquals("Exact original OS tap retained",original,retained.getNotification().contentIntent);assertTrue(original.isImmutable());assertEquals(android.os.Process.myUid(),original.getCreatorUid());
  assertEquals(prepared.getString("token"),taps.token(id));assertEquals(prepared.getString("receipt"),store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));assertEquals(prepared.getString("routes"),store.readCredentialSlot(WorkflowNoticeTaps.SLOT));
 }
 private static void awaitTapCancellation(Context context,WorkflowNoticeTaps taps,String id)throws Exception{
  String token=taps.token(id);assertNotNull(token);Intent launch=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(launch);launch.setAction(WorkflowNoticeTaps.ACTION).setData(android.net.Uri.parse(WorkflowNoticeTaps.PREFIX+token));
  long end=SystemClock.elapsedRealtime()+10000;PendingIntent existing;
  do{existing=PendingIntent.getActivity(context,0,launch,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_NO_CREATE);if(existing==null)return;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);
  fail("Old PendingIntent remains registered after signed-out withdrawal");
 }
 @Test public void pendingApprovalNoticeSurvivesProcessDeathAndOpensItsExactApprovalOnce()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated process-death campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNoticeProcessDeath")));
  // A flag-off build skips here, before the prepared-ledger assertions it can never satisfy.
  org.junit.Assume.assumeTrue("Synthetic restore requires test-mocks build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  if(WorkflowNoticeOwnerFixture.preparing()){WorkflowNoticeOwnerFixture.prepare();return;}
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue("Owned secondary user required",android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);
  assertNotNull("Main prepared route ledger required",store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertNotNull("Main prepared approval ledger required",store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  WorkflowNoticeTaps taps=WorkflowNoticeTapsFactory.create(context);WorkflowNoticeDelivery delivery=WorkflowNoticeTapsFactory.delivery(context);
  JSONObject approval=WorkflowNoticeOwnerFixture.approval(context),route=approval.getJSONObject("route");
  String id=approval.getString("id"),binding=approval.getString("bindingHash"),run=route.getString("runId");
  assertTrue(WorkflowNoticeDelivery.approvalId(id));
  long expiresAt=approval.getLong("expiresAt");
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context)){
   assertOriginalPublication(context,manager,store,taps,id);
   Intent initial=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(initial);context.startActivity(initial);
   WorkflowNoticeProcessDeathInstrumentedTest.Identity before=WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);fixture.awaitOwner(true);
   // The standard runner published through the actual main-process bridge.
   String token=taps.token(id);assertNotNull(token);
   String receipt=store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT),prepared=store.readCredentialSlot(WorkflowNoticeTaps.SLOT);
   JSONObject ledger=new JSONObject(receipt),record=ledger.getJSONObject(id);
   assertEquals("One receipt",1,ledger.length());assertEquals(4,record.length());assertEquals("succeeded",record.getString("status"));assertEquals(binding,record.getString("binding"));assertEquals(expiresAt,record.getLong("expiresAt"));assertTrue(record.getString("digest").matches("[a-f0-9]{64}"));
   assertFalse("The receipt holds no route",receipt.contains(run)||receipt.contains("fixture-flow"));
   assertNull("Approval notices never use the step ledger",store.readCredentialSlot(WorkflowNoticeDelivery.SLOT));
   StatusBarNotification original=notice(manager,id);PendingIntent pending=original.getNotification().contentIntent;assertNotNull(pending);
   assertFalse("Redacted: no route identity in the notice",original.getNotification().extras.toString().contains(run)||original.getNotification().extras.toString().contains("fixture-flow"));
   assertFalse(taps.pending().has("token"));
   int verifiedBeforeDeath=fixture.verified.get(),agentsBeforeDeath=fixture.agents.get();
   WorkflowNoticeProcessDeathInstrumentedTest.killMainWithoutTasks(context,before);
   // The pending notice and both ledgers survive the death unchanged.
   assertEquals(prepared,store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertEquals(receipt,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
   StatusBarNotification retained=notice(manager,id);assertEquals(original.getKey(),retained.getKey());assertEquals(original.getPostTime(),retained.getPostTime());assertEquals(pending,retained.getNotification().contentIntent);
   // The only launch after proven absence: the original OS-owned PendingIntent, once, as the shade sends it.
   WorkflowNoticeProcessDeathInstrumentedTest.sendOriginalTap(context,pending);
   WorkflowNoticeProcessDeathInstrumentedTest.Identity after=WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);assertTrue(before.pid!=after.pid||!before.start.equals(after.start));
   fixture.awaitOwner(true,verifiedBeforeDeath+1,agentsBeforeDeath+1);
   JSONObject captured=null;long captureEnd=SystemClock.elapsedRealtime()+15000;
   do{captured=taps.pending();if(token.equals(captured.optString("token")))break;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<captureEnd);
   assertEquals("Restarted main must capture the original token",token,captured.getString("token"));assertTrue("The posted receipt still confirms the tap",captured.getBoolean("retained"));
   // The exact approval: its opaque ID, binding and the whole route it was posted for.
   assertEquals(id,captured.getString("operationId"));assertEquals(binding,captured.getString("bindingHash"));
   for(String key:List.of("scope","origin","ownerId","agentId","workflowId","runId","versionId"))assertEquals(route.getString(key),captured.getString(key));
   JSONObject rows=new JSONObject(store.readCredentialSlot(WorkflowNoticeTaps.SLOT)),row=rows.getJSONObject(id);
   assertEquals("One route",1,rows.length());assertEquals("pending",row.getString("state"));assertEquals(1,row.getLong("order"));assertEquals(token,row.getString("token"));
   String captureLedger=store.readCredentialSlot(WorkflowNoticeTaps.SLOT);
   assertEquals("The capture rewrites no receipt",receipt,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
   // The request is repeated after the restart (as the next review of the run repeats it), through new
   // ledger instances: nothing is posted again and neither ledger is rewritten.
   assertEquals("succeeded",WorkflowNoticeTapsFactory.delivery(context).postApproval(WorkflowNoticeTapsFactory.create(context),id,binding,route,expiresAt,System.currentTimeMillis()));
   StatusBarNotification finalNotice=notice(manager,id);assertEquals(original.getKey(),finalNotice.getKey());assertEquals("No duplicate post",original.getPostTime(),finalNotice.getPostTime());assertEquals(pending,finalNotice.getNotification().contentIntent);
   assertEquals(receipt,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));assertEquals(captureLedger,store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertEquals(token,WorkflowNoticeTapsFactory.create(context).token(id));
   // A request for the same approval with another binding or expiry is refused, not posted.
   assertThrows(IllegalStateException.class,()->WorkflowNoticeTapsFactory.delivery(context).postApproval(WorkflowNoticeTapsFactory.create(context),id,"c".repeat(64),route,expiresAt,System.currentTimeMillis()));
   assertThrows(IllegalStateException.class,()->WorkflowNoticeTapsFactory.delivery(context).postApproval(WorkflowNoticeTapsFactory.create(context),id,binding,route,expiresAt+60000L,System.currentTimeMillis()));
   assertEquals(original.getPostTime(),notice(manager,id).getPostTime());assertEquals(receipt,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));assertEquals(captureLedger,store.readCredentialSlot(WorkflowNoticeTaps.SLOT));
   android.os.Bundle evidence=new android.os.Bundle();evidence.putString("workflowApprovalNoticeProcessDeath",new JSONObject().put("beforePid",before.pid).put("beforeStart",before.start).put("afterPid",after.pid).put("afterStart",after.start).put("uid",after.uid).put("postTime",original.getPostTime()).toString());InstrumentationRegistry.getInstrumentation().addResults(evidence);
  }finally{
   manager.cancel("alpha-workflow-"+id,0);
   // The runner removes this entire fresh user; do not race main's encrypted ledger with cleanup writes.
  }
 }
 @Test public void definitiveSignedOutColdStartWithdrawsApprovalAndInvalidatesOriginalTap()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated process-death campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNoticeProcessDeath")));
  if(WorkflowNoticeOwnerFixture.preparing()){WorkflowNoticeOwnerFixture.prepare();return;}
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue(android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);
  NotificationManager manager=context.getSystemService(NotificationManager.class);WorkflowNoticeTaps taps=WorkflowNoticeTapsFactory.create(context);WorkflowNoticeDelivery delivery=WorkflowNoticeTapsFactory.delivery(context);
  JSONObject approval=WorkflowNoticeOwnerFixture.approval(context);String id=approval.getString("id");
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context)){
   assertOriginalPublication(context,manager,store,taps,id);
   Intent launch=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(launch);context.startActivity(launch);
   WorkflowNoticeProcessDeathInstrumentedTest.Identity before=WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);fixture.awaitOwner(true);
   PendingIntent original=notice(manager,id).getNotification().contentIntent;long end;
   WorkflowNoticeProcessDeathInstrumentedTest.killMainWithoutTasks(context,before);
   store.removeCredentialSlot("remote:"+fixture.origin);
   int authBefore=fixture.verified.get();context.startActivity(launch);WorkflowNoticeProcessDeathInstrumentedTest.Identity after=WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);assertTrue(before.pid!=after.pid||!before.start.equals(after.start));fixture.awaitOwner(false);
   end=SystemClock.elapsedRealtime()+10000;while(!approvals(manager).isEmpty()&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);assertTrue("Signed-out startup withdraws OS approval",approvals(manager).isEmpty());
   assertEquals("No credential means no authentication dispatch",authBefore,fixture.verified.get());assertFalse(taps.pending().has("token"));
   assertEquals("suspended",new JSONObject(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(id).getString("status"));
   awaitTapCancellation(context,taps,id);
   assertThrows("Old OS tap cannot launch signed-out state",PendingIntent.CanceledException.class,()->original.send());
  }finally{manager.cancel("alpha-workflow-"+id,0);}
 }

 @Test public void productionSignedOutColdStartWithdrawsPersistedSyntheticApproval()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated product cold-start campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNoticeProcessDeath"))&&!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue(android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);assertTrue("Main absent before native fixture seed",WorkflowNoticeProcessDeathInstrumentedTest.mainPids(context).isEmpty());
  assertNull(store.readCredentialSlot(WorkflowNoticeOwnerFixture.OWNER_SLOT));assertNull(store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertNull(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
  NotificationManager manager=context.getSystemService(NotificationManager.class);WorkflowNoticeTaps taps=WorkflowNoticeTapsFactory.create(context);WorkflowNoticeDelivery delivery=WorkflowNoticeTapsFactory.delivery(context);
  String id="approval-"+(UUID.randomUUID().toString()+UUID.randomUUID()).replace("-","");
  JSONObject owner=new JSONObject().put("origin","https://synthetic-owner.invalid").put("ownerId","synthetic-owner").put("agentId",UUID.randomUUID().toString());
  // Native-only fixture seed models an owner persisted by a prior process, never a credential.
  store.writeCredentialSlot(WorkflowNoticeOwnerFixture.OWNER_SLOT,new JSONObject().put("owner",owner).toString());
  JSONObject route=new JSONObject(owner.toString()).put("scope","a".repeat(64)).put("workflowId","fixture-flow").put("runId","signedout-product-fixture").put("versionId","fixture-version");
  try{
   long expires=System.currentTimeMillis()+600000,end=SystemClock.elapsedRealtime()+10000;String published;
   do{published=delivery.postApproval(taps,id,"b".repeat(64),route,expires,System.currentTimeMillis());if("succeeded".equals(published))break;assertEquals("unknown",published);SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);
   assertEquals("succeeded",published);PendingIntent original=notice(manager,id).getNotification().contentIntent;
   Intent launch=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(launch);context.startActivity(launch);WorkflowNoticeProcessDeathInstrumentedTest.awaitMain(context);
   boolean settled=false;end=SystemClock.elapsedRealtime()+20000;
   do{String raw=store.readCredentialSlot(WorkflowNoticeOwnerFixture.OWNER_SLOT);settled=raw!=null&&new JSONObject(raw).has("owner")&&new JSONObject(raw).isNull("owner");if(settled&&approvals(manager).isEmpty())break;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);
   assertTrue("Actual product initializer settles signed-out owner",settled);assertTrue("Product cold startup withdraws persisted approval",approvals(manager).isEmpty());assertFalse(taps.pending().has("token"));
   assertEquals("suspended",new JSONObject(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(id).getString("status"));awaitTapCancellation(context,taps,id);assertThrows(PendingIntent.CanceledException.class,()->original.send());
  }finally{manager.cancel("alpha-workflow-"+id,0);}
 }

}
