package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.app.*;
import android.content.*;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Actual Android notifications -> Android's own shade -> the notification's own tap (#416).
 * Alpha draws no shade of its own: the page has no notification layer, Android shows the notice,
 * and the tap reaches the PendingIntent the notice was posted with. The shade is opened with
 * Android's own global action on both flavors; the launcher button is SystemShadeInstrumentedTest's.
 * Needs a test-mocks app build: a production Android build covers Home with the Eliza Cloud sign-in
 * gate. Emulator evidence only; not AOSP-image or device acceptance.
 */
@RunWith(AndroidJUnit4.class)
public class NotificationsInstrumentedTest {
 private void until(String condition)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+condition+")")))return;SystemClock.sleep(100);}fail("Notification state: "+condition);}
 private boolean present(NotificationManager manager,String tag,int id){for(android.service.notification.StatusBarNotification row:manager.getActiveNotifications())if(tag.equals(row.getTag())&&row.getId()==id)return true;return false;}
 /**
  * Opens Android's shade with Android's own global action on both flavors, so notice delivery is
  * tested independently of Alpha's launcher button (that mechanism is SystemShadeInstrumentedTest's).
  */
 private void openShade()throws Exception{
  until(AppNavigation.selected("Home"));
  until(AndroidShade.ALPHA_SHADE_ABSENT);
  assertTrue("Android's own action opens its shade",AndroidShade.openWithoutAlpha());
  // Still no Alpha panel behind it.
  assertEquals("true",WebViewTestDriver.evaluate(AndroidShade.ALPHA_SHADE_ABSENT));
 }
 @Test public void actualNotificationsAppearAndOpenInAndroidsShade()throws Exception{
  org.junit.Assume.assumeTrue("Home is reachable without an account only in a test-mocks app build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();NotificationManager manager=context.getSystemService(NotificationManager.class);
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
  ReminderTestAccess.channel(context);String token=java.util.UUID.randomUUID().toString(),title="Synthetic notification "+token,tag="notification-fixture-"+token;
  String action="alpha.synthetic.notification.open."+token;java.util.concurrent.atomic.AtomicBoolean delivered=new java.util.concurrent.atomic.AtomicBoolean();
  BroadcastReceiver receiver=new BroadcastReceiver(){@Override public void onReceive(Context ignored,Intent intent){if(action.equals(intent.getAction()))delivered.set(true);}};
  if(android.os.Build.VERSION.SDK_INT>=33)context.registerReceiver(receiver,new IntentFilter(action),Context.RECEIVER_NOT_EXPORTED);else context.registerReceiver(receiver,new IntentFilter(action));
  PendingIntent tap=PendingIntent.getBroadcast(context,token.hashCode(),new Intent(action).setPackage(context.getPackageName()),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Home"));until("document.querySelector('[data-screen]')&&!document.querySelector('.alpha-connection-scrim')");
   AppNavigation.declineStartupAccess();
   manager.notify(tag,1,new Notification.Builder(context,ReminderTestAccess.CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle(title).setContentText("Actual Android fixture body").setContentIntent(tap).setAutoCancel(true).build());
   // The plugin still refuses to open or dismiss a notice it never identified.
   WebViewTestDriver.evaluate("window.__missingNoticeRejected=undefined;Capacitor.Plugins.AlphaNotifications.open({}).then(()=>window.__missingNoticeRejected=false,()=>window.__missingNoticeRejected=true)");
   until("window.__missingNoticeRejected===true");
   WebViewTestDriver.evaluate("window.__missingDismissFinished=false;Capacitor.Plugins.AlphaNotifications.dismiss({}).then(()=>window.__missingDismissFinished=true)");until("window.__missingDismissFinished===true");
   assertTrue("Missing opaque ID cannot open or dismiss an unseen notification",present(manager,tag,1));
   openShade();
   AccessibilityNodeInfo row=AndroidShade.waitText(title,10000);
   assertNotNull("Android's shade shows the posted notice",row);
   assertTrue("The notice row in Android's shade is tappable",AndroidShade.tap(row));
   for(int i=0;i<100&&!delivered.get();i++)SystemClock.sleep(100);
   assertTrue("The tap reached the notice's own PendingIntent",delivered.get());
   boolean removed=false;for(int i=0;i<100&&!(removed=!present(manager,tag,1));i++)SystemClock.sleep(100);
   assertTrue("Opening an auto-cancel notice removes the real Android notification",removed);
   if(AndroidShade.isOpen())AndroidShade.collapse();
   // A recreated page still draws no shade of its own.
   scenario.recreate();WebViewTestDriver.evaluate(AppNavigation.request("Home"));until("document.querySelector('[data-screen]')&&!document.querySelector('.alpha-connection-scrim')");
   until(AndroidShade.ALPHA_SHADE_ABSENT);
  }finally{if(AndroidShade.isOpen())AndroidShade.collapse();manager.cancel(tag,1);tap.cancel();context.unregisterReceiver(receiver);}
 }
 /** A canceled target must not be confused with a neighboring live notice in SystemUI. */
 @Test public void goneTargetNeverDispatchesOrOpensItsNeighbor()throws Exception{
  org.junit.Assume.assumeTrue("Home is reachable without an account only in a test-mocks app build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();NotificationManager manager=context.getSystemService(NotificationManager.class);
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
  ReminderTestAccess.channel(context);String token=java.util.UUID.randomUUID().toString(),tag="gone-target-"+token;
  String goneAction="alpha.synthetic.gone."+token,liveAction="alpha.synthetic.live."+token,goneTitle="Gone target "+token,liveTitle="Live neighbor "+token;
  java.util.concurrent.atomic.AtomicInteger gone=new java.util.concurrent.atomic.AtomicInteger(),live=new java.util.concurrent.atomic.AtomicInteger();
  BroadcastReceiver receiver=new BroadcastReceiver(){@Override public void onReceive(Context ignored,Intent intent){if(goneAction.equals(intent.getAction()))gone.incrementAndGet();if(liveAction.equals(intent.getAction()))live.incrementAndGet();}};
  IntentFilter filter=new IntentFilter(goneAction);filter.addAction(liveAction);
  if(android.os.Build.VERSION.SDK_INT>=33)context.registerReceiver(receiver,filter,Context.RECEIVER_NOT_EXPORTED);else context.registerReceiver(receiver,filter);
  PendingIntent goneTap=PendingIntent.getBroadcast(context,1,new Intent(goneAction).setPackage(context.getPackageName()),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  PendingIntent liveTap=PendingIntent.getBroadcast(context,2,new Intent(liveAction).setPackage(context.getPackageName()),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Home"));until("document.querySelector('[data-screen]')&&!document.querySelector('.alpha-connection-scrim')");AppNavigation.declineStartupAccess();
   manager.notify(tag,1,new Notification.Builder(context,ReminderTestAccess.CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle(goneTitle).setContentText("Synthetic removed target").setContentIntent(goneTap).setAutoCancel(true).build());
   manager.notify(tag,2,new Notification.Builder(context,ReminderTestAccess.CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle(liveTitle).setContentText("Synthetic positive control").setContentIntent(liveTap).setAutoCancel(true).build());
   goneTap.cancel();assertThrows(PendingIntent.CanceledException.class,()->goneTap.send());
   openShade();AccessibilityNodeInfo stale=AndroidShade.waitText(goneTitle,10000);assertNotNull("The stale row remains visible after its target is canceled",stale);assertTrue(AndroidShade.tap(stale));
   SystemClock.sleep(500);assertEquals("Canceled target dispatches nothing",0,gone.get());assertEquals("A failed tap must not dispatch its neighbor",0,live.get());assertTrue("The neighbor remains posted",present(manager,tag,2));
   if(AndroidShade.isOpen())AndroidShade.collapse();openShade();AccessibilityNodeInfo neighbor=AndroidShade.waitText(liveTitle,10000);assertNotNull(neighbor);assertTrue(AndroidShade.tap(neighbor));
   long end=SystemClock.elapsedRealtime()+10000;while(live.get()==0&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(100);
   assertEquals("The same SystemUI path still dispatches the live target",1,live.get());assertEquals("No delayed stale dispatch",0,gone.get());
   if(AndroidShade.isOpen())AndroidShade.collapse();until(AndroidShade.ALPHA_SHADE_ABSENT);
  }finally{if(AndroidShade.isOpen())AndroidShade.collapse();manager.cancel(tag,1);manager.cancel(tag,2);goneTap.cancel();liveTap.cancel();context.unregisterReceiver(receiver);}
 }
 private JSONObject call(String expression)throws Exception{
  WebViewTestDriver.evaluate("window.__contextResult=null;Promise.resolve().then(()=>"+expression+").then(v=>window.__contextResult=JSON.stringify(v),()=>window.__contextResult=JSON.stringify({error:true}))");
  for(int i=0;i<300;i++){String raw=WebViewTestDriver.evaluate("window.__contextResult");if(!"null".equals(raw))return new JSONObject((String)new org.json.JSONTokener(raw).nextValue());SystemClock.sleep(50);}
  throw new AssertionError("Notification bridge did not complete");
 }
 /** Own-notification agent identities: the native list gives Alpha Phone's own rows the opaque,
  * bounded id/revision that phone-context accepts, never derived from title, text, tag or package. */
 @Test public void ownNotificationIdentitiesAreOpaqueAndBounded()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();android.app.NotificationManager manager=context.getSystemService(android.app.NotificationManager.class);
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
  ai.eliza.plugins.reminders.ReminderTestAccess.channel(context);
  String token=java.util.UUID.randomUUID().toString().replace("-",""),title="PRIVATE_NOTICE_TITLE_"+token,body="PRIVATE_NOTICE_BODY_"+token,tag="context-identity-"+token;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();WebViewTestDriver.evaluate(AppNavigation.request("Home"));until("document.querySelector('[data-screen]')");
   for(int i=0;i<100&&!"true".equals(WebViewTestDriver.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaNotifications)"));i++)SystemClock.sleep(100);
   // Rows already listed (for example another test's secret notice) never stand in for this test's rows.
   java.util.Set<String> earlier=new java.util.HashSet<>();JSONObject initial=call("Capacitor.Plugins.AlphaNotifications.list()");assertFalse("Own notifications are readable in the foreground",initial.has("error"));
   for(int i=0;i<initial.getJSONArray("items").length();i++)earlier.add(initial.getJSONArray("items").getJSONObject(i).getString("id"));
   manager.notify(tag,1,new android.app.Notification.Builder(context,ai.eliza.plugins.reminders.ReminderTestAccess.CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle(title).setContentText(body).build());
   manager.notify(tag,2,new android.app.Notification.Builder(context,ai.eliza.plugins.reminders.ReminderTestAccess.CHANNEL).setSmallIcon(android.R.drawable.ic_popup_reminder).setContentTitle(title+"_SECRET").setContentText(body).setVisibility(android.app.Notification.VISIBILITY_SECRET).build());
   JSONObject own=null,secret=null;org.json.JSONArray items=null;
   for(int attempt=0;attempt<50&&(own==null||secret==null);attempt++){
    JSONObject listed=call("Capacitor.Plugins.AlphaNotifications.list()");assertFalse("Own notifications are readable in the foreground",listed.has("error"));
    items=listed.getJSONArray("items");own=null;secret=null;
    for(int i=0;i<items.length();i++){JSONObject row=items.getJSONObject(i);if(title.equals(row.optString("title")))own=row;else if("own".equals(row.optString("source"))&&row.optString("title").equals("Alpha Phone notification")&&!earlier.contains(row.optString("id")))secret=row;}
    if(own==null||secret==null)SystemClock.sleep(100);
   }
   assertNotNull("Posted own notification is listed",own);assertNotNull("Secret own notification is listed with hidden content",secret);
   java.util.regex.Pattern opaque=java.util.regex.Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");
   for(JSONObject row:new JSONObject[]{own,secret}){
    assertEquals("own",row.getString("source"));
    for(String field:new String[]{"id","revision"}){String value=row.getString(field);assertTrue("Opaque bounded "+field+" accepted by phone-context",opaque.matcher(value).matches());for(String forbidden:new String[]{token,tag,context.getPackageName(),"PRIVATE"})assertFalse(field+" never carries content or provenance",value.contains(forbidden));}
   }
   assertFalse("Secret content stays on the phone",secret.toString().contains(body));assertNotEquals(own.getString("id"),secret.getString("id"));
   // The identity is stable while the row is unchanged, so a selection made in the shade still resolves.
   JSONObject again=call("Capacitor.Plugins.AlphaNotifications.list()");boolean stable=false;org.json.JSONArray rows=again.getJSONArray("items");for(int i=0;i<rows.length();i++)if(own.getString("id").equals(rows.getJSONObject(i).getString("id"))&&own.getString("revision").equals(rows.getJSONObject(i).getString("revision")))stable=true;
   assertTrue("Unchanged own row keeps its opaque identity",stable);
   // Other apps' rows are labelled external and are never offered as an own identity.
   for(int i=0;i<items.length();i++){JSONObject row=items.getJSONObject(i);assertTrue("Every row declares its source",java.util.Arrays.asList("own","external").contains(row.getString("source")));if("external".equals(row.getString("source")))assertNotEquals("Alpha Phone",row.optString("appLabel"));}
  }finally{manager.cancel(tag,1);manager.cancel(tag,2);}
 }
}
