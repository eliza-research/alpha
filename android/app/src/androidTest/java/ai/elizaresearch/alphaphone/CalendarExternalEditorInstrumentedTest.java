package ai.elizaresearch.alphaphone;

import android.app.UiAutomation;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.provider.CalendarContract;
import android.view.KeyEvent;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.security.MessageDigest;
import java.time.*;
import java.util.*;
import org.json.JSONObject;
import org.junit.*;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Conditional actual external editor, never an intercepted intent or forced component. */
@RunWith(AndroidJUnit4.class)
public class CalendarExternalEditorInstrumentedTest {
 private static final String ETAR="ws.xsoh.etar", SIGNER="3f3176c3ce189c98054ff9e1d32daecf00a41572f4c7bd2b2f80607252ddb06e";
 private final UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
 private String eval(String s)throws Exception{return WebViewTestDriver.evaluate(s);}
 private void until(String s)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+s+")")))return;SystemClock.sleep(100);}fail("Alpha editor condition missing: "+s);}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(q);eval("("+q+").click()");}
 private AccessibilityNodeInfo find(String id,String text){AccessibilityNodeInfo root=ui.getRootInActiveWindow();if(root==null||root.getPackageName()==null||!ETAR.contentEquals(root.getPackageName()))return null;List<AccessibilityNodeInfo> rows=id!=null?root.findAccessibilityNodeInfosByViewId(ETAR+":id/"+id):root.findAccessibilityNodeInfosByText(text);for(AccessibilityNodeInfo row:rows)if(row.isVisibleToUser()&&(text==null||text.contentEquals(row.getText())))return row;return null;}
 private AccessibilityNodeInfo awaitNode(String id,String text)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){denyOptionalEtarContacts();AccessibilityNodeInfo n=find(id,text);if(n!=null)return n;SystemClock.sleep(100);}fail("Etar visible control missing: "+(id!=null?id:"fixture title")+"; "+diagnostics(text));return null;}
 private void setEditorTitle(String original,String updated)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){
   denyOptionalEtarContacts();
   AccessibilityNodeInfo input=find("title",original);
   // The view page and edit page share this ID. Wait for a fresh editable node,
   // then tolerate a node becoming stale during the activity transition.
   if(input!=null && input.isEditable() && input.isEnabled()){
    Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,updated);
    if(input.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args)){awaitNode("title",updated);return;}
   }
   SystemClock.sleep(100);
  }
  fail("Etar editable title did not accept the fixture change; "+diagnostics(original));
 }
 private String diagnostics(String fixture){
  AccessibilityNodeInfo root=ui.getRootInActiveWindow();if(root==null)return "AX root absent";
  List<String> fields=new ArrayList<>();fields.add("package="+root.getPackageName());
  for(String label:new String[]{"Open with","Open with Etar","Etar","Just once","Always","Alarms & reminders"})fields.add(label+"="+root.findAccessibilityNodeInfosByText(label).stream().anyMatch(n->n.isVisibleToUser()&&label.contentEquals(n.getText())));
  if(fixture!=null)fields.add("fixtureTitleVisible="+root.findAccessibilityNodeInfosByText(fixture).stream().anyMatch(n->n.isVisibleToUser()&&fixture.contentEquals(n.getText())));
  for(String id:new String[]{"title","info_action_edit","action_cancel","action_done"})fields.add(id+"="+root.findAccessibilityNodeInfosByViewId(ETAR+":id/"+id).stream().anyMatch(AccessibilityNodeInfo::isVisibleToUser));
  String permissionPackage=String.valueOf(root.getPackageName());
  if(permissionPackage.equals("com.android.permissioncontroller")||permissionPackage.equals("com.google.android.permissioncontroller")){
   for(AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByViewId(permissionPackage+":id/permission_message")){
    String message=String.valueOf(n.getText()).toLowerCase(Locale.ROOT);fields.add("permissionForEtar="+message.contains("etar"));fields.add("contactsPrompt="+message.contains("contacts"));fields.add("notificationPrompt="+message.contains("notifications"));
   }
  }
  return fields.toString();
 }
 private void clickNode(AccessibilityNodeInfo n,String label){while(n!=null&&!n.isClickable())n=n.getParent();assertNotNull("Clickable "+label,n);assertTrue("Enabled "+label,n.isEnabled());assertTrue("Click "+label,n.performAction(AccessibilityNodeInfo.ACTION_CLICK));}
 private AccessibilityNodeInfo exact(AccessibilityNodeInfo root,String label){for(AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByText(label))if(n.isVisibleToUser()&&label.contentEquals(n.getText()))return n;return null;}
 // Etar v1.0.57 EditEventFragment requests optional READ_CONTACTS at editor entry.
 // Denial keeps a title-only edit private; unknown permission prompts must fail.
 private void denyOptionalEtarContacts(){
  AccessibilityNodeInfo root=ui.getRootInActiveWindow();if(root==null)return;
  String pkg=String.valueOf(root.getPackageName());if(!pkg.equals("com.android.permissioncontroller")&&!pkg.equals("com.google.android.permissioncontroller"))return;
  boolean matches=false;for(AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByViewId(pkg+":id/permission_message")){
   String text=String.valueOf(n.getText()).toLowerCase(Locale.ROOT);if(n.isVisibleToUser()&&text.contains("etar")&&text.contains("contacts"))matches=true;
  }
  if(!matches)return;
  // The second request uses the platform's "Don't allow" / don't-ask-again
  // control. Both IDs deny only the identified optional Etar Contacts request.
  for(String id:new String[]{"permission_deny_button","permission_deny_and_dont_ask_again_button"})
   for(AccessibilityNodeInfo n:root.findAccessibilityNodeInfosByViewId(pkg+":id/"+id))if(n.isVisibleToUser()&&n.isEnabled()){clickNode(n,"Deny optional Etar contacts");return;}
 }
 private void chooseEtarOnce()throws Exception{
  long deadline=SystemClock.elapsedRealtime()+15000;boolean selected=false;
  while(SystemClock.elapsedRealtime()<deadline){
   AccessibilityNodeInfo root=ui.getRootInActiveWindow();
   if(root!=null&&root.getPackageName()!=null&&ETAR.contentEquals(root.getPackageName()))return;
   if(root!=null&&root.getPackageName()!=null&&"android".contentEquals(root.getPackageName())){
    // Android remembers the last one-time choice but still asks each time.
    // Verify the displayed handler, never tap Just once for an unknown app.
    if(exact(root,"Open with Etar")!=null){AccessibilityNodeInfo once=exact(root,"Just once");if(once!=null&&once.isEnabled()){clickNode(once,"Just once for displayed Etar");return;}}
    if(exact(root,"Open with")==null){SystemClock.sleep(100);continue;}
    if(!selected){AccessibilityNodeInfo choice=exact(root,"Etar");if(choice!=null){clickNode(choice,"Etar");selected=true;}}
    else {AccessibilityNodeInfo once=exact(root,"Just once");if(once!=null&&once.isEnabled()){clickNode(once,"Just once");return;}}
   }
   SystemClock.sleep(100);
  }
  fail("Implicit Calendar resolver did not select Etar once; "+diagnostics(null));
 }
 private void tap(String id)throws Exception{
  long deadline=SystemClock.elapsedRealtime()+20000;
  while(SystemClock.elapsedRealtime()<deadline){
   denyOptionalEtarContacts();
   // Resolve afresh after editor transitions; a rejected stale-node action is
   // not a successful tap. Stop immediately after the platform accepts it.
   AccessibilityNodeInfo n=find(id,null);
   while(n!=null&&!n.isClickable())n=n.getParent();
   if(n!=null&&n.isVisibleToUser()&&n.isEnabled()&&n.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;
   SystemClock.sleep(100);
  }
  fail("Etar click did not become available: "+id+"; "+diagnostics(null));
 }
 private boolean returnedViaLauncher;
 private void back(){key(KeyEvent.KEYCODE_BACK);}
 private void key(int code){
  long downTime=SystemClock.uptimeMillis();
  KeyEvent down=new KeyEvent(downTime,downTime,KeyEvent.ACTION_DOWN,code,0,0,KeyCharacterMap.VIRTUAL_KEYBOARD,0,KeyEvent.FLAG_FROM_SYSTEM,InputDevice.SOURCE_KEYBOARD);
  boolean downAccepted=ui.injectInputEvent(down,true);
  // Always release the same key, including when the down event is rejected.
  KeyEvent up=new KeyEvent(downTime,SystemClock.uptimeMillis(),KeyEvent.ACTION_UP,code,0,0,KeyCharacterMap.VIRTUAL_KEYBOARD,0,KeyEvent.FLAG_FROM_SYSTEM,InputDevice.SOURCE_KEYBOARD);
  boolean upAccepted=ui.injectInputEvent(up,true);
  assertTrue("Android accepted navigation key down",downAccepted);assertTrue("Android accepted navigation key up",upAccepted);
 }
 private boolean visibleExactText(AccessibilityNodeInfo node,String text,int depth){
  if(node==null||depth>32)return false;
  if(node.isVisibleToUser()&&node.getText()!=null&&text.contentEquals(node.getText()))return true;
  for(int i=0;i<node.getChildCount();i++)if(visibleExactText(node.getChild(i),text,depth+1))return true;
  return false;
 }
 private void returnToAlpha(String appId)throws Exception{
  long deadline=SystemClock.elapsedRealtime()+15000;
  for(int attempt=0;attempt<5&&SystemClock.elapsedRealtime()<deadline;attempt++){
   // A Cancel/Save click can finish Etar asynchronously. Let accessibility and
   // the activity transition settle before deciding whether another Back is needed.
   ui.waitForIdle(200,3000);
   long settle=Math.min(deadline,SystemClock.elapsedRealtime()+1200);
   String active=null;
   while(SystemClock.elapsedRealtime()<settle){
    denyOptionalEtarContacts();
    AccessibilityNodeInfo root=ui.getRootInActiveWindow();active=root==null?null:String.valueOf(root.getPackageName());
    if(appId.equals(active))return;
    SystemClock.sleep(100);
   }
   // A missing AX window during activity replacement is not an app identity.
   // Retry within the existing overall deadline, without injecting any input.
   if(active==null||"null".equals(active))continue;
   if("com.android.settings".equals(active)){
    AccessibilityNodeInfo settings=ui.getRootInActiveWindow();
    boolean alarmPage=visibleExactText(settings,"Alarms & reminders",0);
    boolean etarListed=visibleExactText(settings,"Etar",0);
    // Settings may publish its root before the destination page is populated.
    // Wait within the existing deadline; never inject input into an unidentified page.
    if(settings==null||!"com.android.settings".equals(String.valueOf(settings.getPackageName()))||!alarmPage||!etarListed)continue;
    // Pinned Etar opens this on every resume while denied. Back loops there.
    // Exercise the ordinary Home -> Alpha launcher-intent return, preserving
    // denied special access and recording this distinct return contract.
    key(KeyEvent.KEYCODE_HOME);
    Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
    Intent launch=context.getPackageManager().getLaunchIntentForPackage(appId);
    assertNotNull("Alpha launcher entry remains available",launch);
    context.startActivity(launch);returnedViaLauncher=true;continue;
   }
   assertEquals("Only navigate Back while Etar remains the actual foreground app; "+diagnostics(null),ETAR,active);
   // Re-read immediately before injection, avoiding a cached Etar window.
   AccessibilityNodeInfo latest=ui.getRootInActiveWindow();
   if(latest!=null&&appId.contentEquals(latest.getPackageName()))return;
   if(latest==null||latest.getPackageName()==null)continue;
   assertEquals(ETAR,String.valueOf(latest.getPackageName()));back();
  }
  fail("Back did not return from Etar to Alpha; "+diagnostics(null));
 }
 private JSONObject snapshot(ContentResolver resolver,Uri event)throws Exception{String[] fields={CalendarContract.Events._ID,CalendarContract.Events.TITLE,CalendarContract.Events.DTSTART,CalendarContract.Events.DTEND,CalendarContract.Events.EVENT_TIMEZONE,CalendarContract.Events.RRULE,CalendarContract.Events.ALL_DAY,CalendarContract.Events.DESCRIPTION,CalendarContract.Events.CALENDAR_ID};try(Cursor c=resolver.query(event,fields,null,null,null)){assertNotNull(c);assertTrue(c.moveToFirst());JSONObject row=new JSONObject();for(int i=0;i<fields.length;i++)row.put(fields[i],c.isNull(i)?JSONObject.NULL:c.getString(i));return row;}}
 @Test public void complexExistingEventOpensEtarCancelsAndSavesSameProviderRow()throws Exception{
  Assume.assumeTrue("Install verified Etar and explicitly opt in", "true".equals(InstrumentationRegistry.getArguments().getString("externalCalendar")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  android.content.pm.PackageInfo info=context.getPackageManager().getPackageInfo(ETAR,PackageManager.GET_SIGNING_CERTIFICATES);assertEquals(57,info.getLongVersionCode());
  android.content.pm.Signature[] signatures=info.signingInfo.getApkContentsSigners();assertEquals(1,signatures.length);StringBuilder digest=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()))digest.append(String.format(Locale.ROOT,"%02x",b&255));assertEquals("Pinned F-Droid signer",SIGNER,digest.toString());
  String zone=TimeZone.getDefault().getID(),account="Alpha external editor "+UUID.randomUUID(),title="Alpha handoff "+UUID.randomUUID(),updated=title+" edited";
  Uri calendar=null,event=null;boolean completed=false;
  android.accessibilityservice.AccessibilityServiceInfo service=ui.getServiceInfo();int originalFlags=service.flags;service.flags|=android.accessibilityservice.AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;ui.setServiceInfo(service);
  Throwable primary=null;
  try{
   ContentValues c=new ContentValues();c.put(CalendarContract.Calendars.ACCOUNT_NAME,account);c.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL);c.put(CalendarContract.Calendars.NAME,account);c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,account);c.put(CalendarContract.Calendars.OWNER_ACCOUNT,account);c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_OWNER);c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,zone);c.put(CalendarContract.Calendars.VISIBLE,1);c.put(CalendarContract.Calendars.SYNC_EVENTS,1);
   Uri sync=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();calendar=resolver.insert(sync,c);assertNotNull(calendar);
   LocalDate today=LocalDate.now();long begin=today.atTime(14,0).atZone(ZoneId.of(zone)).toInstant().toEpochMilli(),end=today.plusDays(1).atTime(15,0).atZone(ZoneId.of(zone)).toInstant().toEpochMilli();
   ContentValues v=new ContentValues();v.put(CalendarContract.Events.CALENDAR_ID,ContentUris.parseId(calendar));v.put(CalendarContract.Events.TITLE,title);v.put(CalendarContract.Events.DESCRIPTION,"Disposable external editor fixture");v.put(CalendarContract.Events.DTSTART,begin);v.put(CalendarContract.Events.DTEND,end);v.put(CalendarContract.Events.EVENT_TIMEZONE,zone);event=resolver.insert(CalendarContract.Events.CONTENT_URI,v);assertNotNull(event);JSONObject original=snapshot(resolver,event);
   Intent implicit=new Intent(Intent.ACTION_VIEW,event);assertEquals("Provider MIME", "vnd.android.cursor.item/event",resolver.getType(event));assertNotNull("Installed implicit Calendar handler required",context.getPackageManager().resolveActivity(implicit,PackageManager.MATCH_DEFAULT_ONLY));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();until("document.documentElement.dataset.activeView");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
    String q="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith("+JSONObject.quote(title+",") +"))";until(q);eval("("+q+").click()");click("Edit event");
    chooseEtarOnce();awaitNode(null,title);tap("info_action_edit");awaitNode("title",title);tap("action_cancel");
    assertEquals("Cancel does not mutate any recorded provider fields",original.toString(),snapshot(resolver,event).toString());returnToAlpha(context.getPackageName());
    until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
    // A normal resume may show the grid instead of retaining the detail sheet.
    // Reopen only our uniquely titled provider fixture, never another event.
    if(!"true".equals(eval("!!document.querySelector('button[aria-label=\"Edit event\"]')"))){until(q);eval("("+q+").click()");}
    until("[...document.querySelectorAll('[data-screen] h1')].some(h=>h.textContent==="+JSONObject.quote(title)+")");
    assertEquals("Return and reopening preserve the same provider row",original.toString(),snapshot(resolver,event).toString());
    click("Edit event");chooseEtarOnce();awaitNode(null,title);tap("info_action_edit");setEditorTitle(title,updated);tap("action_done");
    long deadline=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<deadline&&!updated.equals(snapshot(resolver,event).getString(CalendarContract.Events.TITLE)))SystemClock.sleep(100);
    JSONObject saved=snapshot(resolver,event);assertEquals(updated,saved.getString(CalendarContract.Events.TITLE));saved.put(CalendarContract.Events.TITLE,title);assertEquals("Title-only edit preserves identity, epochs and other fixture fields",original.toString(),saved.toString());
    returnToAlpha(context.getPackageName());eval(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();until("[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')?.startsWith("+JSONObject.quote(updated+",")+"))");
    assertEquals("Test never changes timezone",zone,TimeZone.getDefault().getID());completed=true;
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}
  finally{
   try{
   if(calendar!=null){Uri cleanup=calendar.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();assertEquals("Delete only owned calendar",1,resolver.delete(cleanup,null,null));try(Cursor remaining=resolver.query(calendar,new String[]{CalendarContract.Calendars._ID},null,null,null)){assertNotNull(remaining);assertEquals("Owned calendar removed",0,remaining.getCount());}}
   }catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
   finally{service.flags=originalFlags;ui.setServiceInfo(service);}
  }
  assertTrue(completed);
  JSONObject receipt=new JSONObject().put("etarVersion",57).put("signerSha256",digest.toString()).put("implicitHandoff",true).put("cancelUnchanged",true).put("saveSameRowAndEpochs",true).put("returnedToAlpha",true).put("returnMethod",returnedViaLauncher?"home-then-alpha-launcher-after-etar-optional-access-loop":"android-back").put("fixtureCleaned",true).put("timezoneUnchanged",true);
  try(java.io.FileOutputStream output=context.openFileOutput("external-calendar-result.json",Context.MODE_PRIVATE)){output.write(receipt.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}
 }
}
