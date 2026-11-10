package ai.alphacompute.alphaphone;

import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import static ai.alphacompute.alphaphone.NotificationAccessTestDriver.*;
import static org.junit.Assert.*;

/** Real, separately signed/UID synthetic apps only. Never selects a user's app. */
public final class CrossAppNotificationsInstrumentedTest {
 /** Hold the real listener worker, not the Android provider or a fabricated notification. */
 private void queuedEventCannotRepopulateClearedHistory(String nonce)throws Exception{
  AlphaNotificationListener service=NotificationAccess.listener();assertNotNull("Actual connected listener",service);
  java.lang.reflect.Field field=ai.eliza.plugins.notifications.NotificationMirrorListenerService.class.getDeclaredField("events");field.setAccessible(true);
  java.util.concurrent.ThreadPoolExecutor worker=(java.util.concurrent.ThreadPoolExecutor)field.get(service);
  waitFor(()->worker.getActiveCount()==0&&worker.getQueue().isEmpty(),"Listener worker drained before controlled race");
  java.util.concurrent.CountDownLatch held=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.atomic.AtomicBoolean expired=new java.util.concurrent.atomic.AtomicBoolean();
  worker.execute(()->{held.countDown();try{if(!release.await(60,java.util.concurrent.TimeUnit.SECONDS))expired.set(true);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();expired.set(true);}});
  try{
   assertTrue("Test-only worker barrier entered",held.await(8,java.util.concurrent.TimeUnit.SECONDS));
   witness(SELECTED,nonce,"replace");
   waitFor(()->!worker.getQueue().isEmpty(),"Actual companion notification callback queued behind barrier");
   assertSame("No substituted listener",service,NotificationAccess.listener());
   long observedGeneration=NotificationAccess.eventGeneration();
   value("clearNotificationHistory",new JSONObject());
   assertTrue("Clear invalidates callbacks before acknowledgement",NotificationAccess.eventGeneration()>observedGeneration);
   assertFalse("Clear removes retained encrypted file",new java.io.File(context().getNoBackupFilesDir(),"notification-history.enc").exists());
  }finally{release.countDown();}
  waitFor(()->worker.getActiveCount()==0&&worker.getQueue().isEmpty(),"Queued actual callback finished");
  assertFalse("Controlled race did not expire",expired.get());
  assertEquals("Earlier queued event cannot reappear after Clear",0,value("notificationHistory",new JSONObject()).getJSONArray("items").length());
  // The boundary must not silently disable history or future permitted events.
  witness(SELECTED,nonce,"replace");
  waitFor(()->value("notificationHistory",new JSONObject()).getJSONArray("items").length()>0,"A new post after Clear is retained normally");
 }
 @Test public void explicitGrantSignatureSelectionPreviewSnapshotActionsHistoryAndMockPause()throws Exception{
  org.junit.Assume.assumeTrue("Mock mode exists only in -PELIZA_DEV_ALLOW_TEST_MOCKS=1 builds",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  org.junit.Assume.assumeTrue("Dedicated disposable fixture runner required","1".equals(InstrumentationRegistry.getArguments().getString("crossNotifications")));
  Context c=context();assertFalse("Refuse preexisting Android notification access",NotificationAccess.granted(c));JSONObject initial=status();assertFalse(initial.getBoolean("enabled"));assertEquals(0,initial.getJSONArray("apps").length());assertFalse(initial.getBoolean("history"));
  assertNotEquals(c.getApplicationInfo().uid,c.getPackageManager().getApplicationInfo(SELECTED,0).uid);
  assertNotEquals(c.getApplicationInfo().uid,c.getPackageManager().getApplicationInfo(EXCLUDED,0).uid);
  assertNotEquals(NotificationAccess.signature(c,c.getPackageName()),NotificationAccess.signature(c,SELECTED));
  assertNotEquals(NotificationAccess.signature(c,c.getPackageName()),NotificationAccess.signature(c,EXCLUDED));
  String nonce=java.util.UUID.randomUUID().toString(),other=java.util.UUID.randomUUID().toString();Throwable primary=null;
  java.util.Map<String,?> prior=new java.util.HashMap<>(NotificationAccess.prefs(c).getAll());
  ui().grantRuntimePermission(SELECTED,android.Manifest.permission.POST_NOTIFICATIONS);ui().grantRuntimePermission(EXCLUDED,android.Manifest.permission.POST_NOTIFICATIONS);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();foreground();
   assertEquals(0,foreignCount(feed()));value("openNotificationAccess",new JSONObject());SystemClock.sleep(500);WebViewTestDriver.pressBack();foreground();assertFalse("Cancel does not grant access",NotificationAccess.granted(c));
   witness(SELECTED,nonce,"post");witness(EXCLUDED,other,"post");access(true);
   policy(new JSONObject().put("enabled",true));value("resumeCrossApp",new JSONObject().put("expectedRevision",status().getString("revision")));
   waitFor(()->status().getBoolean("connected"),"Actual listener connected");assertEquals("Grant alone with empty selection exposes no foreign rows",0,foreignCount(feed()));
   policy(new JSONObject().put("apps",new JSONArray().put(new JSONObject().put("packageName",SELECTED).put("preview",false))));
   waitFor(()->foreignCount(feed())==5,"Five synthetic selected rows");String redacted=feed().toString();assertFalse(redacted.contains(nonce));assertFalse(redacted.contains(other));assertFalse(redacted.contains("Canary"));
   policy(new JSONObject().put("apps",new JSONArray().put(new JSONObject().put("packageName",SELECTED).put("preview",true))).put("history",true));
   JSONArray shown=feed();assertFalse(shown.toString().contains(other));assertTrue(shown.toString().contains("Canary "+SELECTED));
   JSONObject first=external(shown," 1"),noAction=external(shown," 5"),ongoing=external(shown," 4");assertFalse(noAction.getBoolean("canOpen"));assertFalse(ongoing.getBoolean("clearable"));
   // A real Android replacement invalidates an old opaque action, even if the posting key is reused.
   witness(SELECTED,nonce,"replace");waitFor(()->!external(feed()," 1").getString("revision").equals(first.getString("revision")),"Replacement revision");assertFalse(bridge("open",first).getBoolean("ok"));
   JSONObject replacement=external(feed()," 1");value("open",replacement);
   waitFor(()->{AccessibilityNodeInfo root=ui().getRootInActiveWindow();return root!=null&&SELECTED.contentEquals(root.getPackageName())&&!root.findAccessibilityNodeInfosByText("Tapped "+nonce+" count 1").isEmpty();},"Exact synthetic PendingIntent tap receipt");foreground();
   waitFor(()->foreignCount(feed())==4,"Auto-cancel reconciled from Android");
   JSONArray immutable=new JSONArray(),visible=feed();for(int i=0;i<visible.length();i++)if("external".equals(visible.getJSONObject(i).optString("source")))immutable.put(visible.getJSONObject(i));value("clear",new JSONObject().put("items",immutable));waitFor(()->foreignCount(feed())==1,"Only ongoing selected notice remains");
   assertEquals("Unselected package notices were not dismissed",5,NotificationAccess.listener().getActiveNotifications()==null?-1:java.util.Arrays.stream(NotificationAccess.listener().getActiveNotifications()).filter(n->EXCLUDED.equals(n.getPackageName())&&other.equals(n.getTag())).count());
   JSONArray history=value("notificationHistory",new JSONObject()).getJSONArray("items");assertTrue(history.length()>0);assertFalse(history.toString().contains(nonce));assertFalse(history.toString().contains(other));assertFalse(history.toString().contains("Canary"));
   byte[] disk=java.nio.file.Files.readAllBytes(new java.io.File(c.getNoBackupFilesDir(),"notification-history.enc").toPath());assertFalse(new String(disk,java.nio.charset.StandardCharsets.ISO_8859_1).contains(nonce));
   scenario.recreate();AppNavigation.liveMode();foreground();assertTrue(value("notificationHistory",new JSONObject()).getJSONArray("items").length()>0);
   queuedEventCannotRepopulateClearedHistory(nonce);
   WebViewTestDriver.evaluate("window.__paused=false;Capacitor.nativePromise('AlphaConnection','pauseNotificationCollection',{}).then(()=>window.__paused=true)");waitFor(()->"true".equals(WebViewTestDriver.evaluate("window.__paused")),"Native mock pause acknowledged");assertTrue(status().getBoolean("paused"));assertEquals(0,foreignCount(feed()));assertEquals(0,value("notificationHistory",new JSONObject()).getJSONArray("items").length());
   scenario.recreate();AppNavigation.liveMode();foreground();assertTrue("Pause survives Activity recreation",status().getBoolean("paused"));assertEquals(0,foreignCount(feed()));
   value("resumeCrossApp",new JSONObject().put("expectedRevision",status().getString("revision")));waitFor(()->status().getBoolean("connected"),"Explicit resume reconnects");
   policy(new JSONObject().put("apps",new JSONArray()));assertEquals(0,foreignCount(feed()));assertEquals(0,value("notificationHistory",new JSONObject()).getJSONArray("items").length());
   access(false);assertFalse(status().getBoolean("accessGranted"));assertEquals(0,foreignCount(feed()));
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}
  finally{
   Throwable cleanup=null;
   try{foreground();AppNavigation.liveMode();if(NotificationAccess.granted(c))access(false);NotificationAccess.update(c,new com.getcapacitor.JSObject(new JSONObject().put("expectedRevision",status().getString("revision")).put("enabled",false).put("history",false).put("apps",new JSONArray()).toString()));witness(SELECTED,nonce,"cleanup");witness(EXCLUDED,other,"cleanup");android.content.SharedPreferences.Editor editor=NotificationAccess.prefs(c).edit().clear();for(java.util.Map.Entry<String,?> e:prior.entrySet()){if(e.getValue() instanceof String)editor.putString(e.getKey(),(String)e.getValue());else if(e.getValue() instanceof Boolean)editor.putBoolean(e.getKey(),(Boolean)e.getValue());else throw new AssertionError("Unknown preexisting policy storage type");}assertTrue(editor.commit());assertFalse(NotificationAccess.granted(c));}catch(Exception|AssertionError failed){cleanup=failed;}
   if(cleanup!=null){if(primary!=null)primary.addSuppressed(cleanup);else throw new AssertionError("Synthetic notification cleanup failed",cleanup);}
  }
 }
}
