package ai.elizaresearch.alphaphone;
import android.Manifest;
import android.content.*;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.CalendarContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.time.*;
import java.time.format.DateTimeFormatter;
import java.util.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
/** Distinct real provider rows exceed the actual native 2,000-instance cap. */
@RunWith(AndroidJUnit4.class)
public final class CalendarTruncationInstrumentedTest {
 private String js(String s)throws Exception{return WebViewTestDriver.evaluate(s);}
 private void until(String s)throws Exception{for(int i=0;i<300;i++){if("true".equals(js("Boolean("+s+")")))return;SystemClock.sleep(100);}fail("Calendar truncation condition: "+s+"; safe status="+js("JSON.stringify({warning:document.querySelector('[aria-label=\"Retry calendar and reminders\"]')?.textContent||null,incomplete:document.body.textContent.includes('Calendar results incomplete'),loading:document.body.textContent.includes('Loading calendars'),connect:document.body.textContent.includes('Connect device calendars')})"));}
 private void click(String label)throws Exception{String s="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(s);js("("+s+").click()");}
 @Test public void realInstanceLimitCannotClaimAnUnreturnedDateIsFree()throws Exception{
  org.junit.Assume.assumeTrue("External permission restoration runner required","1".equals(InstrumentationRegistry.getArguments().getString("calendarRange")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();for(String p:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})assertEquals(android.content.pm.PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(p));
  String account="Alpha truncation fixture "+UUID.randomUUID();Uri calendar=null;
  try{
   ContentValues c=new ContentValues();c.put(CalendarContract.Calendars.ACCOUNT_NAME,account);c.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL);c.put(CalendarContract.Calendars.NAME,account);c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,account);c.put(CalendarContract.Calendars.OWNER_ACCOUNT,account);c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_OWNER);c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,TimeZone.getDefault().getID());c.put(CalendarContract.Calendars.VISIBLE,1);c.put(CalendarContract.Calendars.SYNC_EVENTS,1);
   Uri sync=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();calendar=resolver.insert(sync,c);assertNotNull(calendar);
   LocalDate today=LocalDate.now(),target=today.getDayOfMonth()==1?today.plusDays(1):today.minusDays(1);long begin=today.withDayOfMonth(1).minusMonths(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli();
   // This provider did not expand MINUTELY RRULEs (four instances total).
   // Use distinct native rows so the fixture tests Alpha's aggregate bound.
   ArrayList<ContentProviderOperation> batch=new ArrayList<>();
   for(int index=0;index<2001;index++){
    long start=begin+index*60000L;
    ContentValues event=new ContentValues();event.put(CalendarContract.Events.CALENDAR_ID,ContentUris.parseId(calendar));event.put(CalendarContract.Events.TITLE,"Bounded provider fixture "+index);event.put(CalendarContract.Events.DTSTART,start);event.put(CalendarContract.Events.DTEND,start+10000);event.put(CalendarContract.Events.EVENT_TIMEZONE,TimeZone.getDefault().getID());
    batch.add(ContentProviderOperation.newInsert(CalendarContract.Events.CONTENT_URI).withValues(event).build());
    if(batch.size()==200||index==2000){ContentProviderResult[] inserted=resolver.applyBatch(CalendarContract.AUTHORITY,batch);assertEquals(batch.size(),inserted.length);for(ContentProviderResult result:inserted)assertNotNull("Every owned provider event must be inserted",result.uri);batch.clear();}
   }
   String hidden=account+" later event";long later=target.atTime(10,0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();ContentValues sentinel=new ContentValues();sentinel.put(CalendarContract.Events.CALENDAR_ID,ContentUris.parseId(calendar));sentinel.put(CalendarContract.Events.TITLE,hidden);sentinel.put(CalendarContract.Events.DTSTART,later);sentinel.put(CalendarContract.Events.DTEND,later+3600000);sentinel.put(CalendarContract.Events.EVENT_TIMEZONE,TimeZone.getDefault().getID());assertNotNull(resolver.insert(CalendarContract.Events.CONTENT_URI,sentinel));
   Uri.Builder actualRange=CalendarContract.Instances.CONTENT_URI.buildUpon();ContentUris.appendId(actualRange,begin);ContentUris.appendId(actualRange,today.withDayOfMonth(1).plusMonths(2).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli());
   try(android.database.Cursor actual=resolver.query(actualRange.build(),new String[]{CalendarContract.Instances.EVENT_ID},CalendarContract.Instances.CALENDAR_ID+"=?",new String[]{Long.toString(ContentUris.parseId(calendar))},null)){
    assertNotNull("Actual provider instances required",actual);assertEquals("Owned distinct rows must exceed the app limit before checking UI",2002,actual.getCount());
   }
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();js(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();until("document.querySelector('[aria-label=\"Retry calendar and reminders\"]')?.textContent.includes('Calendar results incomplete')");
    click("Month view");click(target.format(DateTimeFormatter.ofPattern("EEEE MMMM d",Locale.US)));
    until("document.body.textContent.includes('Calendar results incomplete. Some events may be missing.')");assertEquals("Incomplete provider result never claims free all day","false",js("document.body.textContent.includes('Free all day')"));
    assertEquals("Known later row is genuinely beyond the limit","false",js("document.body.textContent.includes("+JSONObject.quote(hidden)+")"));
    click("Retry calendar and reminders");until("document.querySelector('[aria-label=\"Retry calendar and reminders\"]')?.textContent.includes('Calendar results incomplete')");
   }
  }finally{if(calendar!=null){Uri cleanup=calendar.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();assertEquals(1,resolver.delete(cleanup,null,null));}}
 }
}
