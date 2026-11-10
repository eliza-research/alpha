package ai.elizaresearch.alphaphone;

import android.app.*;
import android.content.Context;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import java.util.UUID;
import static org.junit.Assert.*;

/** Explicit disposable secondary-user campaign; real notification permission is runner-owned. */
public final class WorkflowNoticeTapInstrumentedTest {
 private java.util.concurrent.CountDownLatch coldReadinessQueued;
 private JSONObject call(String expression)throws Exception{
  WebViewTestDriver.evaluate("window.__workflowNoticeTap=null;Promise.resolve().then(()=>"+expression+").then(v=>window.__workflowNoticeTap=JSON.stringify(v||{}),()=>window.__workflowNoticeTap=JSON.stringify({error:true}))");
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){String raw=WebViewTestDriver.evaluate("window.__workflowNoticeTap");if(!"null".equals(raw)&&!"undefined".equals(raw))return new JSONObject((String)new JSONTokener(raw).nextValue());SystemClock.sleep(50);}throw new AssertionError("Tap bridge timed out");
 }
 /** Observe the Activity launched by the original PendingIntent; never launch or resend here. */
 private boolean tapBridgeReady(long remaining)throws Exception{
  java.util.concurrent.CountDownLatch done=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.atomic.AtomicBoolean ready=new java.util.concurrent.atomic.AtomicBoolean();
  java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();
  TestUiDispatch dispatch=TestUiDispatch.postForFixture(new android.os.Handler(android.os.Looper.getMainLooper()),()->{
   try{for(android.app.Activity activity:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED)){
    if(activity.getClass()!=MainActivity.class||activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())continue;
    MainActivity main=(MainActivity)activity;
    if(main.getBridge()==null||main.getBridge().getWebView()==null)continue;
    main.getBridge().getWebView().evaluateJavascript("Boolean(window.Capacitor?.Plugins?.AlphaNotifications?.pendingWorkflowTap)",value->{ready.set("true".equals(value));done.countDown();});return;
   }
   done.countDown();}catch(Throwable error){failure.set(error);done.countDown();}
  },Math.max(1,remaining));
  if(coldReadinessQueued!=null)coldReadinessQueued.countDown();
  dispatch.await(done,"Read-only notification Activity/bridge readiness");if(failure.get()!=null)throw new AssertionError("Notification readiness observation failed",failure.get());return ready.get();
 }
 private JSONObject pending(String token)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;boolean observedReady=false;
  while(SystemClock.elapsedRealtime()<end){
   if(tapBridgeReady(end-SystemClock.elapsedRealtime())){
    observedReady=true;JSONObject row=call("Capacitor.Plugins.AlphaNotifications.pendingWorkflowTap()");if(token.equals(row.optString("token")))return row;
   }
   SystemClock.sleep(50);
  }
  throw new AssertionError(observedReady?"Exact tap not retained":"Original notification launch never reached a resumed focused bridge");
 }
 /** The resumed MainActivity's launch Intent; Capacitor installs each delivered tap with setIntent. */
 private android.content.Intent resumedIntent()throws Exception{
  java.util.concurrent.atomic.AtomicReference<android.content.Intent> found=new java.util.concurrent.atomic.AtomicReference<>();
  BoundedActivityScenario.main(()->{for(android.app.Activity activity:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))if(activity instanceof MainActivity)found.set(activity.getIntent());});
  return found.get();
 }
 /** Waits until an Intent other than {@code before} is delivered and its data is {@code data}: null once its capture committed, the tap URI while it stays retained. */
 private void awaitDelivered(android.content.Intent before,String data,String message)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){android.content.Intent now=resumedIntent();if(now!=null&&now!=before&&java.util.Objects.equals(data,now.getDataString()))return;SystemClock.sleep(50);}
  fail(message);
 }
 private String state(AlphaCredentialStore store,String id)throws Exception{return new JSONObject(store.readCredentialSlot(WorkflowNoticeTaps.SLOT)).getJSONObject(id).getString("state");}
 /** Fixture route of the restored synthetic owner. */
 private static JSONObject route(JSONObject owner,String run)throws Exception{return new JSONObject(owner.toString()).put("scope","a".repeat(64)).put("workflowId","fixture-flow").put("runId",run).put("versionId","fixture-version");}
 private static void forgetOwner(Context context,AlphaCredentialStore store,JSONObject owner)throws Exception{store.removeCredentialSlot("remote:"+owner.getString("origin"));store.removeCredentialSlot(WorkflowNoticeTaps.OWNER_SLOT);assertTrue(context.getSharedPreferences(WorkflowNoticeOwnerFixture.PREFS,0).edit().clear().commit());}
 private Notification notice(NotificationManager manager,String id){for(StatusBarNotification row:manager.getActiveNotifications())if(("alpha-workflow-"+id).equals(row.getTag()))return row.getNotification();throw new AssertionError("Notice absent");}
 @Test public void twoOpaqueNoticesRetainColdWarmAndFailedCaptureRoutes()throws Exception{
  org.junit.Assume.assumeTrue("Dedicated workflow tap campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowNoticeTap")));
  assertTrue("Runner must own an isolated secondary user",android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);NotificationManager manager=context.getSystemService(NotificationManager.class);
  assertTrue("Fresh secondary fixture required",store.readCredentialSlot(WorkflowNoticeTaps.SLOT)==null);assertTrue("Fresh delivery fixture required",store.readCredentialSlot(WorkflowNoticeDelivery.SLOT)==null);
  String first="fixture_"+UUID.randomUUID(),second="fixture_"+UUID.randomUUID();PendingIntent cold,warm;String firstToken,secondToken;
  // Every MainActivity start re-runs the renderer's owner fence; a signed-out start withdraws other owners' notices.
  // The notices belong to a restored synthetic session, so the cold relaunch keeps the same owner.
  JSONObject owner=WorkflowNoticeOwnerFixture.seed(context);
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context)){
   try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
    fixture.signIn();assertTrue(call("Capacitor.Plugins.AlphaNotifications.status()").getBoolean("appEnabled"));
    for(String id:new String[]{first,second}){
     JSONObject route=route(owner,id);
     JSONObject input=new JSONObject().put("operationId",id).put("bindingHash","b".repeat(64)).put("title","Fixture notification").put("body","Reviewed fixture output").put("route",route);
     // Android publication is asynchronous. Dispatch once, then reconcile only the receipt.
     String publication=call("Capacitor.Plugins.AlphaNotifications.postWorkflow("+input+")").getString("status");
     long publicationEnd=SystemClock.elapsedRealtime()+10000;
     while(!"succeeded".equals(publication)){
      assertEquals("OS publication failed or returned an invalid status","unknown",publication);
      assertTrue("OS publication receipt remained unconfirmed",SystemClock.elapsedRealtime()<publicationEnd);
      SystemClock.sleep(50);
      publication=call("Capacitor.Plugins.AlphaNotifications.workflowReceipt("+input+")").getString("status");
     }
    }
    cold=notice(manager,first).contentIntent;warm=notice(manager,second).contentIntent;assertNotEquals(cold,warm);
    firstToken=WorkflowNoticeTapsFactory.create(context).token(first);secondToken=WorkflowNoticeTapsFactory.create(context).token(second);assertNotEquals(firstToken,secondToken);
   }
   // Hold only this fixture's main looper until its read-only observer is queued.
   // Releasing 1.5 s afterward deterministically exceeds the obsolete 1 s cap.
   java.util.concurrent.CountDownLatch holdEntered=new java.util.concurrent.CountDownLatch(1),releaseHold=new java.util.concurrent.CountDownLatch(1),holdFinished=new java.util.concurrent.CountDownLatch(1);
   java.util.concurrent.atomic.AtomicBoolean holdExpired=new java.util.concurrent.atomic.AtomicBoolean();
   java.util.concurrent.atomic.AtomicReference<Throwable> holdFailure=new java.util.concurrent.atomic.AtomicReference<>();
   coldReadinessQueued=new java.util.concurrent.CountDownLatch(1);
   final java.util.concurrent.CountDownLatch observationQueued=coldReadinessQueued;
   android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());
   Runnable hold=()->{
    holdEntered.countDown();
    try{if(!releaseHold.await(5000,java.util.concurrent.TimeUnit.MILLISECONDS))holdExpired.set(true);}
    catch(InterruptedException error){Thread.currentThread().interrupt();holdFailure.set(error);}
    finally{holdFinished.countDown();}
   };
   Thread release=new Thread(()->{
    try{
     if(!observationQueued.await(2500,java.util.concurrent.TimeUnit.MILLISECONDS))throw new AssertionError("Cold readiness observation was not queued");
     SystemClock.sleep(1500);
    }catch(Throwable error){holdFailure.set(error);}
    finally{releaseHold.countDown();}
   },"alpha-cold-notice-main-release");
   release.setDaemon(true);
   try{
    assertTrue("Owned main-thread hold was posted",handler.post(hold));
    assertTrue("Owned main-thread hold started",holdEntered.await(2000,java.util.concurrent.TimeUnit.MILLISECONDS));
    release.start();
    cold.send();
    JSONObject one=pending(firstToken);assertEquals(first,one.getString("runId"));assertTrue(one.getBoolean("retained"));
    assertFalse("Owned hold exceeded its safety bound",holdExpired.get());assertNull("Owned hold released normally",holdFailure.get());
   }finally{
    releaseHold.countDown();handler.removeCallbacks(hold);coldReadinessQueued=null;
    if(release.isAlive()){release.interrupt();release.join(2000);}
    assertFalse("Fixture release thread stopped",release.isAlive());
    if(holdEntered.getCount()==0)assertTrue("Owned main-thread hold finished",holdFinished.await(2000,java.util.concurrent.TimeUnit.MILLISECONDS));
   }
   // Settle the first tap back to an untapped route, so only the next send can change it.
   JSONObject routes=new JSONObject(store.readCredentialSlot(WorkflowNoticeTaps.SLOT));routes.getJSONObject(first).put("state","new").put("order",0);store.writeCredentialSlot(WorkflowNoticeTaps.SLOT,routes.toString());
   String delivery=store.readCredentialSlot(WorkflowNoticeDelivery.SLOT);JSONObject uncertain=new JSONObject(delivery);uncertain.getJSONObject(first).put("status","unknown");store.writeCredentialSlot(WorkflowNoticeDelivery.SLOT,uncertain.toString());
   android.content.Intent beforeUncertain=resumedIntent();cold.send();
   awaitDelivered(beforeUncertain,WorkflowNoticeTaps.PREFIX+firstToken,"Uncertain-receipt tap reached the activity and stayed retained");
   assertTrue("Capture is refused, so the retained tap reports unavailable",call("Capacitor.Plugins.AlphaNotifications.pendingWorkflowTap()").has("error"));
   assertEquals("An unconfirmed receipt never queues the route","new",state(store,first));
   String saved=store.readCredentialSlot(WorkflowNoticeTaps.SLOT);store.writeCredentialSlot(WorkflowNoticeTaps.SLOT,"[]");
   warm.send();long warmEnd=SystemClock.elapsedRealtime()+15000;java.util.concurrent.atomic.AtomicBoolean captured=new java.util.concurrent.atomic.AtomicBoolean();
   while(SystemClock.elapsedRealtime()<warmEnd&&!captured.get()){BoundedActivityScenario.main(()->{for(android.app.Activity activity:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))if(activity instanceof MainActivity&&activity.getIntent().getData()!=null)captured.set((WorkflowNoticeTaps.PREFIX+secondToken).equals(activity.getIntent().getData().toString()));});SystemClock.sleep(50);}
   assertTrue("Warm failed-capture intent retained",captured.get());assertNotNull(notice(manager,second));
   store.writeCredentialSlot(WorkflowNoticeTaps.SLOT,saved);assertEquals(second,pending(secondToken).getString("runId"));
   assertFalse(call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(secondToken)+"})").has("error"));
   // The confirmed receipt lets the retained uncertain tap capture on its retry.
   store.writeCredentialSlot(WorkflowNoticeDelivery.SLOT,delivery);JSONObject retried=pending(firstToken);assertEquals(first,retried.getString("runId"));assertTrue(retried.getBoolean("retained"));
   // Reconstruct from encrypted storage independently of the plugin instance.
   assertEquals(firstToken,WorkflowNoticeTapsFactory.create(context).pending().getString("token"));
   assertFalse(call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(firstToken)+"})").has("error"));
   android.content.Intent beforeReplay=resumedIntent();cold.send();
   awaitDelivered(beforeReplay,null,"Consumed-tap replay was handled");
   assertFalse(call("Capacitor.Plugins.AlphaNotifications.pendingWorkflowTap()").has("token"));assertEquals("A replay never revives a consumed route","consumed",state(store,first));
  }finally{manager.cancel("alpha-workflow-"+first,0);manager.cancel("alpha-workflow-"+second,0);store.writeCredentialSlot(WorkflowNoticeTaps.SLOT,"{}");store.writeCredentialSlot(WorkflowNoticeDelivery.SLOT,"{}");forgetOwner(context,store,owner);}
 }
 private boolean noticePresent(NotificationManager manager,String id){for(StatusBarNotification row:manager.getActiveNotifications())if(("alpha-workflow-"+id).equals(row.getTag()))return true;return false;}
 @Test public void askActionRetainsPurposeAndRequiresExactVisibleRevision()throws Exception{
  org.junit.Assume.assumeTrue("Dedicated workflow tap campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowNoticeTap")));
  assertTrue("Runner must own an isolated secondary user",android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();AlphaCredentialStore store=new AlphaCredentialStore(context);NotificationManager manager=context.getSystemService(NotificationManager.class);
  assertTrue("Isolated ledger",store.readCredentialSlot(WorkflowNoticeTaps.SLOT)==null||"{}".equals(store.readCredentialSlot(WorkflowNoticeTaps.SLOT)));
  String id="question_"+UUID.randomUUID();JSONObject owner=WorkflowNoticeOwnerFixture.seed(context);
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context);BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   fixture.signIn();
   JSONObject route=route(owner,id);
   JSONObject input=new JSONObject().put("operationId",id).put("bindingHash","b".repeat(64)).put("title","Question fixture").put("body","Reviewed local excerpt").put("route",route);
   String status=call("Capacitor.Plugins.AlphaNotifications.postWorkflow("+input+")").getString("status");
   long end=SystemClock.elapsedRealtime()+10000;
   while(!"succeeded".equals(status)&&SystemClock.elapsedRealtime()<end){SystemClock.sleep(50);status=call("Capacitor.Plugins.AlphaNotifications.workflowReceipt("+input+")").getString("status");}
   assertEquals("succeeded",status);android.app.Notification posted=notice(manager,id);assertEquals(1,posted.actions.length);assertEquals("Ask Alpha",posted.actions[0].title.toString());
   assertNotEquals("Ask and open are distinct immutable intents",posted.contentIntent,posted.actions[0].actionIntent);
   if(android.os.Build.VERSION.SDK_INT>=31)assertTrue(posted.actions[0].isAuthenticationRequired());
   String token=WorkflowNoticeTapsFactory.create(context).token(id);posted.actions[0].actionIntent.send();JSONObject question=pending(token);
   assertTrue(question.getBoolean("question"));assertEquals(owner.getString("ownerId"),question.getString("ownerId"));assertEquals("Reviewed local excerpt",question.getJSONObject("notice").getString("text"));
   String revision=question.getJSONObject("notice").getString("revision");
   assertTrue("A normal open cannot consume an Ask review",call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(token)+"})").has("error"));
   assertTrue("An old revision cannot consume it",call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(token)+",noticeRevision:'wrong'})").has("error"));
   assertFalse("Explicit Cancel settles the Ask tap without consuming it",call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(token)+",discard:true})").has("error"));
   assertFalse("Canceled Ask review does not reopen",WorkflowNoticeTapsFactory.create(context).pending().has("token"));assertTrue("The notice stays usable",noticePresent(manager,id));
   posted.actions[0].actionIntent.send();assertTrue(pending(token).getBoolean("question"));
   PendingIntent open=posted.contentIntent,ask=posted.actions[0].actionIntent;new WorkflowNoticePoster(context).cancel(id);
   assertThrows("Withdrawal revokes the open target",PendingIntent.CanceledException.class,()->open.send());
   assertThrows("Withdrawal revokes the Ask target",PendingIntent.CanceledException.class,()->ask.send());
   long removed=SystemClock.elapsedRealtime()+5000;while(noticePresent(manager,id)&&SystemClock.elapsedRealtime()<removed)SystemClock.sleep(50);
   JSONObject gone=pending(token);assertFalse("Gone own notice exposes no excerpt",gone.has("notice"));assertFalse("Gone notice settles as a plain open tap",gone.has("question"));
   assertTrue("Its old revision no longer applies",call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(token)+",noticeRevision:"+JSONObject.quote(revision)+"})").has("error"));
   assertFalse(call("Capacitor.Plugins.AlphaNotifications.consumeWorkflowTap({token:"+JSONObject.quote(token)+"})").has("error"));
   assertFalse(WorkflowNoticeTapsFactory.create(context).pending().has("token"));
  }finally{manager.cancel("alpha-workflow-"+id,0);store.removeCredentialSlot(WorkflowNoticeTaps.SLOT);store.removeCredentialSlot(WorkflowNoticeDelivery.SLOT);forgetOwner(context,store,owner);}
 }

}
