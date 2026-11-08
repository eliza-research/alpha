package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.os.SystemClock;
import android.view.KeyEvent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Real bundled WebView -> Capacitor -> Android activity flows. No mocked plugins. */
@RunWith(AndroidJUnit4.class)
public class DailyAppsInstrumentedTest {
 private String evaluate(BoundedActivityScenario<MainActivity> scenario, String js) throws Exception {
  return WebViewTestDriver.evaluate(js);
 }
 private void ready(BoundedActivityScenario<MainActivity> scenario) throws Exception {
  for (int i = 0; i < 100; i++) {
   if ("true".equals(evaluate(scenario, "Boolean(document.querySelector('[data-screen]') && window.Capacitor?.Plugins?.DailyApps)"))) return;
   SystemClock.sleep(100);
  }
  fail("DailyApps bridge did not mount");
 }
 private JSONObject result(BoundedActivityScenario<MainActivity> scenario) throws Exception {
  for (int i = 0; i < 100; i++) {
   String value = evaluate(scenario, "window.__dailyTestResult || null");
   if (!"null".equals(value)) return new JSONObject((String)new JSONTokener(value).nextValue());
   SystemClock.sleep(100);
  }
  fail("DailyApps did not resolve"); return null;
 }
 private void begin(BoundedActivityScenario<MainActivity> scenario, String expression) throws Exception {
  evaluate(scenario, "window.__dailyTestResult=null; (" + expression + ").then(v=>window.__dailyTestResult=JSON.stringify(v)).catch(e=>window.__dailyTestResult=JSON.stringify({error:String(e)}))");
 }
 private void uiWait(BoundedActivityScenario<MainActivity> scenario, String condition) throws Exception {
  for(int i=0;i<100;i++){if("true".equals(evaluate(scenario,"Boolean("+condition+")")))return;SystemClock.sleep(100);}
  fail("Calendar flow condition missing: "+condition);
 }
 /**
  * Reminder deletion is the reviewed Undo window (AlphaDeletions.reviewReminder): a native dialog
  * names the reminder; "Delete reminder" pauses its alert at once and commits after 10 seconds.
  * Clicks the real dialog control through accessibility, never a renderer shortcut.
  */
 private void confirmReminderDeletion(String title) throws Exception {
  for(int i=0;i<150;i++){
   android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   if(root!=null&&root.getPackageName()!=null&&InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName().contentEquals(root.getPackageName())){
    boolean titleShown=false,detailsShown=false;android.view.accessibility.AccessibilityNodeInfo button=null;
    java.util.ArrayDeque<android.view.accessibility.AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();queue.add(root);
    while(!queue.isEmpty()){
     android.view.accessibility.AccessibilityNodeInfo node=queue.removeFirst();String text=node.getText()==null?"":node.getText().toString();
     if(node.isVisibleToUser()){
      if(text.equals("Delete reminder?"))titleShown=true;
      if(text.contains(title)&&text.contains("10 seconds")&&text.contains("Undo"))detailsShown=true;
      if(text.equalsIgnoreCase("Delete reminder")&&node.isClickable())button=node;
     }
     for(int c=0;c<node.getChildCount();c++){android.view.accessibility.AccessibilityNodeInfo child=node.getChild(c);if(child!=null)queue.add(child);}
    }
    if(titleShown&&detailsShown&&button!=null){assertTrue("Native deletion review control accepted",button.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK));return;}
   }
   SystemClock.sleep(100);
  }
  fail("Native reminder deletion review missing for "+title);
 }
 /** The deletion review opens only for a focused, unlocked Activity; otherwise it resolves "unavailable". */
 private void focused() throws Exception {
  for(int i=0;i<150;i++){boolean[] ready={false};WebViewTestDriver.withActivity(MainActivity.class,a->ready[0]=a.hasWindowFocus()&&!a.isFinishing()&&!a.isDestroyed());if(ready[0])return;SystemClock.sleep(100);}
  fail("Reminder deletion review requires actual Activity focus");
 }
 /** The queued deletion commits at its 10-second expiry and reads back as a cancelled record. */
 private void awaitCommittedCancellation(android.content.Context context,String id) throws Exception {
  long end=SystemClock.elapsedRealtime()+30000;JSONObject row=null;
  while(SystemClock.elapsedRealtime()<end){row=ReminderTestAccess.read(context,id);if(row!=null&&"cancelled".equals(row.optString("status")))return;SystemClock.sleep(200);}
  fail("Reviewed deletion did not commit as a cancelled reminder: "+row);
 }
 @Test public void calendarFormCreatesAndDeletesRealReminder() throws Exception {
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  if(android.os.Build.VERSION.SDK_INT>=33) InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.POST_NOTIFICATIONS);
  String title="Calendar reminder "+java.util.UUID.randomUUID();
  String reminderId=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
   ready(scenario);evaluate(scenario,AppNavigation.request("Calendar"));uiWait(scenario,AppNavigation.selected("Calendar"));
   evaluate(scenario,"document.querySelector('button[aria-label=\"New event\"]').click()");
   uiWait(scenario,"document.querySelector('input[aria-label=Title]')");
   evaluate(scenario,"(()=>{const e=document.querySelector('input[aria-label=Title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(title)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   uiWait(scenario,"document.querySelector('button[aria-label=Tomorrow]')");
   evaluate(scenario,"document.querySelector('button[aria-label=Tomorrow]').click()");
   evaluate(scenario,"[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Reminders').click()");
   evaluate(scenario,"document.querySelector('button[aria-label=\"Save event\"]').click()");
   uiWait(scenario,"!document.querySelector('button[aria-label=\"Save event\"]')");
   begin(scenario,"Capacitor.Plugins.DailyApps.listReminders()");
   JSONArray rows=result(scenario).getJSONArray("reminders");
   for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(title.equals(row.getString("title"))){reminderId=row.getString("id");assertEquals("scheduled",row.getString("status"));assertTrue(row.getLong("at")>System.currentTimeMillis());}}
   assertNotNull("Real native record created from Calendar form",reminderId);
   // Saving returns to Calendar; select the record's civil day before opening it.
   long due=ReminderTestAccess.read(context,reminderId).getLong("dueAt");
   evaluate(scenario,"document.querySelector('button[aria-label=\"Month view\"]').click()");
   evaluate(scenario,"(()=>{const d=new Date("+due+");const now=new Date();if(d.getMonth()!==now.getMonth()||d.getFullYear()!==now.getFullYear())document.querySelector('button[aria-label=\"Next month\"]').click();})()");
   String day="(()=>{const d=new Date("+due+");const label=d.toLocaleDateString('en-US',{weekday:'long'})+' '+d.toLocaleDateString('en-US',{month:'long'})+' '+d.getDate();return [...document.querySelectorAll('button[aria-label]')].find(b=>b.getAttribute('aria-label')===label);})()";
   uiWait(scenario,day);evaluate(scenario,"("+day+").click()");
   String selected="[...document.querySelectorAll('button[aria-label]')].find(b=>b.getAttribute('aria-label').startsWith("+JSONObject.quote(title+", ")+"))";
   uiWait(scenario,selected);evaluate(scenario,"("+selected+").click()");
   uiWait(scenario,"[...document.querySelectorAll('[data-screen] h1')].some(h=>h.textContent==="+JSONObject.quote(title)+")");
   focused();evaluate(scenario,"document.querySelector('button[aria-label=\"Delete event\"]').click()");
   // Delete opens the native review; the detail closes only once the deletion is queued.
   confirmReminderDeletion(title);
   uiWait(scenario,"!document.querySelector('button[aria-label=\"Delete event\"]')");
   assertNotEquals("Review queues without immediate cancellation","cancelled",ReminderTestAccess.read(context,reminderId).optString("status"));
   awaitCommittedCancellation(context,reminderId);
   begin(scenario,"Capacitor.Plugins.DailyApps.listReminders()");rows=result(scenario).getJSONArray("reminders");
   boolean cancelled=false;
   for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(reminderId.equals(row.getString("id")))cancelled="cancelled".equals(row.getString("status"));}
   assertTrue("Calendar Delete cancels the real native reminder after its Undo window",cancelled);
  } finally {
   JSONArray rows=ReminderTestAccess.list(context);
   for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(title.equals(row.optString("title")))ReminderTestAccess.cancel(context,row.getString("id"));}
  }
 }
 @Test public void nativeCapabilityInventoryIsExplicit() throws Exception {
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   ready(scenario); begin(scenario, "Capacitor.Plugins.DailyApps.capabilities()");
   JSONObject value = result(scenario); assertEquals("android", value.getString("platform"));
   JSONArray actions = value.getJSONArray("actions");
   java.util.Set<String> expected = new java.util.HashSet<>(java.util.Arrays.asList("camera", "photos", "files", "maps", "calendar", "calendar-create", "reminder", "email", "inbox", "browser", "notifications", "settings", "autofill", "voice"));
   java.util.Set<String> actual = new java.util.HashSet<>();
   boolean files = false;
   for (int i = 0; i < actions.length(); i++) {
    JSONObject item = actions.getJSONObject(i); item.getBoolean("available");
    assertTrue("Duplicate native action", actual.add(item.getString("action")));
    assertTrue(item.getString("mode").equals("handoff") || item.getString("mode").equals("selection"));
    if (item.getString("action").equals("files")) { files = true; assertTrue("AOSP document picker exists",item.getBoolean("available")); }
   }
   assertEquals("Exact MVP handoff and selection inventory", expected, actual);
   for (String deferred : new String[]{"phone", "messages", "contacts"}) assertFalse("Deferred action must remain absent: " + deferred, actual.contains(deferred));
   assertTrue(files);
  }
 }
 @Test public void dangerousBrowserTargetsAndInvalidCalendarTimesAreRejected() throws Exception {
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   ready(scenario);
   for (String url : new String[]{"javascript:alert(1)", "file:///data/local/tmp/private", "content://com.android.contacts/contacts", "intent://settings", "https://user:password@example.com"}) {
    begin(scenario, "Capacitor.Plugins.DailyApps.perform({action:'browser',url:" + JSONObject.quote(url) + "})");
    assertEquals(url, "failed", result(scenario).getString("status"));
   }
   begin(scenario, "Capacitor.Plugins.DailyApps.perform({action:'calendar-create',startTime:1000,endTime:1})");
   assertEquals("failed", result(scenario).getString("status"));
   begin(scenario, "Capacitor.Plugins.DailyApps.perform({action:'unknown'})");
   assertEquals("failed", result(scenario).getString("status"));
  }
 }
 @Test public void documentPickerCancellationReturnsWithoutInventedSelection() throws Exception {
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   ready(scenario); begin(scenario, "Capacitor.Plugins.DailyApps.perform({action:'files'})");
   boolean opened = false;
   for (int i = 0; i < 50; i++) {
    android.os.ParcelFileDescriptor pipe = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys activity activities");
    String state;
    try (java.io.InputStream input = new android.os.ParcelFileDescriptor.AutoCloseInputStream(pipe)) {
     state = new String(input.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
    }
    opened = state.lines().anyMatch(line -> (line.contains("mResumedActivity") || line.contains("topResumedActivity")) && (line.contains("documentsui") || line.contains("DocumentsActivity")));
    if (opened) break;
    SystemClock.sleep(100);
   }
   assertTrue("Real Android document picker opened", opened);
   WebViewTestDriver.cancelDocumentPicker();
   SystemClock.sleep(300);
   JSONObject value = result(scenario); assertEquals("cancelled", value.getString("status")); assertFalse(value.has("uri"));
  }
 }
 @Test public void localReminderPostsRealNotificationAndTapOpensItsContext() throws Exception {
  android.content.Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  if (android.os.Build.VERSION.SDK_INT >= 33) InstrumentationRegistry.getInstrumentation().getUiAutomation()
   .grantRuntimePermission(context.getPackageName(), android.Manifest.permission.POST_NOTIFICATIONS);
  String id = "e2e_reminder_" + System.currentTimeMillis();
  android.app.NotificationManager notifications = context.getSystemService(android.app.NotificationManager.class);
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   ready(scenario);
   AppNavigation.liveMode();
   begin(scenario, "(async()=>{window.__pendingReminderSignals=0;window.__reminderTapListener=await Capacitor.Plugins.DailyApps.addListener('pendingReminderTap',()=>window.__pendingReminderSignals++);return {ready:true};})()");
   assertTrue(result(scenario).getBoolean("ready"));
   long at = System.currentTimeMillis() + 2000;
   begin(scenario, "Capacitor.Plugins.DailyApps.scheduleReminder({id:" + JSONObject.quote(id) + ",title:" + JSONObject.quote("Device flow test " + id) + ",body:'Local reminder delivery',at:" + at + "})");
   JSONObject scheduled = result(scenario); assertEquals(scheduled.toString(), "scheduled", scheduled.getString("status")); assertEquals("inexact", scheduled.getString("mode"));
   android.service.notification.StatusBarNotification posted = null;
   for (int i = 0; i < 120; i++) {
    for (android.service.notification.StatusBarNotification item : notifications.getActiveNotifications()) if (id.equals(item.getTag())) posted = item;
    if (posted != null) break;
    SystemClock.sleep(500);
   }
   assertNotNull("Real inexact AlarmManager delivery posts a notification", posted);
   assertEquals("Device flow test " + id, posted.getNotification().extras.getString(android.app.Notification.EXTRA_TITLE));
   begin(scenario, "Capacitor.Plugins.DailyApps.listReminders()");
   JSONArray records = result(scenario).getJSONArray("reminders"); boolean found = false;
   for (int i = 0; i < records.length(); i++) if (records.getJSONObject(i).getString("id").equals(id)) {
    found = true; assertEquals("posted",records.getJSONObject(i).getString("status")); assertTrue(records.getJSONObject(i).getLong("postedAt") >= at);
   }
   assertTrue(found);
   posted.getNotification().contentIntent.send();
   boolean opened = false;
   for (int i = 0; i < 50; i++) {
    if ("true".equals(evaluate(scenario, "window.__pendingReminderSignals>0"))) { opened = true; break; }
    SystemClock.sleep(100);
   }
   assertTrue("Durable notification tap signals pending delivery", opened);
   // A fresh install still shows the first-run sign-in panel. The product keeps the tap while that
   // panel is open and opens the reminder when the owner answers it; it must not open underneath.
   String detail = "document.documentElement.dataset.activeView==='calendar' && [...document.querySelectorAll('[data-screen] h1')].some(h=>h.textContent==="+JSONObject.quote("Device flow test " + id)+") && !!document.querySelector('button[aria-label=\"Edit event\"]')";
   String closable = "[...document.querySelectorAll('.alpha-connection-scrim button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(AppNavigation.CLOSE_CONNECTION)+"&&!e.disabled)";
   boolean mandatorySignIn = false;
   if ("true".equals(evaluate(scenario, "!!document.querySelector('.alpha-connection-scrim')"))) {
    SystemClock.sleep(1500);
    assertEquals("The reminder does not open under the sign-in panel", "false", evaluate(scenario, "Boolean("+detail+")"));
    begin(scenario, "Capacitor.Plugins.DailyApps.pendingReminderTap()");
    JSONObject retainedTap = result(scenario);
    assertTrue("The tap is retained while the sign-in panel is open: " + retainedTap, retainedTap.optBoolean("retained") && retainedTap.has("token"));
    for (int i = 0; i < 100 && !"true".equals(evaluate(scenario, "Boolean("+closable+")")); i++) SystemClock.sleep(100);
    if ("true".equals(evaluate(scenario, "Boolean("+closable+")"))) {
     evaluate(scenario, "("+closable+").click()");
     uiWait(scenario, "!document.querySelector('.alpha-connection-scrim')");
    } else {
     // A production build (no ELIZA_DEV_ALLOW_TEST_MOCKS) on first run requires Eliza Cloud
     // sign-in and the dialog has no close control (connection-ui residentMustSignIn). This test
     // never signs in, so the tap must stay retained, unopened, until the owner does.
     assertFalse("Only a production build's first-run sign-in is undismissable", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
     uiWait(scenario, "[...document.querySelectorAll('.alpha-connection-scrim button')].some(b=>b.textContent.trim()==='Sign in with Eliza Cloud')");
     mandatorySignIn = true;
    }
   }
   if (mandatorySignIn) {
    SystemClock.sleep(1500);
    assertEquals("The reminder stays unopened behind the required sign-in", "false", evaluate(scenario, "Boolean("+detail+")"));
    begin(scenario, "Capacitor.Plugins.DailyApps.pendingReminderTap()");
    JSONObject stillRetained = result(scenario);
    assertTrue("The tap stays retained until the owner signs in: " + stillRetained, stillRetained.optBoolean("retained") && stillRetained.has("token"));
    android.os.Bundle note = new android.os.Bundle();
    note.putString("reminderTapDetailNotExercised", "First-run Eliza Cloud sign-in is required on this production build; tap retention was verified, opening the detail needs a signed-in owner or a test-mocks build.");
    InstrumentationRegistry.getInstrumentation().addResults(note);
   } else {
    boolean detailOpened = false;
    for (int i = 0; i < 80; i++) {
     if ("true".equals(evaluate(scenario,"Boolean("+detail+")"))) { detailOpened=true; break; }
     SystemClock.sleep(100);
    }
    assertTrue("Notification tap opens this reminder's real Calendar detail", detailOpened);
   }
   // ID or target cancellation outside the reviewed window is refused and changes nothing.
   String target = "(async()=>{const d=Capacitor.Plugins.DailyApps,id="+JSONObject.quote(id)+";const target=await d.selectedReminder({id});const operation={type:\"reminder_cancel\",target};const bindingHash=Array.from(new Uint8Array(await crypto.subtle.digest(\"SHA-256\",new TextEncoder().encode(JSON.stringify(operation))))).map(v=>v.toString(16).padStart(2,\"0\")).join(\"\");return d.cancelReminder({id,target,operationId:crypto.randomUUID(),bindingHash});})()";
   begin(scenario, target);
   JSONObject refused = result(scenario);
   assertTrue("Direct cancellation is refused: " + refused, refused.has("error") && !refused.has("status"));
   assertEquals("Refused cancellation leaves the reminder posted", "posted", ReminderTestAccess.read(context, id).getString("status"));
   // The reviewed deletion pauses the alert at once (its notice is withdrawn) and commits at expiry.
   focused();
   begin(scenario, "(async()=>{const target=await Capacitor.Plugins.DailyApps.selectedReminder({id:"+JSONObject.quote(id)+"});return Capacitor.Plugins.AlphaDeletions.reviewReminder({target});})()");
   confirmReminderDeletion("Device flow test " + id);
   assertEquals("queued", result(scenario).getString("status"));
   boolean withdrawn = false;
   for (int i = 0; i < 50 && !withdrawn; i++) {
    withdrawn = true;
    for (android.service.notification.StatusBarNotification item : notifications.getActiveNotifications()) if (id.equals(item.getTag())) withdrawn = false;
    if (!withdrawn) SystemClock.sleep(100);
   }
   assertTrue("A queued deletion withdraws the reminder's notification immediately", withdrawn);
   awaitCommittedCancellation(context, id);
   for (android.service.notification.StatusBarNotification item : notifications.getActiveNotifications()) assertNotEquals(id,item.getTag());
   begin(scenario, "Capacitor.Plugins.DailyApps.scheduleReminder({id:'past_test',title:'Past',at:1})");
   assertEquals("past", result(scenario).getString("status"));
  } finally { ReminderTestAccess.cancel(context,id); }
 }

 @Test public void rootBackFinishesStandaloneAndKeepsLauncherHome() throws Exception {
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   ready(scenario);
   // A fresh install opens the sign-in panel and the access panel over Home; both count as
   // something Back can close. Settle them the way an owner does before reading Home's state.
   WebViewTestDriver.evaluate(AppNavigation.request("Home"));
   for (int i = 0; i < 100; i++) { if ("true".equals(WebViewTestDriver.evaluate("Boolean(" + AppNavigation.selected("Home") + "&&!document.querySelector('.alpha-connection-scrim'))"))) break; SystemClock.sleep(100); }
   AppNavigation.declineStartupAccess();
   for (int i = 0; i < 30; i++) {
    if ("\"false\"".equals(evaluate(scenario,"document.documentElement.dataset.alphaCanGoBack"))) break;
    SystemClock.sleep(100);
   }
   assertEquals("Home has no in-app back history", "\"false\"", evaluate(scenario,"document.documentElement.dataset.alphaCanGoBack"));
   WebViewTestDriver.pressBack();
   if (BuildConfig.IS_LAUNCHER) {
    SystemClock.sleep(300);
    assertEquals(androidx.lifecycle.Lifecycle.State.RESUMED, scenario.getState());
    assertEquals("true",evaluate(scenario,"Boolean(document.querySelector('[data-screen]'))"));
   } else {
    for (int i = 0; i < 50 && scenario.getState() != androidx.lifecycle.Lifecycle.State.DESTROYED; i++) SystemClock.sleep(100);
    assertEquals(androidx.lifecycle.Lifecycle.State.DESTROYED, scenario.getState());
   }
  }
 }

}
