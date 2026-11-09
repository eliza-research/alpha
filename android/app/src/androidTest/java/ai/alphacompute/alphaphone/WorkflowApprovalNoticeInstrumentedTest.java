package ai.alphacompute.alphaphone;

import android.app.*;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Phone-step approval notices: builders always; OS posting and the tap route only in a dedicated, runner-owned campaign. */
public final class WorkflowApprovalNoticeInstrumentedTest {
 private static void returnedTapDiagnostic(String phase, AlphaCredentialStore store, PendingIntent tap, JSONObject pending){
  StringBuilder out=new StringBuilder("phase="+phase+" pid="+android.os.Process.myPid()+" pending="+pending+" pendingIntent="+tap+"\n");
  try{for(String slot:new String[]{WorkflowNoticeTaps.OWNER_SLOT,WorkflowNoticeTaps.SLOT,WorkflowNoticeDelivery.APPROVAL_SLOT}){String raw=store.readCredentialSlot(slot);out.append(slot).append("=").append(raw==null?"null":raw.substring(0,Math.min(raw.length(),16384))).append("\n");}}catch(Exception error){out.append("ledgerDiagnostic=").append(error).append("\n");}
  try{WebViewTestDriver.withActivity(MainActivity.class,a->{Intent intent=a.getIntent();out.append("activityIdentity=").append(System.identityHashCode(a)).append(" finishing=").append(a.isFinishing()).append(" destroyed=").append(a.isDestroyed()).append(" windowFocus=").append(a.hasWindowFocus()).append(" stage=").append(androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getLifecycleStageOf(a)).append(" intent=").append(intent==null?"null":intent.toUri(0)).append("\n");});}catch(Exception error){out.append("activityDiagnostic=").append(error).append("\n");}
  try{for(android.view.accessibility.AccessibilityWindowInfo window:InstrumentationRegistry.getInstrumentation().getUiAutomation().getWindows()){android.view.accessibility.AccessibilityNodeInfo root=window.getRoot();try{out.append("window id=").append(window.getId()).append(" type=").append(window.getType()).append(" focused=").append(window.isFocused()).append(" active=").append(window.isActive()).append(" package=").append(root==null?"null":root.getPackageName()).append(" rootClass=").append(root==null?"null":root.getClassName()).append("\n");}finally{if(root!=null)root.recycle();window.recycle();}}}catch(Exception error){out.append("windowDiagnostic=").append(error).append("\n");}
  try(java.io.InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys activity intents "+InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName()))){java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;while(bytes.size()<65536&&(count=input.read(buffer,0,Math.min(buffer.length,65536-bytes.size())))!=-1)bytes.write(buffer,0,count);out.append(new String(bytes.toByteArray(),java.nio.charset.StandardCharsets.UTF_8));}catch(Exception error){out.append("intentDiagnostic=").append(error);}
  android.os.Bundle result=new android.os.Bundle();result.putString("workflowReturnedTapDiagnostic_"+phase,out.toString());InstrumentationRegistry.getInstrumentation().addResults(result);
 }
 private static String approvalId(char fill){return "approval-"+String.valueOf(fill).repeat(64);}
 /** Builders only: no OS notification is posted. */
 @Test public void approvalAndStepBuildersAreRedactedAndExpire()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();WorkflowNoticePoster poster=new WorkflowNoticePoster(context);new HostedNoticePoster(context);NotificationManager manager=context.getSystemService(NotificationManager.class);
  assertEquals(NotificationManager.IMPORTANCE_HIGH,manager.getNotificationChannel(WorkflowNoticePoster.APPROVAL_CHANNEL).getImportance());
  assertEquals(NotificationManager.IMPORTANCE_DEFAULT,manager.getNotificationChannel(WorkflowNoticePoster.CHANNEL).getImportance());
  assertEquals("Only approvals use a high-importance channel",NotificationManager.IMPORTANCE_DEFAULT,manager.getNotificationChannel(AlphaHostedResultsPlugin.CHANNEL).getImportance());
  PendingIntent tap=PendingIntent.getActivity(context,0,new Intent(context,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
  Notification approval=poster.approval(WorkflowNoticeDelivery.APPROVAL_TITLE,WorkflowNoticeDelivery.APPROVAL_BODY,10*60000L,tap).build();
  assertEquals(WorkflowNoticePoster.APPROVAL_CHANNEL,approval.getChannelId());assertEquals(10*60000L,approval.getTimeoutAfter());assertEquals(Notification.VISIBILITY_PRIVATE,approval.visibility);assertNotNull(approval.publicVersion);
  assertEquals(0,approval.flags&Notification.FLAG_AUTO_CANCEL);assertTrue("A tap only opens the run; there is no approve action",approval.actions==null||approval.actions.length==0);
  assertThrows(IllegalArgumentException.class,()->poster.approval(WorkflowNoticeDelivery.APPROVAL_TITLE,WorkflowNoticeDelivery.APPROVAL_BODY,0,tap));
  Notification.Action ask=poster.question(tap);
  assertEquals("Ask Alpha",ask.title);assertEquals(tap,ask.actionIntent);assertNull("Ask has no inline send input",ask.getRemoteInputs());
  if(android.os.Build.VERSION.SDK_INT>=31)assertTrue("Ask requires unlock",ask.isAuthenticationRequired());
  Notification step=poster.step("Fixture title","Fixture body",tap).build();
  assertEquals(WorkflowNoticePoster.CHANNEL,step.getChannelId());assertEquals(WorkflowNoticeDelivery.STEP_NOTICE_TIMEOUT_MS,step.getTimeoutAfter());assertEquals(Notification.VISIBILITY_PRIVATE,step.visibility);assertNotNull(step.publicVersion);
 }
 private JSONObject call(String expression)throws Exception{
  WebViewTestDriver.evaluate("window.__approvalNotice=null;Promise.resolve().then(()=>"+expression+").then(v=>window.__approvalNotice=JSON.stringify(v||{}),e=>window.__approvalNotice=JSON.stringify({error:true,name:String(e?.name||'').slice(0,128),message:String(e?.message||e||'').slice(0,512)}))");
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){String raw=WebViewTestDriver.evaluate("window.__approvalNotice");if(!"null".equals(raw)&&!"undefined".equals(raw))return new JSONObject((String)new JSONTokener(raw).nextValue());SystemClock.sleep(50);}throw new AssertionError("Approval notice bridge timed out");
 }
 /** DOM readiness precedes asynchronous session restoration and its signed-out owner fence. */
 private static void awaitSignedOutStartup(AlphaCredentialStore store)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){String raw=store.readCredentialSlot(WorkflowNoticeTaps.OWNER_SLOT);if(raw!=null){JSONObject fence=new JSONObject(raw);if(fence.has("owner")&&fence.isNull("owner"))return;}SystemClock.sleep(50);}
  throw new AssertionError("Actual signed-out startup must settle before synthetic owner seeding");
 }
 private Notification active(NotificationManager manager,String id){for(StatusBarNotification row:manager.getActiveNotifications())if(("alpha-workflow-"+id).equals(row.getTag()))return row.getNotification();return null;}
 /** Runner-owned: a fresh secondary user with notification permission granted. Synthetic route; no agent, account or device action. */
 @Test public void approvalNoticeOpensItsRunOnceAndIsWithdrawnOnDecision()throws Exception{
  org.junit.Assume.assumeTrue("Dedicated workflow approval notice campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNotice")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();NotificationManager manager=context.getSystemService(NotificationManager.class);AlphaCredentialStore store=new AlphaCredentialStore(context);
  assertNull("Fresh approval fixture required",store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
  String id=approvalId('d'),run="fixture-run-"+java.util.UUID.randomUUID();long expiresAt=System.currentTimeMillis()+10*60000L;
  JSONObject route=new JSONObject().put("scope","a".repeat(64)).put("origin","https://workflow-fixture.invalid").put("ownerId","fixture-owner").put("agentId","fixture-agent").put("workflowId","fixture-flow").put("runId",run).put("versionId","fixture-version");
  JSONObject input=new JSONObject().put("id",id).put("bindingHash","b".repeat(64)).put("expiresAt",expiresAt).put("route",route);
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();awaitSignedOutStartup(store);
   assertFalse(call("Capacitor.Plugins.AlphaHostedResults.withdrawOtherOwnerApprovalNotices({owner:{origin:\"https://workflow-fixture.invalid\",ownerId:\"fixture-owner\",agentId:\"fixture-agent\"}})").has("error"));
   assertEquals("succeeded",call("Capacitor.Plugins.AlphaHostedResults.postWorkflowApprovalNotice("+input+")").getString("status"));
   assertEquals("Posted at most once","succeeded",call("Capacitor.Plugins.AlphaHostedResults.postWorkflowApprovalNotice("+input+")").getString("status"));
   Notification notice=active(manager,id);assertNotNull("Approval notice posted",notice);assertEquals(WorkflowNoticePoster.APPROVAL_CHANNEL,notice.getChannelId());
   long timeout=notice.getTimeoutAfter();assertTrue("Times out at the approval expiry",timeout>0&&timeout<=10*60000L);
   assertFalse("Redacted: no route identity in the notice",notice.extras.toString().contains(run)||notice.extras.toString().contains("fixture-flow"));
   String token=WorkflowNoticeTapsFactory.create(context).token(id);assertNotNull(token);
   assertEquals(1,notice.actions.length);assertEquals("Ask Alpha",notice.actions[0].title);
   notice.actions[0].actionIntent.send();
   long questionEnd=SystemClock.elapsedRealtime()+15000;JSONObject question=new JSONObject();
   while(SystemClock.elapsedRealtime()<questionEnd){question=call("Capacitor.Plugins.AlphaNotifications.pendingWorkflowTap()");if(question.optBoolean("question"))break;SystemClock.sleep(100);}
   assertEquals(run,question.optString("runId"));assertTrue(question.optBoolean("question"));assertTrue(question.optBoolean("retained"));
   assertEquals(WorkflowNoticeDelivery.APPROVAL_TITLE,question.getJSONObject("notice").getString("title"));
   assertEquals(WorkflowNoticeDelivery.APPROVAL_BODY,question.getJSONObject("notice").getString("text"));
   assertFalse("Explicit Cancel settles only the question",call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(token)+",discard:true})").has("error"));
   assertNotNull("Cancel retains approval notice",active(manager,id));
   assertEquals("succeeded",new JSONObject(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(id).getString("status"));
   notice.actions[0].actionIntent.send();
   long askedEnd=SystemClock.elapsedRealtime()+15000;JSONObject asked=new JSONObject();
   while(SystemClock.elapsedRealtime()<askedEnd){asked=call("Capacitor.Plugins.AlphaNotifications.pendingWorkflowTap()");if(asked.optBoolean("question"))break;SystemClock.sleep(100);}
   assertTrue(asked.optBoolean("question"));
   assertFalse("Use in conversation settles only the question",call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(token)+",noticeRevision:"+JSONObject.quote(asked.getJSONObject("notice").getString("revision"))+"})").has("error"));
   assertNotNull("A completed Ask keeps the waiting approval's notice",active(manager,id));assertEquals(0,WorkflowNoticeTapsFactory.create(context).pending().length());
   assertEquals(token,WorkflowNoticeTapsFactory.create(context).token(id));
   assertEquals("succeeded",new JSONObject(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(id).getString("status"));
   notice.contentIntent.send();
   long end=SystemClock.elapsedRealtime()+15000;JSONObject pending=new JSONObject();
   while(SystemClock.elapsedRealtime()<end){pending=call("Capacitor.Plugins.AlphaNotifications.pendingWorkflowTap()");if(token.equals(pending.optString("token")))break;SystemClock.sleep(100);}
   assertEquals("Tap resolves to its exact run",run,pending.optString("runId"));assertTrue(pending.optBoolean("retained"));
   // The durable route is readable without the plugin instance (the process-death path reads the same ledgers).
   assertEquals(token,WorkflowNoticeTapsFactory.create(context).pending().getString("token"));
   assertFalse(call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(token)+"})").has("error"));
   awaitGone(manager,id,"Opening the notice cancels it");
   assertFalse(call("Capacitor.Plugins.AlphaHostedResults.withdrawWorkflowApprovalNotice({id:"+JSONObject.quote(id)+"})").has("error"));
   assertEquals("A decided approval is never reposted","withdrawn",call("Capacitor.Plugins.AlphaHostedResults.postWorkflowApprovalNotice("+input+")").getString("status"));
   awaitGone(manager,id,"A decision withdraws the notice");assertNull("Route released",WorkflowNoticeTapsFactory.create(context).token(id));
  }finally{manager.cancel("alpha-workflow-"+id,0);store.removeCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT);}
 }
 /**
  * Runner-owned, as above. The approval notice belongs to the account and agent that posted it.
  * (1) A tap while this phone's agent binding is not that agent is captured but fenced: no run or
  * approval opens, the other-account state is shown (or deferred while the connection dialog is
  * open) and the durable route stays pending for its own account.
  * (2) When the phone's connection actually changes (here: a stored offline selection, read as the
  * resident under P-43), the renderer's owner fence (NoticeOwnerCoordinator ->
  * withdrawOtherOwnerApprovalNotices) suspends the notice before any later tap: the OS notice and
  * its PendingIntents are cancelled, the route is hidden from the new owner, and the approval is
  * retained only as suspended metadata for its own account's revalidated return.
  */
 @Test public void approvalNoticeTapAfterAccountChangeIsFencedWithoutAStaleApproval()throws Exception{
  org.junit.Assume.assumeTrue("Dedicated workflow approval notice campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNotice")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();NotificationManager manager=context.getSystemService(NotificationManager.class);AlphaCredentialStore store=new AlphaCredentialStore(context);
  assertNull("Fresh approval fixture required",store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT));
  String id=approvalId('f'),run="fixture-run-"+java.util.UUID.randomUUID();long expiresAt=System.currentTimeMillis()+10*60000L;
  JSONObject owner=new JSONObject().put("origin","https://workflow-fixture.invalid").put("ownerId","fixture-owner").put("agentId","fixture-agent");
  JSONObject input=new JSONObject().put("id",id).put("bindingHash","b".repeat(64)).put("expiresAt",expiresAt).put("route",route("fixture-owner",run));
  String noApproval="[...document.querySelectorAll('[data-screen] button')].some(b=>/^(Approve|Reject|Deny)\\b/.test((b.getAttribute('aria-label')||b.textContent||'').trim())&&b.getClientRects().length)";
  WorkflowNoticeTaps taps=WorkflowNoticeTapsFactory.create(context);
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();awaitSignedOutStartup(store);
   // The posting account is the phone's notice owner, as when its approval was reviewed.
   assertFalse(call("Capacitor.Plugins.AlphaHostedResults.withdrawOtherOwnerApprovalNotices({owner:"+owner+"})").has("error"));
   assertEquals("succeeded",call("Capacitor.Plugins.AlphaHostedResults.postWorkflowApprovalNotice("+input+")").getString("status"));
   StatusBarNotification posted=row(manager,id);assertNotNull("Approval notice posted",posted);
   PendingIntent stale=posted.getNotification().contentIntent,staleAsk=posted.getNotification().actions[0].actionIntent;String token=taps.token(id);assertNotNull(token);
   // (1) No agent binding here matches the notice's scope, origin, owner and agent.
   stale.send();
   long end=SystemClock.elapsedRealtime()+15000;String shown="false";
   while(SystemClock.elapsedRealtime()<end&&!"true".equals(shown)){shown=WebViewTestDriver.evaluate("document.body.innerText.includes('Workflow notification saved. Connect its original agent to open it.')");if(!"true".equals(shown))SystemClock.sleep(100);}
   if(!"true".equals(shown))assertEquals("The tap shows the other-account state unless the connection dialog defers it","true",WebViewTestDriver.evaluate("Boolean(document.querySelector('.alpha-connection-scrim'))"));
   assertEquals("No run or approval opens for another account","false",WebViewTestDriver.evaluate(noApproval));
   assertFalse("No run detail opened",WebViewTestDriver.evaluate("document.body.innerText").contains(run));
   JSONObject pending=taps.pending();
   assertEquals("The route stays pending for its own account, not consumed",token,pending.optString("token"));assertTrue(pending.optBoolean("retained"));
   // (2) The connection changes. The saved selection is restored before the activity closes, so later classes see the original.
   String prior=WebViewTestDriver.evaluate("localStorage.getItem('alpha.connection.selection.v1')");
   WebViewTestDriver.evaluate("localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}))");
   try{
    activity.recreate();AppNavigation.liveMode();
    // The fence runs once the recreated renderer's startup resolves its (resident or signed-out) owner.
    long fenced=SystemClock.elapsedRealtime()+20000;while(row(manager,id)!=null&&SystemClock.elapsedRealtime()<fenced)SystemClock.sleep(50);
    awaitGone(manager,id,"The account change withdraws the other account's approval notice");
    assertThrows("Its tap opens nothing",PendingIntent.CanceledException.class,()->stale.send());assertThrows(PendingIntent.CanceledException.class,()->staleAsk.send());
    assertEquals("Another account's route is hidden from this owner",0,taps.pending().length());
    org.json.JSONArray suspended=taps.suspendedApprovals(owner,System.currentTimeMillis());
    assertEquals("Retained only as suspended metadata for its own account",1,suspended.length());assertEquals(id,suspended.getJSONObject(0).getString("id"));
    assertEquals("suspended",new JSONObject(store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT)).getJSONObject(id).getString("status"));
    assertEquals("Not reposted for the previous account","owner-changed",call("Capacitor.Plugins.AlphaHostedResults.postWorkflowApprovalNotice("+input+")").getString("status"));
    assertNull(row(manager,id));
    assertEquals("No run or approval opens after the change","false",WebViewTestDriver.evaluate(noApproval));
    assertFalse("No run detail opened after the change",WebViewTestDriver.evaluate("document.body.innerText").contains(run));
   }finally{WebViewTestDriver.evaluate("null".equals(prior)?"localStorage.removeItem('alpha.connection.selection.v1')":"localStorage.setItem('alpha.connection.selection.v1',"+prior+")");}
  }finally{manager.cancel("alpha-workflow-"+id,0);store.removeCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT);store.removeCredentialSlot(WorkflowNoticeTaps.SLOT);store.removeCredentialSlot(WorkflowNoticeTaps.OWNER_SLOT);}
 }
 private static JSONObject route(String owner,String run)throws Exception{return new JSONObject().put("scope","a".repeat(64)).put("origin","https://workflow-fixture.invalid").put("ownerId",owner).put("agentId","fixture-agent").put("workflowId","fixture-flow").put("runId",run).put("versionId","fixture-version");}
 private static StatusBarNotification row(NotificationManager manager,String id){StatusBarNotification found=null;for(StatusBarNotification row:manager.getActiveNotifications())if(("alpha-workflow-"+id).equals(row.getTag())){assertNull("One OS notice per approval",found);assertEquals(0,row.getId());found=row;}return found;}
 /** A cancelled notice leaves the active list asynchronously. */
 private static void awaitGone(NotificationManager manager,String id,String message){long end=SystemClock.elapsedRealtime()+5000;while(row(manager,id)!=null&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);assertNull(message,row(manager,id));}
 /** Synthetic owner return, explicit native revalidation boundary, actual OS quiet grouping and cancelled old PendingIntent. */
 @Test public void ownerChangeWithdrawsThePendingApprovalNoticeAndItsTapOpensNothing()throws Exception{
  org.junit.Assume.assumeTrue("Dedicated workflow approval notice campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowApprovalNotice")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();NotificationManager manager=context.getSystemService(NotificationManager.class);AlphaCredentialStore store=new AlphaCredentialStore(context);
  String id=approvalId('e'),run="fixture-old-"+java.util.UUID.randomUUID();long expiry=System.currentTimeMillis()+600000;
  JSONObject input=new JSONObject().put("id",id).put("bindingHash","b".repeat(64)).put("expiresAt",expiry).put("route",route("fixture-owner",run));
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();awaitSignedOutStartup(store);call("Capacitor.Plugins.AlphaHostedResults.withdrawOtherOwnerApprovalNotices({owner:{origin:\"https://workflow-fixture.invalid\",ownerId:\"fixture-owner\",agentId:\"fixture-agent\"}})");
   assertEquals("succeeded",call("Capacitor.Plugins.AlphaHostedResults.postWorkflowApprovalNotice("+input+")").getString("status"));
   assertTrue(call("Capacitor.Plugins.AlphaHostedResults.withdrawOtherOwnerApprovalNotices({owner:\"bad\"})").has("error"));
   StatusBarNotification original=row(manager,id);assertNotNull("Malformed owner must not sign out or remove the matching notice",original);PendingIntent stale=original.getNotification().contentIntent,staleAsk=original.getNotification().actions[0].actionIntent;String token=WorkflowNoticeTapsFactory.create(context).token(id);
   call("Capacitor.Plugins.AlphaHostedResults.withdrawOtherOwnerApprovalNotices({owner:{origin:\"https://workflow-fixture.invalid\",ownerId:\"fixture-next-owner\",agentId:\"fixture-agent\"}})");awaitGone(manager,id,"Other owner's notice removed");
   assertThrows(PendingIntent.CanceledException.class,()->stale.send());assertThrows(PendingIntent.CanceledException.class,()->staleAsk.send());assertEquals(0,WorkflowNoticeTapsFactory.create(context).pending().length());
   assertEquals("owner-changed",call("Capacitor.Plugins.AlphaHostedResults.postWorkflowApprovalNotice("+input+")").getString("status"));
   JSONObject returned=call("Capacitor.Plugins.AlphaHostedResults.withdrawOtherOwnerApprovalNotices({owner:{origin:\"https://workflow-fixture.invalid\",ownerId:\"fixture-owner\",agentId:\"fixture-agent\"}})");assertEquals(1,returned.getJSONArray("suspended").length());assertNull(row(manager,id));
   assertEquals("succeeded",call("Capacitor.Plugins.AlphaHostedResults.resumeWorkflowApprovalNotice("+input+")").getString("status"));
   Notification resumed=row(manager,id).getNotification();assertEquals(Notification.GROUP_ALERT_SUMMARY,resumed.getGroupAlertBehavior());assertEquals("alpha_quiet_approvals",resumed.getGroup());assertEquals(Notification.VISIBILITY_PRIVATE,resumed.visibility);assertNotNull(resumed.publicVersion);
   String fresh=WorkflowNoticeTapsFactory.create(context).token(id);assertNotEquals(token,fresh);assertThrows(PendingIntent.CanceledException.class,()->stale.send());
   resumed.contentIntent.send();long end=SystemClock.elapsedRealtime()+10000;JSONObject pending=new JSONObject();while(SystemClock.elapsedRealtime()<end){pending=call("Capacitor.Plugins.AlphaNotifications.pendingWorkflowTap()");if(fresh.equals(pending.optString("token")))break;SystemClock.sleep(50);}if(!fresh.equals(pending.optString("token")))returnedTapDiagnostic("failure",store,resumed.contentIntent,pending);assertEquals("Returned tap response: "+pending,fresh,pending.optString("token"));assertEquals(run,pending.optString("runId"));
   call("Capacitor.Plugins.AlphaHostedResults.withdrawWorkflowApprovalNotice({id:"+JSONObject.quote(id)+"})");awaitGone(manager,id,"Decision withdraws returned notice");assertEquals("not-suspended",call("Capacitor.Plugins.AlphaHostedResults.resumeWorkflowApprovalNotice("+input+")").getString("status"));
  }finally{manager.cancel("alpha-workflow-"+id,0);store.removeCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT);store.removeCredentialSlot(WorkflowNoticeTaps.SLOT);store.removeCredentialSlot(WorkflowNoticeTaps.OWNER_SLOT);}
 }
}
