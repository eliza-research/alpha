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
public class CalendarFlowInstrumentedTest {
 private String eval(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void until(String script)throws Exception{
  for(int i=0;i<150;i++){if("true".equals(eval("Boolean("+script+")")))return;SystemClock.sleep(100);}fail("Calendar condition missing: "+script);
 }
 private void click(String label)throws Exception{
  String q="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(q);eval("("+q+").click()");
 }
 private void tapVisibleEvent(String title)throws Exception {
  String node="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')?.startsWith("+JSONObject.quote(title+",")+"))";
  until(node);eval("("+node+").scrollIntoView({block:'center',behavior:'instant'})");
  String check="(()=>{const e="+node+",r=e.getBoundingClientRect(),p=e.closest('.scr').getBoundingClientRect();const top=Math.max(r.top,p.top,0),bottom=Math.min(r.bottom,p.bottom,innerHeight);return bottom>top+8&&(r.height>p.height||(r.top>=p.top&&r.bottom<=p.bottom))&&e.contains(document.elementFromPoint(r.x+r.width/2,(top+bottom)/2))})()";
  until(check);
  JSONObject point=new JSONObject(eval("(()=>{const e=("+node+"),r=e.getBoundingClientRect(),p=e.closest('.scr').getBoundingClientRect();return {x:r.x+r.width/2,y:(Math.max(r.top,p.top,0)+Math.min(r.bottom,p.bottom,innerHeight))/2,width:innerWidth}})()"));
  float[] xy=new float[2];
  WebViewTestDriver.withActivity(MainActivity.class,activity->{android.webkit.WebView web=activity.getBridge().getWebView();int[] location=new int[2];web.getLocationOnScreen(location);float scale=(float)(web.getWidth()/point.optDouble("width"));xy[0]=location[0]+(float)point.optDouble("x")*scale;xy[1]=location[1]+(float)point.optDouble("y")*scale;});
  long down=SystemClock.uptimeMillis();
  for(int action:new int[]{android.view.MotionEvent.ACTION_DOWN,android.view.MotionEvent.ACTION_UP}){
   android.view.MotionEvent event=android.view.MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,xy[0],xy[1],0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);
   try{assertTrue("Android accepted calendar event touch",InstrumentationRegistry.getInstrumentation().getUiAutomation().injectInputEvent(event,true));}finally{event.recycle();}
  }
 }
 private List<Long> ids(ContentResolver resolver,String title){
  List<Long> ids=new ArrayList<>();
  try(Cursor c=resolver.query(CalendarContract.Events.CONTENT_URI,new String[]{CalendarContract.Events._ID},CalendarContract.Events.TITLE+"=? AND "+CalendarContract.Events.DELETED+"=0",new String[]{title},null)){if(c!=null)while(c.moveToNext())ids.add(c.getLong(0));}return ids;
 }
 @Test public void calendarFormPersistsOneRealEventAcrossRecreation()throws Exception{
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
   }
  } finally {for(String fixture:new String[]{title,updated,external})for(long id:ids(resolver,fixture))resolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),null,null);}
 }
 /** Owns only a unique local calendar and restores the device timezone/settings. */
 private static final class CalendarFixture implements AutoCloseable {
  final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  final ContentResolver resolver=context.getContentResolver();
  final String previousZone=TimeZone.getDefault().getID(),name="Alpha calendar fixture "+UUID.randomUUID(),account;
  final int automatic=android.provider.Settings.Global.getInt(resolver,"auto_time_zone",0);
  android.net.Uri calendar;
  CalendarFixture()throws Exception {this(false);}
  CalendarFixture(boolean localIdentity)throws Exception {
   account=localIdentity?"Alpha Phone":name;
   for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
   try {
    timezone("America/Los_Angeles",0);
    ContentValues c=new ContentValues();c.put(CalendarContract.Calendars.ACCOUNT_NAME,account);c.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL);c.put(CalendarContract.Calendars.NAME,name);c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,name);c.put(CalendarContract.Calendars.OWNER_ACCOUNT,account);c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_OWNER);c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,"America/Los_Angeles");c.put(CalendarContract.Calendars.VISIBLE,1);c.put(CalendarContract.Calendars.SYNC_EVENTS,1);
    calendar=resolver.insert(sync(CalendarContract.Calendars.CONTENT_URI),c);assertNotNull(calendar);
   }catch(Throwable error){timezone(previousZone,automatic);throw error;}
  }
  private android.net.Uri sync(android.net.Uri uri){return uri.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();}
  private void timezone(String zone,int auto){
   android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
   ui.adoptShellPermissionIdentity(Manifest.permission.SET_TIME_ZONE,Manifest.permission.WRITE_SECURE_SETTINGS);
   try{android.provider.Settings.Global.putInt(resolver,"auto_time_zone",0);context.getSystemService(android.app.AlarmManager.class).setTimeZone(zone);android.provider.Settings.Global.putInt(resolver,"auto_time_zone",auto);TimeZone.setDefault(null);}finally{ui.dropShellPermissionIdentity();}
  }
  long event(String title,long begin,long end,boolean allDay){
   ContentValues e=new ContentValues();e.put(CalendarContract.Events.CALENDAR_ID,ContentUris.parseId(calendar));e.put(CalendarContract.Events.TITLE,title);e.put(CalendarContract.Events.DTSTART,begin);e.put(CalendarContract.Events.DTEND,end);e.put(CalendarContract.Events.EVENT_TIMEZONE,allDay?"UTC":"America/Los_Angeles");e.put(CalendarContract.Events.ALL_DAY,allDay?1:0);
   android.net.Uri uri=resolver.insert(CalendarContract.Events.CONTENT_URI,e);assertNotNull(uri);return ContentUris.parseId(uri);
  }
  @Override public void close(){try{if(calendar!=null)resolver.delete(sync(calendar),null,null);}finally{timezone(previousZone,automatic);}}
 }
 private void chooseDate(java.time.LocalDate date)throws Exception {
  java.time.LocalDate today=java.time.LocalDate.now(java.time.ZoneId.of("America/Los_Angeles"));
  if("true".equals(eval("!!document.querySelector('button[aria-label=\"Today\"]')")))click("Today");
  click("Month view");
  int months=(date.getYear()-today.getYear())*12+date.getMonthValue()-today.getMonthValue();
  for(int i=0;i<Math.abs(months);i++)click(months>0?"Next month":"Previous month");
  click(date.format(java.time.format.DateTimeFormatter.ofPattern("EEEE MMMM d",Locale.US)));
 }
 @Test public void allDayUtcDatesStayOnTheirCivilDaysWithoutTimedBlocks()throws Exception {
  try(CalendarFixture fixture=new CalendarFixture()){
   String title="Alpha all day "+UUID.randomUUID();java.time.LocalDate today=java.time.LocalDate.now(java.time.ZoneId.of("America/Los_Angeles"));
   fixture.event(title,today.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli(),today.plusDays(2).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli(),true);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();until("Intl.DateTimeFormat().resolvedOptions().timeZone==='America/Los_Angeles'");
    eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
    String label=title+", All day";
    until("document.querySelector('[data-alpha-calendar-all-day]')?.textContent.includes("+JSONObject.quote(title)+")");
    assertEquals("All-day record is not duplicated as a timed block","1",eval("[...document.querySelectorAll('button')].filter(b=>b.getAttribute('aria-label')?.startsWith("+JSONObject.quote(title+",")+")).length"));
    click(label);until("document.querySelector('button[aria-label=\"Edit event\"]')");
    assertEquals("Detail is all-day, not a midnight hour range","true",eval("[...document.querySelectorAll('div')].some(e=>e.children.length===0&&e.textContent==='All day')"));
    click("Back to calendar");chooseDate(today.minusDays(1));
    assertEquals("UTC midnight must not shift to previous local date","false",eval("document.querySelector('[data-alpha-calendar-all-day]')?.textContent.includes("+JSONObject.quote(title)+")===true"));
    // Return through Home to make month navigation relative to Today again.
    eval(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));scenario.recreate();until("document.documentElement.dataset.activeView==='home'");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();chooseDate(today.plusDays(1));
    until("document.querySelector('[data-alpha-calendar-all-day]')?.textContent.includes("+JSONObject.quote(title)+")");
    eval(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));scenario.recreate();until("document.documentElement.dataset.activeView==='home'");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();chooseDate(today.plusDays(2));
    assertEquals("All-day end date is exclusive","false",eval("document.querySelector('[data-alpha-calendar-all-day]')?.textContent.includes("+JSONObject.quote(title)+")===true"));
   }
  }
 }
 @Test public void nonexistentDstWallTimeCannotWriteThenValidTimePersists()throws Exception {
  try(CalendarFixture fixture=new CalendarFixture()){
   java.time.ZoneId zone=java.time.ZoneId.of("America/Los_Angeles");java.time.LocalDate today=java.time.LocalDate.now(zone);
   java.time.zone.ZoneOffsetTransition transition=zone.getRules().nextTransition(java.time.Instant.now());
   while(!transition.isGap())transition=zone.getRules().nextTransition(transition.getInstant().plusSeconds(1));
   if(java.time.temporal.ChronoUnit.DAYS.between(today,transition.getDateTimeBefore().toLocalDate())>=335){
    transition=zone.getRules().previousTransition(java.time.Instant.now());
    while(!transition.isGap())transition=zone.getRules().previousTransition(transition.getInstant().minusSeconds(1));
   }
   java.time.LocalDate day=transition.getDateTimeBefore().toLocalDate();long offset=java.time.temporal.ChronoUnit.DAYS.between(today,day);assertTrue(offset>=-30&&offset<335);
   String title="Alpha DST save "+UUID.randomUUID(),seed="Alpha DST existing "+UUID.randomUUID();
   fixture.event(seed,day.atTime(1,30).atZone(zone).toInstant().toEpochMilli(),day.atTime(3,30).atZone(zone).toInstant().toEpochMilli(),false);
   try {
    try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
     AppNavigation.liveMode();until("Intl.DateTimeFormat().resolvedOptions().timeZone==='America/Los_Angeles'");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();chooseDate(day);
     // The loaded provider event retains its two-hour wall-clock span across the gap.
     until("[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')?.startsWith("+JSONObject.quote(seed+",")+"))");
     tapVisibleEvent(seed);
     until("document.querySelector('button[aria-label=\"Edit event\"]')");
     assertEquals("DST-crossing provider detail keeps actual end time","true",eval("document.querySelector('[data-screen]').textContent.includes('3:30')"));click("Back to calendar");
     click("New event");until("document.querySelector('input[aria-label=Title]')");
     eval("(()=>{const e=document.querySelector('input[aria-label=Title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(title)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
     for(int i=0;i<30;i++)click("Start earlier"); // 10:00 -> nonexistent 02:30.
     click("Save event");until("document.querySelector('[data-screen]').textContent.includes('This local time does not exist')");
     assertTrue("Missing DST wall time never reaches CalendarProvider",ids(fixture.resolver,title).isEmpty());
     assertEquals("Invalid draft remains editable","true",eval("!!document.querySelector('input[aria-label=Title]')"));
     click("Start later");click("Start later"); // Actual 03:00.
     click("Save event");until("!document.querySelector('input[aria-label=Title]')");
     List<Long> rows=ids(fixture.resolver,title);assertEquals(1,rows.size());
     try(Cursor c=fixture.resolver.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,rows.get(0)),new String[]{CalendarContract.Events.DTSTART,CalendarContract.Events.DTEND},null,null,null)){
      assertNotNull(c);assertTrue(c.moveToFirst());assertEquals(day.atTime(3,0).atZone(zone).toInstant().toEpochMilli(),c.getLong(0));assertEquals(day.atTime(4,0).atZone(zone).toInstant().toEpochMilli(),c.getLong(1));
     }
    }
   }finally{for(long id:ids(fixture.resolver,title))fixture.resolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),null,null);}
  }
 }

 private void assertProviderTimes(CalendarFixture fixture,long id,long begin,long end)throws Exception{
  try(Cursor row=fixture.resolver.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),new String[]{CalendarContract.Events.DTSTART,CalendarContract.Events.DTEND},null,null,null)){
   assertNotNull(row);assertTrue(row.moveToFirst());assertEquals("Original start instant preserved",begin,row.getLong(0));assertEquals("Original end instant preserved",end,row.getLong(1));
  }
 }
 private void assertComplexEditHandoff(CalendarFixture fixture,long id,long begin,long end)throws Exception{
  java.util.concurrent.atomic.AtomicReference<Intent> seen=new java.util.concurrent.atomic.AtomicReference<>();
  android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
  android.app.Instrumentation.ActivityMonitor monitor=new android.app.Instrumentation.ActivityMonitor(){
   @Override public android.app.Instrumentation.ActivityResult onStartActivity(Intent intent){
    if(Intent.ACTION_VIEW.equals(intent.getAction())&&ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id).equals(intent.getData())){
     seen.set(new Intent(intent));return new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null);
    }return null;
   }
  };
  instrumentation.addMonitor(monitor);
  try{
   click("Edit event");long deadline=SystemClock.elapsedRealtime()+10000;while(seen.get()==null&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(100);
   assertNotNull("Complex edit explicitly dispatches Android Calendar view intent",seen.get());
   assertEquals(begin,seen.get().getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME,-1));assertEquals(end,seen.get().getLongExtra(CalendarContract.EXTRA_EVENT_END_TIME,-1));
   assertEquals("Lossy local title edit form is not offered","false",eval("!!document.querySelector('input[aria-label=Title]')"));
   assertProviderTimes(fixture,id,begin,end);
  }finally{instrumentation.removeMonitor(monitor);}
 }
 @Test public void repeatedHourProviderEndpointsRemainExactAndEditsHandoff()throws Exception{
  try(CalendarFixture fixture=new CalendarFixture(true)){
   java.time.ZoneId zone=java.time.ZoneId.of("America/Los_Angeles");java.time.LocalDate today=java.time.LocalDate.now(zone);
   java.time.zone.ZoneOffsetTransition fold=zone.getRules().nextTransition(java.time.Instant.now());
   while(!fold.isOverlap())fold=zone.getRules().nextTransition(fold.getInstant().plusSeconds(1));
   if(java.time.temporal.ChronoUnit.DAYS.between(today,fold.getDateTimeAfter().toLocalDate())>=335){fold=zone.getRules().previousTransition(java.time.Instant.now());while(!fold.isOverlap())fold=zone.getRules().previousTransition(fold.getInstant().minusSeconds(1));}
   java.time.LocalDate day=fold.getDateTimeAfter().toLocalDate();
   long begin=day.atTime(1,30).atZone(zone).withEarlierOffsetAtOverlap().toInstant().toEpochMilli();
   long equal=day.atTime(1,30).atZone(zone).withLaterOffsetAtOverlap().toInstant().toEpochMilli(),earlier=day.atTime(1,15).atZone(zone).withLaterOffsetAtOverlap().toInstant().toEpochMilli();
   String a="Alpha fold equal "+UUID.randomUUID(),b="Alpha fold backward "+UUID.randomUUID();long aId=fixture.event(a,begin,equal,false),bId=fixture.event(b,begin,earlier,false);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();until("Intl.DateTimeFormat().resolvedOptions().timeZone==='America/Los_Angeles'");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();chooseDate(day);
    for(int index=0;index<2;index++){
     String title=index==0?a:b;long id=index==0?aId:bId,end=index==0?equal:earlier;
     tapVisibleEvent(title);until("document.querySelector('button[aria-label=\"Edit event\"]')");
     String expected=index==0?"1:30 AM UTC-07:00 – 1:30 AM UTC-08:00":"1:30 AM UTC-07:00 – 1:15 AM UTC-08:00";
     assertEquals("Detail shows actual repeated-hour endpoints, not clamped geometry","true",eval("[...document.querySelectorAll('div')].some(e=>e.children.length===0&&e.textContent.replaceAll(String.fromCharCode(8239),' ').replaceAll(String.fromCharCode(160),' ')==="+JSONObject.quote(expected)+")"));
     assertComplexEditHandoff(fixture,id,begin,end);click("Back to calendar");
    }
   }
  }
 }
 @Test public void overnightAndThreeDayEventsHaveClippedTouchableDailySegments()throws Exception{
  try(CalendarFixture fixture=new CalendarFixture(true)){
   java.time.ZoneId zone=java.time.ZoneId.of("America/Los_Angeles");java.time.LocalDate day=java.time.LocalDate.now(zone).plusDays(2);
   String overnight="Alpha overnight "+UUID.randomUUID(),multi="Alpha three day "+UUID.randomUUID();
   long start=day.atTime(22,30).atZone(zone).toInstant().toEpochMilli(),nightEnd=day.plusDays(1).atTime(2,30).atZone(zone).toInstant().toEpochMilli(),multiEnd=day.plusDays(3).atTime(10,0).atZone(zone).toInstant().toEpochMilli();
   long nightId=fixture.event(overnight,start,nightEnd,false),multiId=fixture.event(multi,start,multiEnd,false);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();until("Intl.DateTimeFormat().resolvedOptions().timeZone==='America/Los_Angeles'");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
    for(int offset=0;offset<=3;offset++){
     chooseDate(day.plusDays(offset));
     String title=offset<2?overnight:multi;long id=offset<2?nightId:multiId,end=offset<2?nightEnd:multiEnd;
     until("[...document.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')?.startsWith("+JSONObject.quote(title+",")+"))");
     assertEquals("Segment never exceeds one 24-hour axis","true",eval("[...document.querySelectorAll('button')].filter(e=>e.getAttribute('aria-label')?.startsWith("+JSONObject.quote(multi+",")+")).every(e=>e.getBoundingClientRect().height<=24*56)"));
     tapVisibleEvent(title);until("document.querySelector('button[aria-label=\"Edit event\"]')");
     String endDate=java.time.Instant.ofEpochMilli(end).atZone(zone).toLocalDate().format(java.time.format.DateTimeFormatter.ofPattern("MMM d, uuuu",Locale.US));
     assertEquals("Detail contains actual end date","true",eval("document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(endDate)+")"));
     assertComplexEditHandoff(fixture,id,start,end);click("Back to calendar");
     if(offset>=2)assertEquals("Overnight record disappears after its end day","false",eval("[...document.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')?.startsWith("+JSONObject.quote(overnight+",")+"))"));
    }
    chooseDate(day.plusDays(4));assertEquals("Multi-day event ends exclusively","false",eval("[...document.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')?.startsWith("+JSONObject.quote(multi+",")+"))"));
    assertProviderTimes(fixture,nightId,start,nightEnd);assertProviderTimes(fixture,multiId,start,multiEnd);
   }
  }
 }

}
