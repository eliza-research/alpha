package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.app.UiAutomation;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.List;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Settings role and permission state against Android's own answer: the HOME request is declined
 * and then accepted in the real role dialog, and each result is compared with
 * `cmd role get-role-holders`; the Calendar row is compared with the runtime grant.
 */
@RunWith(AndroidJUnit4.class)
public final class SettingsRolesInstrumentedTest {
 @org.junit.Before public void requireSignedInViews() throws Exception {
  AppNavigation.assumeNoRequiredSignIn("SettingsRoles journey");
 }
 private static final String HOME="android.app.role.HOME";
 private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
 private UiAutomation ui(){return InstrumentationRegistry.getInstrumentation().getUiAutomation();}
 private String shell(String command)throws Exception{
  try(var fd=ui().executeShellCommand(command);var in=new java.io.FileInputStream(fd.getFileDescriptor())){return new String(in.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8).trim();}
 }
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void until(String code)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}fail("Settings condition: "+code);}
 private String text(String value){return "document.body.textContent.includes("+JSONObject.quote(value)+")";}
 private void button(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith("+JSONObject.quote(label)+"))";until(q);js("("+q+").click()");}
 private void settings()throws Exception{js(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));js(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"));}
 private boolean holdsHome()throws Exception{return shell("cmd role get-role-holders --user 0 "+HOME).contains(context.getPackageName());}
 /**
  * Android's role dialog belongs to PermissionController, another process. On the loaded API 36
  * emulator (campaign of 2026-10-14) it was displayed 5.5 s after the request and its frames took
  * up to 6.6 s each to draw (HWUI "Davey" frames of PermissionController), so its nodes appeared
  * about 10 s after the click, at the edge of the former 10 s bound. The wait is bounded at 20 s
  * and still requires that dialog.
  */
 private static final int DIALOG_POLLS=200;
 private AccessibilityNodeInfo dialogNode(String... labels){
  for(int i=0;i<DIALOG_POLLS;i++){
   AccessibilityNodeInfo root=ui().getRootInActiveWindow();
   if(root!=null&&!context.getPackageName().contentEquals(root.getPackageName()))for(String label:labels){List<AccessibilityNodeInfo> found=root.findAccessibilityNodeInfosByText(label);if(!found.isEmpty())return found.get(0);}
   SystemClock.sleep(100);
  }
  return null;
 }
 private AccessibilityNodeInfo exactDialogNode(String label){return exactDialogNode(label,DIALOG_POLLS);}
 private AccessibilityNodeInfo exactDialogNode(String label,int polls){
  for(int i=0;i<polls;i++){
   AccessibilityNodeInfo root=ui().getRootInActiveWindow();
   if(root!=null&&!context.getPackageName().contentEquals(root.getPackageName()))for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(label))if(node.getText()!=null&&label.equalsIgnoreCase(node.getText().toString().trim()))return node;
   SystemClock.sleep(100);
  }
  return null;
 }
 private void back(){long t=SystemClock.uptimeMillis();for(int action:new int[]{KeyEvent.ACTION_DOWN,KeyEvent.ACTION_UP})ui().injectInputEvent(new KeyEvent(t,SystemClock.uptimeMillis(),action,KeyEvent.KEYCODE_BACK,0),true);}
 private static boolean click(AccessibilityNodeInfo node){for(AccessibilityNodeInfo n=node;n!=null;n=n.getParent())if(n.isClickable())return n.performAction(AccessibilityNodeInfo.ACTION_CLICK);return false;}

 // One live MainActivity (MainActivity "One live MainActivity"): what the app process holds and what Android lists.
 private static final String PROBE="kept-across-the-home-role",DRAFT="Draft kept across the Home role change";
 private static final java.util.regex.Pattern TOP=java.util.regex.Pattern.compile("(?:topResumedActivity|mResumedActivity)[=:][^\\n]*?\\s([A-Za-z0-9_.]+)/");
 /** Every MainActivity of this process that is not destroyed, with its stage. Main thread. */
 private java.util.Map<android.app.Activity,androidx.test.runner.lifecycle.Stage> instances()throws Exception{
  java.util.Map<android.app.Activity,androidx.test.runner.lifecycle.Stage> found=new java.util.LinkedHashMap<>();
  BoundedActivityScenario.main(()->{
   for(androidx.test.runner.lifecycle.Stage stage:androidx.test.runner.lifecycle.Stage.values()){
    if(stage==androidx.test.runner.lifecycle.Stage.DESTROYED)continue;
    for(android.app.Activity activity:androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))
     if(activity.getClass()==MainActivity.class&&!activity.isDestroyed())found.put(activity,stage);
   }
  });
  return found;
 }
 /** Distinct MainActivity records in Android's own activity dump (home and standard tasks alike). */
 private int systemRecords()throws Exception{
  java.util.regex.Matcher records=java.util.regex.Pattern.compile("ActivityRecord\\{([0-9a-f]+) u\\d+ "+java.util.regex.Pattern.quote(context.getPackageName())+"/[A-Za-z0-9_.]*\\.MainActivity[\\s}]").matcher(shell("dumpsys activity activities"));
  java.util.Set<String> ids=new java.util.HashSet<>();while(records.find())ids.add(records.group(1));return ids.size();
 }
 private String foreground()throws Exception{java.util.regex.Matcher match=TOP.matcher(shell("dumpsys activity activities"));return match.find()?match.group(1):null;}
 private void pressHome(){
  long down=SystemClock.uptimeMillis();
  assertTrue("Android accepted HOME down",ui().injectInputEvent(new KeyEvent(down,down,KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_HOME,0,0,android.view.KeyCharacterMap.VIRTUAL_KEYBOARD,0,KeyEvent.FLAG_FROM_SYSTEM,android.view.InputDevice.SOURCE_KEYBOARD),true));
  assertTrue("Android accepted HOME up",ui().injectInputEvent(new KeyEvent(down,SystemClock.uptimeMillis(),KeyEvent.ACTION_UP,KeyEvent.KEYCODE_HOME,0,0,android.view.KeyCharacterMap.VIRTUAL_KEYBOARD,0,KeyEvent.FLAG_FROM_SYSTEM,android.view.InputDevice.SOURCE_KEYBOARD),true));
 }
 /** The page owner's window holds input focus: the state in which Android acts on a HOME key. */
 private void awaitWindowFocus(android.app.Activity owner,String when)throws Exception{
  boolean[] focused=new boolean[1];
  for(int i=0;i<150&&!focused[0];i++){BoundedActivityScenario.main(()->focused[0]=owner.hasWindowFocus());if(!focused[0])SystemClock.sleep(100);}
  assertTrue("The page owner's window has input focus "+when,focused[0]);
 }
 private static final String NAVIGATION_SETTLED="window.__alphaTestNavigation?.status==='complete'";
 private String draft(){return "("+AppNavigation.composer()+")?.value";}
 /**
  * Exactly one MainActivity exists, it is resumed and in front, it is the instance that existed
  * before (same object, same page: the marker and the unsent draft are still in it), and Android
  * lists one MainActivity record. Polled, because the instance Android creates for a HOME start
  * finishes a moment after it hands the start over.
  */
 private void assertOneLiveInstance(String when,android.app.Activity original)throws Exception{
  String seen="";
  for(int i=0;i<150;i++){
   java.util.Map<android.app.Activity,androidx.test.runner.lifecycle.Stage> live=instances();
   int records=systemRecords();String front=foreground();
   seen="instances="+live.values()+" same="+live.containsKey(original)+" systemRecords="+records+" foreground="+front;
   if(live.size()==1&&live.get(original)==androidx.test.runner.lifecycle.Stage.RESUMED&&records==1&&context.getPackageName().equals(front))break;
   if(i==149)fail("One resumed MainActivity "+when+": "+seen);
   SystemClock.sleep(100);
  }
  MainActivity[] owner=new MainActivity[1];BoundedActivityScenario.main(()->owner[0]=MainActivity.liveInstance());
  assertSame("The page owner "+when+" is the instance that existed before",original,owner[0]);
  assertEquals("The page was not reloaded "+when,"\""+PROBE+"\"",js("window.__alphaInstanceProbe"));
 }

 @Test public void homeRequestDeclineAndAcceptMatchRoleHolders()throws Exception{
  Assume.assumeTrue("Only the launcher variant declares HOME",BuildConfig.IS_LAUNCHER);
  String previous=shell("cmd role get-role-holders --user 0 "+HOME);
  shell("cmd role remove-role-holder --user 0 "+HOME+" "+context.getPackageName());
  assertFalse("Fixture starts without the HOME role",holdsHome());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   // In-flight state that exists only in this page: a marker and an unsent draft in the composer.
   js(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));until(AppNavigation.composer());
   js("(()=>{window.__alphaInstanceProbe="+JSONObject.quote(PROBE)+";const e="+AppNavigation.composer()+";Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(DRAFT)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   until(draft()+"==="+JSONObject.quote(DRAFT));
   java.util.Map<android.app.Activity,androidx.test.runner.lifecycle.Stage> started=instances();
   assertEquals("One MainActivity before the role request: "+started.values(),1,started.size());
   android.app.Activity original=started.keySet().iterator().next();
   settings();
   until(text("Make Alpha your Home app"));
   // Decline in Android's own dialog: nothing changes, and Settings offers the request again after reading back.
   button("Make Alpha your Home app");
   assertNotNull("Android role dialog shown",dialogNode("Alpha Phone","Cancel"));
   // Decline with the dialog's own Cancel: on Android 16 this dialog ignores the Back key
   // (measured on the API 36 emulator), so Back is only the fallback for a dialog without the button.
   AccessibilityNodeInfo cancel=dialogNode("Cancel");
   if(cancel==null||!click(cancel))back();
   until(text("Make Alpha your Home app"));
   assertFalse("Declined request holds no role",holdsHome());
   assertEquals("Settings offers the request again","true",js("Boolean("+"[...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Make Alpha your Home app'))"+")"));
   // Accept: choose Alpha, then confirm when the dialog asks.
   button("Make Alpha your Home app");
   // The dialog's title also contains the app name; the list row is the node whose text is exactly it.
   AccessibilityNodeInfo alpha=exactDialogNode("Alpha Phone");assertNotNull("Alpha listed as a Home app",alpha);assertTrue("Alpha's row is selectable",click(alpha));
   AccessibilityNodeInfo confirm=null;for(int i=0;i<50&&(confirm==null||!confirm.isEnabled());i++){confirm=exactDialogNode("Set as default",100);if(confirm==null||!confirm.isEnabled())SystemClock.sleep(100);}
   if(confirm!=null)assertTrue("Set as default is pressed",click(confirm));
   for(int i=0;i<200&&!holdsHome();i++)SystemClock.sleep(100);
   assertTrue("Android reports Alpha as HOME holder",holdsHome());
   // Becoming HOME makes Android start Alpha as the home activity. That start has the home activity
   // type and cannot reuse the running standard-type task, so Android creates a second MainActivity
   // for it (measured on the API 36 emulator in round 7). The product hands that start to the
   // instance that was already running and the new one finishes: one instance, the same page, the
   // draft still in the composer.
   assertOneLiveInstance("after the role is accepted",original);
   js(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));
   until(draft()+"==="+JSONObject.quote(DRAFT));
   // Repeated HOME presses, from Alpha Home and from inside a view: still the one instance.
   // Every press must reach the page as a HOME start, so each is counted where the page hears it.
   js("window.__alphaHomeStarts=0;window.addEventListener('launcher-home',()=>{window.__alphaHomeStarts++;})");
   for(int press=1;press<=3;press++){
    // The navigation helper keeps a 100 ms timer until it has seen its target view. A HOME start that
    // lands inside that window is undone by the helper's next step, which finds Home and opens
    // Settings again (measured: the page heard the HOME start and still ended in Settings). The
    // helper is therefore finished before the key is pressed.
    if(press==2){js(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"));}
    until(NAVIGATION_SETTLED);
    // A HOME key is acted on only once the page owner's window has input focus again. The hand-off
    // of the previous HOME start (or of the role grant) is still in transition for a moment after
    // the activity reports resumed, and a key injected then starts nothing (measured on the API 36
    // emulator: no HOME start in the log for the 20 s that followed).
    awaitWindowFocus(original,"before HOME press "+press);
    int heard=Integer.parseInt(js("window.__alphaHomeStarts"));
    pressHome();
    until("window.__alphaHomeStarts>"+heard);
    for(int i=0;i<100&&!context.getPackageName().equals(foreground());i++)SystemClock.sleep(150);
    until(AppNavigation.selected("Home"));
    assertOneLiveInstance("after HOME press "+press,original);
    until(draft()+"==="+JSONObject.quote(DRAFT));
   }
   // A start that is not a HOME start (the app icon, a notification tap) reaches the same instance too.
   // No -W: the instance Android creates for this start finishes at once, by design.
   shell("am start -n "+context.getPackageName()+"/"+MainActivity.class.getName());
   SystemClock.sleep(1000);
   assertOneLiveInstance("after an explicit start",original);
   // Settings in that instance names Alpha as the Home app, read back from Android.
   settings();
   until("[...document.querySelectorAll('[data-screen] *')].some(e=>e.childElementCount<4&&e.textContent.trim().startsWith('Home app')&&e.textContent.includes('Alpha Phone'))");
   assertEquals("The request is no longer offered","false",js("Boolean([...document.querySelectorAll('button')].find(e=>e.textContent.trim().startsWith('Make Alpha your Home app')))"));
  }finally{
   for(String holder:previous.split("\\s+"))if(!holder.isEmpty())shell("cmd role add-role-holder --user 0 "+HOME+" "+holder);
   if(!previous.contains(context.getPackageName()))shell("cmd role remove-role-holder --user 0 "+HOME+" "+context.getPackageName());
  }
 }

 /**
  * `pm revoke` kills the app process, and with it this instrumentation, so a permission-changing
  * runner sets the grant between runs and passes the expected state (settingsCalendar=granted|revoked).
  * Without that argument the row is still compared with the current runtime grant, so the test
  * never skips; covering both states needs the two runs. The row is Settings › App permissions,
  * whose value counts the grants Android reports off (Calendar is one of them).
  */
 @Test public void calendarRowMatchesRuntimeGrant()throws Exception{
  String expected=InstrumentationRegistry.getArguments().getString("settingsCalendar");
  assertTrue("settingsCalendar must be granted or revoked when given",expected==null||"granted".equals(expected)||"revoked".equals(expected));
  boolean granted=context.checkSelfPermission(Manifest.permission.READ_CALENDAR)==PackageManager.PERMISSION_GRANTED;
  if(expected!=null)assertEquals("Runner applied the requested grant","granted".equals(expected),granted);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   // Settings › Privacy › App permissions counts the grants Android reports off (settings-adapter permissionSummary).
   AppNavigation.liveMode();settings();
   String[] grants={Manifest.permission.RECORD_AUDIO,Manifest.permission.CAMERA,Manifest.permission.READ_CALENDAR};
   int off=0;for(String permission:grants)if(context.checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED)off++;
   if(context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED)off++;
   String row="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==='App permissions')?.textContent.includes("+JSONObject.quote(off==0?"All allowed":off+" not allowed")+")";
   until(row);
   assertEquals("Contacts is not presented","false",js("[...document.querySelectorAll('button,div')].some(e=>e.childElementCount===0&&e.textContent.trim()==='Contacts')"));
  }
 }
}
