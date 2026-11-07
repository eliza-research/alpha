package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.*;
import android.database.Cursor;
import android.os.SystemClock;
import android.provider.CalendarContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real CalendarProvider creation through the product form, with disposable records. */
@RunWith(AndroidJUnit4.class)
public class CalendarCrudInstrumentedTest {
 private String eval(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void until(String script)throws Exception{
  for(int i=0;i<150;i++){if("true".equals(eval("Boolean("+script+")")))return;SystemClock.sleep(100);}fail("Calendar condition missing: "+script+"; diagnostics="+eval("({view:document.documentElement.dataset.activeView,text:document.querySelector('[data-screen]')?.textContent?.slice(0,3000),buttons:[...document.querySelectorAll('button[aria-label]')].map(b=>b.getAttribute('aria-label')).slice(-40),tap:window.__calendarTapEvents})"));
 }
 private void click(String label)throws Exception{
  String q="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(q+" && !("+q+").disabled");eval("("+q+").click()");
 }
 private void tapVisibleEvent(String title)throws Exception {
  String node="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith("+JSONObject.quote(title+",")+"))";
  until(node);eval("("+node+").scrollIntoView({block:'center',behavior:'instant'})");
  String check="(()=>{const e="+node+",r=e.getBoundingClientRect(),p=e.closest('.scr').getBoundingClientRect();const top=Math.max(r.top,p.top,0),bottom=Math.min(r.bottom,p.bottom,innerHeight);return bottom>top+8&&(r.height>p.height||(r.top>=p.top&&r.bottom<=p.bottom))&&e.contains(document.elementFromPoint(r.x+r.width/2,(top+bottom)/2))})()";
  until(check);
  // Tap the rendered event only after its finite ancestor entrance animation settles. The timeline's
  // scroll-driven edge fades report "running" for as long as they exist and never advance with time.
  until("(()=>{const e="+node+";return !document.getAnimations().some(a=>a.timeline===document.timeline&&a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity&&a.effect?.target?.contains(e))})()");
  until(check);
  boolean[] focused={false};String[] window={"unobserved"};long focusDeadline=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<focusDeadline){WebViewTestDriver.withActivity(MainActivity.class,activity->{android.webkit.WebView web=activity.getBridge().getWebView();focused[0]=activity.hasWindowFocus()&&web.hasWindowFocus()&&web.isShown();window[0]="activityFocus="+activity.hasWindowFocus()+" webFocus="+web.hasWindowFocus()+" shown="+web.isShown()+" size="+web.getWidth()+"x"+web.getHeight();});if(focused[0])break;SystemClock.sleep(100);}
  assertTrue("Calendar native tap requires the foreground WebView: "+window[0],focused[0]);
  JSONObject point=new JSONObject(eval("(()=>{const e=("+node+"),r=e.getBoundingClientRect(),p=e.closest('.scr').getBoundingClientRect();return {x:r.x+r.width/2,y:(Math.max(r.top,p.top,0)+Math.min(r.bottom,p.bottom,innerHeight))/2,width:innerWidth}})()"));
  float[] xy=new float[2];
  WebViewTestDriver.withActivity(MainActivity.class,activity->{android.webkit.WebView web=activity.getBridge().getWebView();int[] location=new int[2];web.getLocationOnScreen(location);float scale=(float)(web.getWidth()/point.optDouble("width"));xy[0]=location[0]+(float)point.optDouble("x")*scale;xy[1]=location[1]+(float)point.optDouble("y")*scale;});
  eval("window.__calendarTapEvents=[];for(const name of ['pointerdown','pointerup','click'])document.addEventListener(name,e=>window.__calendarTapEvents.push({type:e.type,label:e.target.closest('button')?.getAttribute('aria-label'),x:e.clientX,y:e.clientY}),{capture:true,once:true})");
  long down=SystemClock.uptimeMillis();
  for(int action:new int[]{android.view.MotionEvent.ACTION_DOWN,android.view.MotionEvent.ACTION_UP}){
   android.view.MotionEvent event=android.view.MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,xy[0],xy[1],0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
   try{assertTrue("Android accepted calendar event touch",InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event,true));}finally{event.recycle();}
  }
  until("window.__calendarTapEvents.some(e=>e.type==='click'&&e.label?.startsWith("+JSONObject.quote(title+",")+"))");
 }
 private List<Long> ids(ContentResolver resolver,String title){
  List<Long> ids=new ArrayList<>();
  try(Cursor c=resolver.query(CalendarContract.Events.CONTENT_URI,new String[]{CalendarContract.Events._ID},CalendarContract.Events.TITLE+"=? AND "+CalendarContract.Events.DELETED+"=0",new String[]{title},null)){if(c!=null)while(c.moveToNext())ids.add(c.getLong(0));}return ids;
 }
 @Test public void calendarCrudPreservesIdentityAndRejectsStaleDelete()throws Exception{
  org.junit.Assume.assumeTrue("Explicit synthetic Calendar CRUD fixture required", "1".equals(InstrumentationRegistry.getArguments().getString("calendarCrud")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
  String title="Alpha Calendar "+UUID.randomUUID();
  String updated=title+" edited",external=title+" changed elsewhere";
  try {
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();
    until("document.documentElement.dataset.activeView");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
    click("New event");until("document.querySelector('input[aria-label=Title]')");
    eval("(()=>{const e=document.querySelector('input[aria-label=Title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(title)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    until("document.querySelector('input[aria-label=Title]').value==="+JSONObject.quote(title));
    assertTrue("Typing cannot create events",ids(resolver,title).isEmpty());
    click("Save event");until("!document.querySelector('input[aria-label=Title]')");
    until("!!document.querySelector('button[aria-label=\"Edit event\"]') && document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(title)+")");
    List<Long> created=ids(resolver,title);assertEquals("One explicit save creates exactly one provider event",1,created.size());
    try(Cursor row=resolver.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,created.get(0)),new String[]{CalendarContract.Events.DTSTART,CalendarContract.Events.DTEND,CalendarContract.Events.EVENT_TIMEZONE},null,null,null)){
     assertNotNull(row);assertTrue(row.moveToFirst());assertEquals("Default event lasts one hour",3600000L,row.getLong(1)-row.getLong(0));assertNotNull(row.getString(2));
    }
    click("Edit event");until("document.querySelector('input[aria-label=Title]')");
    eval("(()=>{const e=document.querySelector('input[aria-label=Title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(updated)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
    assertEquals("Editing a draft does not write",1,ids(resolver,title).size());
    click("Save event");until("!document.querySelector('input[aria-label=Title]')");
    assertEquals("Edit preserves provider identity",created,ids(resolver,updated));assertTrue(ids(resolver,title).isEmpty());
    click("Edit event");until("document.querySelector('input[aria-label=Title]')");
    ContentValues concurrent=new ContentValues();concurrent.put(CalendarContract.Events.TITLE,external);
    resolver.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,created.get(0)),concurrent,null,null);
    click("Save event");until("document.querySelector('[data-screen]').textContent.includes('Nothing was overwritten')");
    assertEquals("Concurrent edit is preserved",created,ids(resolver,external));assertTrue(ids(resolver,updated).isEmpty());
    scenario.recreate();until("document.documentElement.dataset.activeView==='home'");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();until("document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(external)+")");
    assertEquals(1,ids(resolver,external).size());
    tapVisibleEvent(external);until("document.querySelector('button[aria-label=\"Delete event\"]')");
    click("Delete event");nativeWait("Delete calendar event?");assertEquals("Review never deletes",1,ids(resolver,external).size());nativeClick("Cancel");assertEquals(1,ids(resolver,external).size());
    click("Delete event");nativeWait("Delete calendar event?");
    ContentValues changed=new ContentValues();changed.put(CalendarContract.Events.DESCRIPTION,"Changed during delete review");resolver.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,created.get(0)),changed,null,null);
    nativeClick("Delete event");until("document.querySelector('[data-screen]').textContent.includes('Nothing was deleted')");assertEquals("Stale reviewed delete preserves row",1,ids(resolver,external).size());
    click("Delete event");nativeWait("Delete calendar event?");nativeClick("Delete event");until("document.querySelector('[data-screen]').textContent.includes('Event deleted.')");assertTrue(ids(resolver,external).isEmpty());
    scenario.recreate();until("document.documentElement.dataset.activeView==='home'");assertTrue("Deletion survives process UI recreation",ids(resolver,external).isEmpty());
   }
  } finally {for(String fixture:new String[]{title,updated,external})for(long id:ids(resolver,fixture))resolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),null,null);}
 }
 private void nativeWait(String text)throws Exception {for(int i=0;i<100;i++){android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root!=null&&root.findAccessibilityNodeInfosByText(text).stream().anyMatch(n->n.isVisibleToUser()&&text.equalsIgnoreCase(String.valueOf(n.getText()))))return;SystemClock.sleep(100);}fail("Native review missing: "+text);}
 private void nativeClick(String text)throws Exception {nativeWait(text);android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();for(android.view.accessibility.AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(text)){if(text.equalsIgnoreCase(String.valueOf(node.getText()))&&node.isVisibleToUser()&&node.isClickable()&&node.performAction(android.view.accessibility.AccessibilityNodeInfo.ACTION_CLICK))return;}fail("Native review control missing: "+text);}
 @Test public void revokedCalendarWriteAccessDuringReviewCannotDelete()throws Exception {
  org.junit.Assume.assumeTrue("Explicit synthetic Calendar CRUD fixture required", "1".equals(InstrumentationRegistry.getArguments().getString("calendarCrud")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
  String unique="Alpha delete revocation "+UUID.randomUUID();android.net.Uri calendar=null;
  try{
   ContentValues values=new ContentValues();values.put(CalendarContract.Calendars.ACCOUNT_NAME,"Alpha Phone");values.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL);values.put(CalendarContract.Calendars.NAME,"alpha-phone-local");values.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,unique);values.put(CalendarContract.Calendars.OWNER_ACCOUNT,"Alpha Phone");values.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_OWNER);values.put(CalendarContract.Calendars.VISIBLE,1);values.put(CalendarContract.Calendars.SYNC_EVENTS,1);values.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,TimeZone.getDefault().getID());
   calendar=resolver.insert(CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,"Alpha Phone").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build(),values);assertNotNull(calendar);long calendarId=ContentUris.parseId(calendar);
   Calendar when=Calendar.getInstance();when.set(Calendar.HOUR_OF_DAY,12);when.set(Calendar.MINUTE,0);when.set(Calendar.SECOND,0);when.set(Calendar.MILLISECOND,0);
   ContentValues event=new ContentValues();event.put(CalendarContract.Events.CALENDAR_ID,calendarId);event.put(CalendarContract.Events.TITLE,unique);event.put(CalendarContract.Events.DTSTART,when.getTimeInMillis());event.put(CalendarContract.Events.DTEND,when.getTimeInMillis()+3600000);event.put(CalendarContract.Events.EVENT_TIMEZONE,TimeZone.getDefault().getID());android.net.Uri row=resolver.insert(CalendarContract.Events.CONTENT_URI,event);assertNotNull(row);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();until("document.documentElement.dataset.activeView");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();tapVisibleEvent(unique);click("Delete event");nativeWait("Delete calendar event?");
    ContentValues revoked=new ContentValues();revoked.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_READ);assertEquals(1,resolver.update(calendar,revoked,null,null));
    nativeClick("Delete event");until("document.querySelector('[data-screen]').textContent.includes('Nothing was deleted')");assertEquals("Calendar ACL revocation preserves exact fixture",1,ids(resolver,unique).size());
   }
  }finally{if(calendar!=null)resolver.delete(calendar,null,null);}
 }
}
