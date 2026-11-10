package ai.alphacompute.alphaphone;

import android.app.*;
import android.content.*;
import android.os.Build;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import android.system.Os;
import android.system.OsConstants;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import static org.junit.Assert.*;

/** Runs only in the separate instrumentation host; main dies while the test remains alive. Both methods
 * run under WorkflowNoticeOwnerFixture (test-mocks): a standard-runner prepare run in the same user
 * restores a synthetic owner first, so main's signed-out startup fence is a no-op for these routes.
 * They prove native capture of the original tap by the restarted main, not that the renderer opens it. */
public final class WorkflowNoticeProcessDeathInstrumentedTest {
 private static final String APP="ai.alphacompute.alphaphone";
 /** Package-visible: WorkflowApprovalNoticeProcessDeathInstrumentedTest and ReminderTapProcessDeathInstrumentedTest prove the same death boundary. */
 static final class Identity {
  final int pid,uid;final String start,argvState;final boolean argvReady;
  Identity(int pid)throws Exception {
   this.pid=pid;
   String status=new String(Files.readAllBytes(Path.of("/proc/"+pid+"/status")), java.nio.charset.StandardCharsets.UTF_8);
   java.util.regex.Matcher match=java.util.regex.Pattern.compile("(?m)^Uid:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s*$").matcher(status);
   assertTrue("Process UID unavailable",match.find());uid=Integer.parseInt(match.group(1));
   for(int i=2;i<=4;i++)assertEquals(uid,Integer.parseInt(match.group(i)));
   assertFalse("Ambiguous UID",match.find());
   String cmdline=new String(Files.readAllBytes(Path.of("/proc/"+pid+"/cmdline")), java.nio.charset.StandardCharsets.UTF_8);
   argvReady=cmdline.startsWith(APP+"\0")&&cmdline.substring(APP.length()).chars().allMatch(ch->ch==0);
   argvState=argvReady?"expected":cmdline.isEmpty()?"empty":cmdline.startsWith(APP+"\0")?"expected-prefix-with-extra-bytes":"other";
   String stat=new String(Files.readAllBytes(Path.of("/proc/"+pid+"/stat")), java.nio.charset.StandardCharsets.UTF_8);int close=stat.lastIndexOf(')');assertTrue(close>0);
   String[] fields=stat.substring(close+2).trim().split("\\s+");assertTrue(fields.length>19);start=fields[19];assertTrue(start.matches("[0-9]+"));
   assertEquals(android.os.Process.myUid(),uid);assertNotEquals(android.os.Process.myPid(),pid);
  }
  void exact()throws Exception {Identity now=new Identity(pid);assertEquals(uid,now.uid);assertEquals(start,now.start);assertTrue("Unexpected process argv at kill boundary: "+now.argvState,now.argvReady);}
 }
 static List<Integer> mainPids(Context context){
  List<Integer> found=new ArrayList<>();List<ActivityManager.RunningAppProcessInfo> rows=context.getSystemService(ActivityManager.class).getRunningAppProcesses();
  assertNotNull("Process inventory unavailable",rows);
  for(ActivityManager.RunningAppProcessInfo row:rows)if(APP.equals(row.processName)){assertEquals(android.os.Process.myUid(),row.uid);found.add(row.pid);}
  assertTrue("Multiple main processes",found.size()<=1);return found;
 }
 static Identity awaitMain(Context context)throws Exception {
  long end=SystemClock.elapsedRealtime()+15000;Identity candidate=null;String argvState="not-observed";
  do{
   List<Integer> rows=mainPids(context);
   if(rows.size()==1){
    Identity current=new Identity(rows.get(0));
    if(candidate==null)candidate=current;
    else {assertEquals("Main PID changed during readiness",candidate.pid,current.pid);assertEquals(candidate.uid,current.uid);assertEquals("Main start changed during readiness",candidate.start,current.start);}
    argvState=current.argvState;if(current.argvReady)return current;
   }else if(candidate!=null)throw new AssertionError("Main disappeared during readiness");
   SystemClock.sleep(50);
  }while(SystemClock.elapsedRealtime()<end);
  throw new AssertionError("Main process readiness deadline; argv="+argvState);
 }
 /** Removes only this package's tasks (no foreground task recovery), SIGKILLs exactly the observed main and proves it absent. */
 static void killMainWithoutTasks(Context context,Identity before)throws Exception {
  ActivityManager activities=context.getSystemService(ActivityManager.class);
  for(ActivityManager.AppTask task:activities.getAppTasks()){
   ActivityManager.RecentTaskInfo info=task.getTaskInfo();assertNotNull(info.baseIntent.getComponent());assertEquals(APP,info.baseIntent.getComponent().getPackageName());task.finishAndRemoveTask();
  }
  long taskEnd=SystemClock.elapsedRealtime()+10000;
  while(!activities.getAppTasks().isEmpty()&&SystemClock.elapsedRealtime()<taskEnd)SystemClock.sleep(50);
  assertTrue("Main tasks still active",activities.getAppTasks().isEmpty());
  before.exact();Os.kill(before.pid,OsConstants.SIGKILL);
  long deathEnd=SystemClock.elapsedRealtime()+10000;
  while((Files.exists(Path.of("/proc/"+before.pid))||!mainPids(context).isEmpty())&&SystemClock.elapsedRealtime()<deathEnd)SystemClock.sleep(50);
  assertFalse("Original process did not die",Files.exists(Path.of("/proc/"+before.pid)));
  assertTrue("Main restarted before notification tap",mainPids(context).isEmpty());
 }
 /** Sends the original OS-owned PendingIntent once, as the shade sends a tapped notice: with the
  * sender's activity-start allowance on API 34+, where no app task is left to start from. */
 static void sendOriginalTap(Context context,PendingIntent pending)throws PendingIntent.CanceledException {
  if(Build.VERSION.SDK_INT<34){pending.send();return;}
  ActivityOptions options=ActivityOptions.makeBasic();options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
  pending.send(context,0,null,null,null,null,options.toBundle());
 }
 private static StatusBarNotification notice(NotificationManager manager,String operation){
  StatusBarNotification found=null;
  for(StatusBarNotification row:manager.getActiveNotifications())if(("alpha-workflow-"+operation).equals(row.getTag())){assertNull(found);assertEquals(0,row.getId());found=row;}
  assertNotNull("Original OS notification disappeared",found);return found;
 }
 @Test public void originalNoticeLaunchesAbsentMainAfterOrdinaryProcessDeath()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated process-death campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowNoticeProcessDeath")));
  org.junit.Assume.assumeTrue("Synthetic restore requires test-mocks build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  if(WorkflowNoticeOwnerFixture.preparing()){WorkflowNoticeOwnerFixture.prepare();return;}
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue(android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);
  // The prepare run posted one approval through main; no step notice exists yet.
  assertNotNull("Main prepared route ledger required",store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertNull("Fresh delivery ledger required",store.readCredentialSlot(WorkflowNoticeDelivery.SLOT));
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  WorkflowNoticeDelivery.Storage storage=new WorkflowNoticeDelivery.Storage(){public String read(String key)throws Exception{return store.readCredentialSlot(key);}public void write(String key,String value)throws Exception{store.writeCredentialSlot(key,value);}};
  WorkflowNoticeTaps taps=new WorkflowNoticeTaps(storage);WorkflowNoticeDelivery delivery=new WorkflowNoticeDelivery(storage,new WorkflowNoticePoster(context));
  String operation="process_"+UUID.randomUUID(),binding="b".repeat(64);
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context)){
   // The restored owner's route, so main's owner fence leaves it alone.
   JSONObject route=new JSONObject(fixture.identity.toString()).put("scope","a".repeat(64)).put("workflowId","fixture-flow").put("runId",operation).put("versionId","fixture-version");
   String token=taps.prepare(operation,binding,route);
   // One OS dispatch only. Unknown is reconciled from the actual OS notice, never reposted.
   String publication=delivery.publish(operation,binding,"Process death fixture","Original retained notification");
   long publicationEnd=SystemClock.elapsedRealtime()+10000;
   while(!"succeeded".equals(publication)){
    assertEquals("OS publication failed or returned an invalid status","unknown",publication);
    assertTrue("OS publication receipt remained unconfirmed",SystemClock.elapsedRealtime()<publicationEnd);
    SystemClock.sleep(50);
    publication=delivery.receipt(operation,binding,"Process death fixture","Original retained notification");
   }
   StatusBarNotification original=notice(manager,operation);PendingIntent pending=original.getNotification().contentIntent;assertNotNull(pending);
   assertFalse(taps.pending().has("token"));
   Intent initial=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(initial);context.startActivity(initial);
   Identity before=awaitMain(context);fixture.awaitOwner(true);
   String receipt=store.readCredentialSlot(WorkflowNoticeDelivery.SLOT),prepared=store.readCredentialSlot(WorkflowNoticeTaps.SLOT);
   assertNotNull("The restored owner kept the step notice",receipt);notice(manager,operation);
   int verifiedBeforeDeath=fixture.verified.get(),agentsBeforeDeath=fixture.agents.get();
   killMainWithoutTasks(context,before);
   assertEquals(prepared,store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertEquals(receipt,store.readCredentialSlot(WorkflowNoticeDelivery.SLOT));
   StatusBarNotification retained=notice(manager,operation);assertEquals(original.getKey(),retained.getKey());assertEquals(original.getPostTime(),retained.getPostTime());assertEquals(pending,retained.getNotification().contentIntent);
   // The only launch after proven absence: the original OS-owned PendingIntent, once.
   sendOriginalTap(context,pending);Identity after=awaitMain(context);assertTrue(before.pid!=after.pid||!before.start.equals(after.start));
   fixture.awaitOwner(true,verifiedBeforeDeath+1,agentsBeforeDeath+1);
   JSONObject captured=null;long captureEnd=SystemClock.elapsedRealtime()+15000;
   do{captured=taps.pending();if(token.equals(captured.optString("token")))break;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<captureEnd);
   assertEquals("Main plugin must capture original token",token,captured.getString("token"));assertTrue(captured.getBoolean("retained"));
   for(String key:List.of("scope","origin","ownerId","agentId","workflowId","runId","versionId"))assertEquals(route.getString(key),captured.getString(key));
   assertEquals(operation,captured.getString("operationId"));assertEquals(binding,captured.getString("bindingHash"));
   assertEquals(receipt,store.readCredentialSlot(WorkflowNoticeDelivery.SLOT));
   StatusBarNotification finalNotice=notice(manager,operation);assertEquals(original.getPostTime(),finalNotice.getPostTime());assertEquals(pending,finalNotice.getNotification().contentIntent);
   JSONObject row=new JSONObject(store.readCredentialSlot(WorkflowNoticeTaps.SLOT)).getJSONObject(operation);assertEquals("pending",row.getString("state"));assertEquals(1,row.getLong("order"));
   android.os.Bundle evidence=new android.os.Bundle();evidence.putString("workflowNoticeProcessDeath",new JSONObject().put("beforePid",before.pid).put("beforeStart",before.start).put("afterPid",after.pid).put("afterStart",after.start).put("uid",after.uid).put("postTime",original.getPostTime()).toString());InstrumentationRegistry.getInstrumentation().addResults(evidence);
  }finally{
   manager.cancel("alpha-workflow-"+operation,0);
   // Runner removes this entire fresh user; do not race main's encrypted ledger with cleanup writes.
  }
 }
 private static StatusBarNotification approvalNotice(NotificationManager manager,String id){
  StatusBarNotification found=null;
  for(StatusBarNotification row:manager.getActiveNotifications())if(("alpha-workflow-"+id).equals(row.getTag())){assertNull("One notice per approval",found);found=row;}
  assertNotNull("Approval notice is not active",found);return found;
 }
 /**
  * A pending approval's notice survives an ordinary process death, and its original OS-owned
  * PendingIntent is then captured by the restarted main for exactly that approval: a second approval
  * posted beside it stays untouched. Native capture only; the renderer opening the approval is not
  * observed. Run by scripts/ci/pending-recovery-ui.py phase workflow-approval-process-death
  * (workflowNoticeProcessDeath=approval) in the separate WorkflowNoticeProcessRunner process, after its
  * prepare run.
  */
 @Test public void approvalNoticeOpensOnlyItsApprovalAfterProcessDeath()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated approval process-death campaign","approval".equals(InstrumentationRegistry.getArguments().getString("workflowNoticeProcessDeath")));
  org.junit.Assume.assumeTrue("Synthetic restore requires test-mocks build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  if(WorkflowNoticeOwnerFixture.preparing()){WorkflowNoticeOwnerFixture.prepare();return;}
  assertEquals(APP+":workflowNoticeTest",Application.getProcessName());assertTrue(android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);
  assertNotNull("Main prepared route ledger required",store.readCredentialSlot(WorkflowNoticeTaps.SLOT));assertNotNull("Main prepared approval ledger required",store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
  NotificationManager manager=context.getSystemService(NotificationManager.class);
  WorkflowNoticeTaps taps=WorkflowNoticeTapsFactory.create(context);WorkflowNoticeDelivery delivery=WorkflowNoticeTapsFactory.delivery(context);
  String chosen="approval-"+"e".repeat(64),other="approval-"+"f".repeat(64),run="approval-run-"+UUID.randomUUID(),otherRun="approval-run-"+UUID.randomUUID();
  long now=System.currentTimeMillis(),expiresAt=now+10*60000L;
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context)){
   // Both approvals belong to the restored owner, so main's owner fence leaves them alone.
   JSONObject route=new JSONObject(fixture.identity.toString()).put("scope","a".repeat(64)).put("workflowId","fixture-flow").put("runId",run).put("versionId","fixture-version");
   JSONObject otherRoute=new JSONObject(route.toString()).put("runId",otherRun);
   assertEquals("succeeded",delivery.postApproval(taps,chosen,"b".repeat(64),route,expiresAt,now));
   assertEquals("succeeded",delivery.postApproval(taps,other,"c".repeat(64),otherRoute,expiresAt,now));
   String token=taps.token(chosen),otherToken=taps.token(other);assertNotNull(token);assertNotNull(otherToken);assertNotEquals(token,otherToken);
   StatusBarNotification original=approvalNotice(manager,chosen);PendingIntent pending=original.getNotification().contentIntent;assertNotNull(pending);
   Intent initial=context.getPackageManager().getLaunchIntentForPackage(APP);assertNotNull(initial);context.startActivity(initial);
   Identity before=awaitMain(context);fixture.awaitOwner(true);
   String ledger=store.readCredentialSlot(WorkflowNoticeTaps.SLOT),approvals=store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT);
   assertEquals("The restored owner kept both approvals","succeeded",new JSONObject(approvals).getJSONObject(chosen).getString("status"));assertEquals("succeeded",new JSONObject(approvals).getJSONObject(other).getString("status"));
   int verifiedBeforeDeath=fixture.verified.get(),agentsBeforeDeath=fixture.agents.get();
   killMainWithoutTasks(context,before);
   assertEquals("Process death changed no route",ledger,store.readCredentialSlot(WorkflowNoticeTaps.SLOT));
   assertEquals("Process death changed no approval",approvals,store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
   StatusBarNotification retained=approvalNotice(manager,chosen);assertEquals(original.getKey(),retained.getKey());assertEquals(original.getPostTime(),retained.getPostTime());
   sendOriginalTap(context,pending);Identity after=awaitMain(context);assertTrue(before.pid!=after.pid||!before.start.equals(after.start));
   fixture.awaitOwner(true,verifiedBeforeDeath+1,agentsBeforeDeath+1);
   JSONObject captured=null;long captureEnd=SystemClock.elapsedRealtime()+15000;
   do{captured=taps.pending();if(token.equals(captured.optString("token")))break;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<captureEnd);
   assertEquals("The tap captures exactly its approval",token,captured.getString("token"));assertTrue(captured.getBoolean("retained"));
   assertEquals(chosen,captured.getString("operationId"));assertEquals(run,captured.getString("runId"));
   JSONObject rows=new JSONObject(store.readCredentialSlot(WorkflowNoticeTaps.SLOT));
   assertEquals("pending",rows.getJSONObject(chosen).getString("state"));
   assertEquals("The other approval was not opened","new",rows.getJSONObject(other).getString("state"));
   approvalNotice(manager,other);
   android.os.Bundle evidence=new android.os.Bundle();evidence.putString("workflowApprovalProcessDeath",new JSONObject().put("beforePid",before.pid).put("beforeStart",before.start).put("afterPid",after.pid).put("afterStart",after.start).put("uid",after.uid).put("postTime",original.getPostTime()).put("openedApprovals",1).put("untouchedApprovals",1).toString());InstrumentationRegistry.getInstrumentation().addResults(evidence);
  }finally{
   manager.cancel("alpha-workflow-"+chosen,0);manager.cancel("alpha-workflow-"+other,0);
  }
 }
}
