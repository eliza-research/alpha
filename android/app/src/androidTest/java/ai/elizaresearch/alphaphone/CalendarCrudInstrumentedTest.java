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
 private void until(String script)throws Exception{CalendarUiTestDriver.until(script);}
 private void click(String label)throws Exception{
  String q="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(q+" && !("+q+").disabled");eval("("+q+").click()");
 }
 private void tapVisibleEvent(String title)throws Exception{CalendarUiTestDriver.tapVisibleEvent(title);}
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
    click("Delete event");nativeWait("Delete calendar event?");nativeClick("Delete event");until("document.querySelector('[data-screen]').textContent.includes('Local event deleted and verified')");assertTrue(ids(resolver,external).isEmpty());
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
