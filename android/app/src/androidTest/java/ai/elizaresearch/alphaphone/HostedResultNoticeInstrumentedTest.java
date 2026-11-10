package ai.elizaresearch.alphaphone;
import android.app.NotificationManager;
import android.os.SystemClock;
import android.service.notification.StatusBarNotification;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import java.util.UUID;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

/** Explicit campaign only. The runner owns notification permission state in a temporary user:
 * node scripts/test-native-permissions.ts notice|notice-denied APP.apk TEST.apk NEW_OUTPUT. */
public final class HostedResultNoticeInstrumentedTest {
 private JSONObject call(String expression)throws Exception {
  long ready=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<ready&&!"true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaHostedResults)")))SystemClock.sleep(50);
  String global="__hostedNativeFixture";WebViewTestDriver.evaluate("window."+global+"=null;Promise.resolve().then(()=>"+expression+").then(v=>window."+global+"=JSON.stringify(v||{}),()=>window."+global+"=JSON.stringify({error:true}))");
  long end=SystemClock.elapsedRealtime()+20000;
  while(SystemClock.elapsedRealtime()<end){String raw=WebViewTestDriver.evaluate("window."+global);if(!"null".equals(raw)&&!"undefined".equals(raw))return new JSONObject((String)new JSONTokener(raw).nextValue());SystemClock.sleep(50);}throw new AssertionError("Native call timed out");
 }
 // Hosted digest slots are native-only (RendererCredentialSlots): the page cannot read or write them,
 // so the fixture uses the same native store the product's hosted delivery reads.
 private AlphaCredentialStore store(){return new AlphaCredentialStore(InstrumentationRegistry.getInstrumentation().getTargetContext());}
 private void save(String slot,JSONObject value)throws Exception {store().writeCredentialSlot(slot,value.toString());}
 private JSONObject read(String slot)throws Exception {String raw=store().readCredentialSlot(slot);return raw==null?new JSONObject():new JSONObject(raw);}
 private void cleanNotice(String key)throws Exception {
  java.util.concurrent.atomic.AtomicReference<AlphaHostedResultsPlugin> plugin=new java.util.concurrent.atomic.AtomicReference<>();java.util.concurrent.atomic.AtomicReference<AlphaConnectionPlugin> store=new java.util.concurrent.atomic.AtomicReference<>();
  BoundedActivityScenario.main(()->{for(android.app.Activity a:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(androidx.test.runner.lifecycle.Stage.RESUMED))if(a instanceof MainActivity){plugin.set((AlphaHostedResultsPlugin)((MainActivity)a).getBridge().getPlugin("AlphaHostedResults").getInstance());store.set((AlphaConnectionPlugin)((MainActivity)a).getBridge().getPlugin("AlphaConnection").getInstance());}});
  assertNotNull(plugin.get());/* The plugin no longer keeps a notices field; it reads the shared delivery's. */Object lock=HostedDelivery.get(plugin.get().getContext()).notices;assertNotNull(lock);
  synchronized(lock){String raw=store.get().readCredentialSlot(HostedResultNotices.LEDGER);JSONObject ledger=raw==null?new JSONObject():new JSONObject(raw);ledger.remove(key);store.get().writeCredentialSlot(HostedResultNotices.LEDGER,ledger.toString());raw=store.get().readCredentialSlot(HostedResultNotices.PENDING);JSONObject pending=raw==null?new JSONObject():new JSONObject(raw);if(key.equals(pending.optString("key")))store.get().writeCredentialSlot(HostedResultNotices.PENDING,"{}");}
 }
 private StatusBarNotification notice(String key){for(StatusBarNotification n:InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(NotificationManager.class).getActiveNotifications())if(key.equals(n.getTag()))return n;return null;}
 // NotificationManager.notify queues work in system_server; successful publication does not
 // imply getActiveNotifications has observed it yet. Poll only visibility, never republish.
 private StatusBarNotification awaitNotice(String key){
  long end=SystemClock.elapsedRealtime()+10000;StatusBarNotification posted;
  do{posted=notice(key);if(posted!=null)return posted;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);
  return null;
 }
 private void run(boolean granted)throws Exception {
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   assertEquals("External runner must configure notification permission/channel",granted,call("Capacitor.Plugins.AlphaHostedResults.status()").getBoolean("enabled"));
   String run="fixture_"+UUID.randomUUID(),origin="https://hosted-fixture.invalid",owner=UUID.randomUUID().toString(),agent=UUID.randomUUID().toString(),scope=HostedResultNotices.hash(new JSONArray().put(origin).put(owner).put(agent).toString()),slot="hosted-digests:v1:"+scope,key=HostedResultNotices.hash(scope+":"+run),secret="PRIVATE-HOSTED-FIXTURE-"+UUID.randomUUID();
   JSONObject route=new JSONObject().put("scope",scope).put("origin",origin).put("ownerId",owner).put("agentId",agent).put("runId",run).put("workflowId",run).put("workflowVersionId","version1");
   try {
    assertTrue("The page cannot write a native-only result slot",call("Capacitor.Plugins.AlphaConnection.secureWrite({slot:"+JSONObject.quote(slot)+",value:'{}'})").has("error"));
    assertTrue("The page cannot read a native-only result slot",call("Capacitor.Plugins.AlphaConnection.secureRead({slot:"+JSONObject.quote(slot)+"})").has("error"));
    save(slot,new JSONObject().put("ids",new JSONArray().put(run)));save(slot+":"+run,new JSONObject().put("runId",run).put("workflowId",run).put("workflowVersionId","version1").put("output",secret));
    File file=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials/"+HostedResultNotices.hash(slot+":"+run));assertFalse(new String(Files.readAllBytes(file.toPath()),StandardCharsets.ISO_8859_1).contains(secret));
    assertEquals(granted?"posted":"denied",call("Capacitor.Plugins.AlphaHostedResults.publishResult("+route+")").getString("phase"));
    if(granted){StatusBarNotification posted=awaitNotice(key);assertNotNull("Published notice must become visible in NotificationManager",posted);assertEquals(AlphaHostedResultsPlugin.CHANNEL,posted.getNotification().getChannelId());assertEquals(android.app.Notification.VISIBILITY_PRIVATE,posted.getNotification().visibility);assertFalse(posted.getNotification().extras.toString().contains(owner));assertFalse(posted.getNotification().extras.toString().contains(secret));assertFalse(posted.getNotification().publicVersion.extras.toString().contains(secret));posted.getNotification().contentIntent.send();
     JSONObject tap=null;for(int i=0;i<100;i++){tap=call("Capacitor.Plugins.AlphaHostedResults.pendingResult()");if(key.equals(tap.optString("key")))break;SystemClock.sleep(100);}assertNotNull(tap);assertEquals(key,tap.getString("key"));String token=tap.getString("token");
     activity.recreate();AppNavigation.liveMode();JSONObject restored=call("Capacitor.Plugins.AlphaHostedResults.pendingResult()");assertEquals(token,restored.getString("token"));assertEquals(run,restored.getString("runId"));assertTrue(restored.getBoolean("retained"));
     assertFalse(call("Capacitor.Plugins.AlphaHostedResults.consumeResult({token:"+JSONObject.quote(token)+"})").has("error"));assertEquals("opened",call("Capacitor.Plugins.AlphaHostedResults.publishResult("+route+")").getString("phase"));assertNull(notice(key));
    }else{
     assertNull("No notice is posted while notifications are denied",notice(key));
     // The result is still in encrypted history, where the in-app list reads it.
     assertEquals(secret,read(slot+":"+run).getString("output"));assertEquals(run,read(slot).getJSONArray("ids").getString(0));
     assertFalse("Stored result stays encrypted at rest",new String(Files.readAllBytes(file.toPath()),StandardCharsets.ISO_8859_1).contains(secret));
     // Asking again neither posts a notice nor changes the retained result.
     assertEquals("denied",call("Capacitor.Plugins.AlphaHostedResults.publishResult("+route+")").getString("phase"));assertNull(notice(key));
     assertTrue("No tap is pending for a notice that was never posted",!key.equals(call("Capacitor.Plugins.AlphaHostedResults.pendingResult()").optString("key")));
     assertEquals(secret,read(slot+":"+run).getString("output"));
    }
   } finally {
    cleanNotice(key);
    InstrumentationRegistry.getInstrumentation().getTargetContext().getSystemService(NotificationManager.class).cancel(key,0);
    store().removeCredentialSlot(slot);store().removeCredentialSlot(slot+":"+run);
   }
  }
 }
 @Test public void redactedNoticeTapSurvivesRecreationWithoutReplay()throws Exception {org.junit.Assume.assumeTrue("Dedicated hosted notice campaign","1".equals(InstrumentationRegistry.getArguments().getString("hostedNotice")));run(true);}
 @Test public void deniedNotificationRetainsEncryptedHistory()throws Exception {org.junit.Assume.assumeTrue("Dedicated denied notice campaign","1".equals(InstrumentationRegistry.getArguments().getString("hostedNoticeDenied")));run(false);}
 /** Builders only: no OS notification is posted. */
 @Test public void resultAndRenewalBuildersExpireAndStayRedacted()throws Exception {
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();HostedNoticePoster poster=new HostedNoticePoster(context);
  android.app.PendingIntent tap=android.app.PendingIntent.getActivity(context,0,new android.content.Intent(context,MainActivity.class),android.app.PendingIntent.FLAG_IMMUTABLE);
  android.app.Notification result=poster.result(tap,new android.app.Notification.Builder(context,AlphaHostedResultsPlugin.CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder).build()).build();
  assertEquals(HostedResultNotices.SUPERSEDE_AFTER_MS,result.getTimeoutAfter());assertEquals(AlphaHostedResultsPlugin.CHANNEL,result.getChannelId());assertEquals(android.app.Notification.VISIBILITY_PRIVATE,result.visibility);
  android.app.Notification silent=poster.result(tap,result.publicVersion,null,true).build();
  assertEquals("alpha-hosted-results-visible",silent.getGroup());
  assertEquals(android.app.Notification.GROUP_ALERT_SUMMARY,silent.getGroupAlertBehavior());
  assertEquals("Silencing does not move the notice to another channel",result.getChannelId(),silent.getChannelId());
  assertNull("An ordinary result keeps the channel alert behavior",result.getGroup());
  assertEquals(android.app.Notification.GROUP_ALERT_ALL,result.getGroupAlertBehavior());
  long now=System.currentTimeMillis(),expiresAt=now+5*3600000L;String source=UUID.randomUUID().toString();
  android.app.Notification renewal=poster.renewal(source,expiresAt,now).build();
  assertEquals(5*3600000L,renewal.getTimeoutAfter());
  // Renew opens the review (it never renews by itself); Ask Alpha opens a question about this source and needs unlock.
  assertEquals(2,renewal.actions.length);assertEquals("Renew",renewal.actions[0].title.toString());assertEquals("Renew only opens the review",renewal.contentIntent,renewal.actions[0].actionIntent);
  assertEquals("Ask Alpha",renewal.actions[1].title.toString());assertNull("Ask has no inline send input",renewal.actions[1].getRemoteInputs());assertNotEquals("Ask is its own route, not the Renew review",renewal.contentIntent,renewal.actions[1].actionIntent);
  if(android.os.Build.VERSION.SDK_INT>=31)assertTrue("Ask requires unlock",renewal.actions[1].isAuthenticationRequired());
  assertEquals(android.app.Notification.VISIBILITY_PRIVATE,renewal.visibility);assertNotNull(renewal.publicVersion);
  assertFalse(renewal.extras.toString().contains(source));assertTrue(HostedNoticePoster.renewalTag(source).endsWith(source));
  assertThrows(IllegalArgumentException.class,()->poster.renewal("../escape",expiresAt,now));
 }
}
