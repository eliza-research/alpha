package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.CalendarContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.UUID;
import static org.junit.Assert.*;

/** Real prototype UI and durable local data. Provider absence is never a route success.
 * calendarLocationReturnsToTheSameEventAndFailsClosed (mapsEventReturn=1) is the J04 hand-off over the
 * real CalendarProvider: an owned local calendar's event location opens Maps (no provider is
 * configured, so Maps shows its notice and never invents a place), "Back to event" restores that
 * exact event, Android Back returns without a second search, and a deleted event fails closed. */
@RunWith(AndroidJUnit4.class)
public class MapsInstrumentedTest {
 private String eval(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js)throws Exception{long end=SystemClock.elapsedRealtime()+25000;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+js+")")))return;SystemClock.sleep(100);}fail("Maps condition: "+js+" screen="+eval("document.body.innerText.slice(-900)"));}
 private void click(String label)throws Exception{String node="document.querySelector('[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(node);eval("("+node+").click()");}
 private void input(String label,String text)throws Exception{String node="document.querySelector('input[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(node);eval("(()=>{const e="+node+";Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(text)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");}
 /** No Maps provider: the honest Eliza Cloud not-connected state (signed out or no subscription, or Cloud
  * Maps not deployed), never a map, search result or route (maps-adapter.ts mapStatus). */
 private static final String NOT_CONNECTED="(s=>s?.dataset.mapState==='unconfigured'&&['Sign in to Eliza Cloud with an active subscription to search places and plan routes.','Eliza Cloud Maps is not available yet. Enter coordinates or use saved places.'].some(t=>s.textContent.includes(t)))(document.querySelector('[data-alpha-maps-status]'))";
 private void maps()throws Exception{AppNavigation.liveMode();eval(AppNavigation.request("Maps"));until(AppNavigation.selected("Maps"));}
 @Test public void coordinatesSaveRenamePersistAndRemoveWithoutInventedProviderData()throws Exception{
  String label="Alpha maps fixture "+UUID.randomUUID(),renamed=label+" renamed";
  double lat=10+Math.random(),lon=20+Math.random();String point=String.format(java.util.Locale.ROOT,"%.6f, %.6f",lat,lon);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   maps();until(NOT_CONNECTED);
   assertEquals("No simulated geography","false",eval("[...document.querySelectorAll('[data-alpha-maps-root] svg[width=\"1200\"] path')].some(p=>!!p.getAttribute('d'))"));
   input("Search places",point);eval("document.querySelector('input[aria-label=\"Search places\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
   until("document.querySelector('[aria-label=\"Rename place\"]')");assertEquals("Name editor is opt-in", "false", eval("!!document.querySelector('input[aria-label=\"Place name\"]')"));click("Rename place");input("Place name",label);click("Apply place name");click("Save");
   until("JSON.parse(localStorage.getItem('alpha.maps.saved-places.v1')||'{\"items\":[]}').items.some(p=>p.label==="+JSONObject.quote(label)+")");
   click("Directions");until("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('No route has been calculated')");
   click("Rename place");input("Place name",renamed);click("Apply place name");
   eval(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));scenario.recreate();maps();
   until("[...document.querySelectorAll('[data-alpha-maps-root] button')].some(b=>b.textContent.trim()==="+JSONObject.quote(renamed)+")");
   eval("[...document.querySelectorAll('[data-alpha-maps-root] button')].find(b=>b.textContent.trim()==="+JSONObject.quote(renamed)+").click()");
   until("document.querySelector('[aria-label=\"Rename place\"]')?.textContent==="+JSONObject.quote(renamed));click("Remove from saved");
   until("!JSON.parse(localStorage.getItem('alpha.maps.saved-places.v1')).items.some(p=>p.label==="+JSONObject.quote(renamed)+")");
   click("Close place");input("Search places","Tartine Bakery San Francisco");eval("document.querySelector('input[aria-label=\"Search places\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
   until("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Connect a Maps provider')");
   assertEquals("No fake search results","false",eval("[...document.querySelectorAll('[data-alpha-maps-root] button')].some(b=>b.textContent.includes('600 Guerrero'))"));
  }finally{
   // Cleanup only this test's two labels; never restore/erase unrelated saved places.
   try(BoundedActivityScenario<MainActivity> cleanup=BoundedActivityScenario.launch(MainActivity.class)){
    until("document.documentElement.dataset.activeView");eval("(()=>{const key='alpha.maps.saved-places.v1',raw=localStorage.getItem(key);if(!raw)return;const data=JSON.parse(raw);data.items=data.items.filter(p=>!["+JSONObject.quote(label)+","+JSONObject.quote(renamed)+"].includes(p.label));localStorage.setItem(key,JSON.stringify(data));})()");
   }
  }
 }
 @Test public void explicitRecenterUsesInjectedNativeLocationAndStopsWatch()throws Exception{
  String expectedLat=InstrumentationRegistry.getArguments().getString("mapsLatitude"),expectedLon=InstrumentationRegistry.getArguments().getString("mapsLongitude");
  Assume.assumeTrue("Requires root-coordinated continuing emulator GPS injection and mapsLatitude/mapsLongitude args",expectedLat!=null&&expectedLon!=null);
  String app=InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName();
  for(String permission:new String[]{Manifest.permission.ACCESS_COARSE_LOCATION,Manifest.permission.ACCESS_FINE_LOCATION})InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(app,permission);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   maps();click("Recenter");until("document.querySelector('[aria-label=\"Rename place\"]')?.textContent==='Current location'");
   String coordinates=String.format(java.util.Locale.ROOT,"%.5f, %.5f",Double.parseDouble(expectedLat),Double.parseDouble(expectedLon));
   until("document.querySelector('[data-alpha-maps-root]').textContent.includes("+JSONObject.quote(coordinates)+")");
   until("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('accuracy')");
   java.util.concurrent.atomic.AtomicInteger watches=new java.util.concurrent.atomic.AtomicInteger(-1);
   for(int i=0;i<50;i++){
    WebViewTestDriver.withActivity(MainActivity.class,activity->{try{Object plugin=activity.getBridge().getPlugin("ElizaLocation").getInstance();java.lang.reflect.Field field=plugin.getClass().getDeclaredField("watches");field.setAccessible(true);watches.set(((java.util.Map<?,?>)field.get(plugin)).size());}catch(Exception error){throw new AssertionError(error);}});
    if(watches.get()==0)break;SystemClock.sleep(100);
   }
   assertEquals("One-shot fix releases actual native location watch",0,watches.get());
   eval(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));maps();
   assertEquals("Location never resumes implicitly","false",eval("!!document.querySelector('[aria-label=\"Rename place\"]')"));
  }
 }

 /** The open event detail (its Edit control is present) shows exactly this title. */
 private static String detail(String title){return "(!!document.querySelector('[data-screen] button[aria-label=\"Edit event\"]')&&[...document.querySelectorAll('[data-screen] h1')].some(h=>h.textContent.trim()==="+JSONObject.quote(title)+"))";}
 private void openEvent(String title)throws Exception{
  String row="[...document.querySelectorAll('[data-screen] button')].find(b=>b.getAttribute('aria-label')?.startsWith("+JSONObject.quote(title+",")+"))";
  until(row);eval("("+row+").scrollIntoView({block:'center',behavior:'instant'});("+row+").click()");
  until(detail(title));
 }
 private void openLocation(String where)throws Exception{
  String button="[...document.querySelectorAll('[data-screen] button')].find(b=>b.textContent.trim()==="+JSONObject.quote(where)+")";
  until(button);eval("("+button+").click()");until(AppNavigation.selected("Maps"));
  // No provider: the hand-off is a one-use search that reaches only the unconfigured notice.
  until("document.querySelector('[data-alpha-maps-status]')?.textContent.includes('Connect a Maps provider')");
  assertEquals("The hand-off filled the search with the event location only",where,new JSONObject("{\"v\":"+eval("document.querySelector('input[aria-label=\"Search places\"]')?.value??''")+"}").getString("v"));
 }
 @Test public void calendarLocationReturnsToTheSameEventAndFailsClosed()throws Exception{
  Assume.assumeTrue("Explicit owned local calendar fixture","1".equals(InstrumentationRegistry.getArguments().getString("mapsEventReturn")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
  String suffix=UUID.randomUUID().toString().substring(0,8),account="Alpha maps return fixture "+suffix,title="Maps return event "+suffix,other="Maps return other "+suffix,where="12 Market Street, Test Town "+suffix;
  Uri calendars=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true")
   .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();
  ContentValues c=new ContentValues();
  c.put(CalendarContract.Calendars.ACCOUNT_NAME,account);c.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL);
  c.put(CalendarContract.Calendars.NAME,account);c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,account);c.put(CalendarContract.Calendars.OWNER_ACCOUNT,account);
  c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_OWNER);c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,java.util.TimeZone.getDefault().getID());
  c.put(CalendarContract.Calendars.VISIBLE,1);c.put(CalendarContract.Calendars.SYNC_EVENTS,1);
  Uri calendar=resolver.insert(calendars,c);assertNotNull("Fixture calendar inserted",calendar);
  try{
   // Two events today with the same location, so a return to the wrong one would be visible.
   long begin=(System.currentTimeMillis()/60_000L+30)*60_000L;Uri event=null;
   for(String name:new String[]{title,other}){
    ContentValues e=new ContentValues();e.put(CalendarContract.Events.CALENDAR_ID,ContentUris.parseId(calendar));e.put(CalendarContract.Events.TITLE,name);e.put(CalendarContract.Events.EVENT_LOCATION,where);
    e.put(CalendarContract.Events.DTSTART,begin);e.put(CalendarContract.Events.DTEND,begin+30*60_000L);e.put(CalendarContract.Events.EVENT_TIMEZONE,java.util.TimeZone.getDefault().getID());
    Uri inserted=resolver.insert(CalendarContract.Events.CONTENT_URI,e);assertNotNull("Fixture event inserted",inserted);if(name.equals(title))event=inserted;begin+=60*60_000L;
   }
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
    // 1. Back to event restores exactly this event's detail.
    openEvent(title);openLocation(where);
    click("Back to event");until(AppNavigation.selected("Calendar")+"&&"+detail(title));
    assertEquals("The return consumed the hand-off","false",eval("!!document.querySelector('[data-alpha-maps-event-return]')"));
    // 2. Android Back from Maps returns to the same event; nothing is searched again.
    openLocation(where);
    WebViewTestDriver.pressBack();
    until(AppNavigation.selected("Calendar")+"&&"+detail(title));
    eval(AppNavigation.request("Maps"));until(AppNavigation.selected("Maps"));
    assertEquals("Maps opened again carries no replayed search","\"\"",eval("document.querySelector('input[aria-label=\"Search places\"]')?.value??''"));
    assertEquals("Maps opened from Home has no event to return to","false",eval("!!document.querySelector('[data-alpha-maps-event-return]')"));
    // 3. The event is deleted while Maps is open: the return fails closed and Maps stays.
    eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));openEvent(title);openLocation(where);
    assertEquals("Deleted exactly the fixture event",1,resolver.delete(event,null,null));
    click("Back to event");
    until("document.querySelector('[data-alpha-toast]')?.textContent.includes('That event was deleted or moved')");
    assertEquals("Maps stays open","true",eval(AppNavigation.selected("Maps")));
    until("!document.querySelector('[data-alpha-maps-event-return]')");
    assertNotEquals("The other event is never opened in its place","true",eval(detail(other)));
   }
  }finally{
   resolver.delete(calendar.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true")
    .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build(),null,null);
  }
 }
}
