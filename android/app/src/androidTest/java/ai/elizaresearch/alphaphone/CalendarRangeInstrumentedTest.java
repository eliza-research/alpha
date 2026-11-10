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

/** Actual CalendarProvider rows beyond the former fixed window, via visible date controls. */
@RunWith(AndroidJUnit4.class)
public final class CalendarRangeInstrumentedTest {
 private String js(String s)throws Exception{return WebViewTestDriver.evaluate(s);}
 private void until(String s)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+s+")")))return;SystemClock.sleep(100);}fail("Calendar range condition: "+s+"; safe state="+js("JSON.stringify({view:document.documentElement.dataset.activeView,month:document.querySelector('[aria-label=\"Month view\"]')?.textContent,loading:document.body.textContent.includes('Loading calendars'),failed:document.body.textContent.includes('Calendar range could not be loaded'),connected:document.body.textContent.includes('Device calendars connected'),incomplete:document.body.textContent.includes('Calendar results incomplete')})"));}
 private void click(String label)throws Exception{String s="[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(s);js("("+s+").click()");}
 private void date(LocalDate target)throws Exception{
  if("true".equals(js("!!document.querySelector('button[aria-label=\"Today\"]')")))click("Today");
  click("Month view");LocalDate today=LocalDate.now();int delta=(target.getYear()-today.getYear())*12+target.getMonthValue()-today.getMonthValue();
  for(int i=1;i<=Math.abs(delta);i++){
   click(delta<0?"Previous month":"Next month");LocalDate month=today.withDayOfMonth(1).plusMonths((delta<0?-1:1)*i);
   String label=month.getMonth().getDisplayName(java.time.format.TextStyle.FULL,Locale.US)+(month.getYear()==today.getYear()?"":" "+month.getYear());
   until("document.querySelector('[aria-label=\"Month view\"]').textContent.trim()==="+JSONObject.quote(label));
  }
  // Exercise overlapping real provider requests around the chosen month.
  click("Next month");click("Previous month");
  click(target.format(DateTimeFormatter.ofPattern("EEEE MMMM d",Locale.US)));
 }
 @Test public void distantDatesLoadRealRowsAndNewestNavigationWins()throws Exception{
  org.junit.Assume.assumeTrue("External permission restoration runner required", "1".equals(InstrumentationRegistry.getArguments().getString("calendarRange")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})assertEquals("Runner grants calendar permission before launch",android.content.pm.PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(permission));
  String account="Alpha range fixture "+UUID.randomUUID(),pastTitle=account+" past",futureTitle=account+" future";Uri calendar=null;
  try{
   ContentValues c=new ContentValues();c.put(CalendarContract.Calendars.ACCOUNT_NAME,account);c.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL);c.put(CalendarContract.Calendars.NAME,account);c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,account);c.put(CalendarContract.Calendars.OWNER_ACCOUNT,account);c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_OWNER);c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,TimeZone.getDefault().getID());c.put(CalendarContract.Calendars.VISIBLE,1);c.put(CalendarContract.Calendars.SYNC_EVENTS,1);
   Uri sync=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();calendar=resolver.insert(sync,c);assertNotNull(calendar);
   LocalDate past=LocalDate.now().minusDays(120),future=LocalDate.now().plusDays(430);
   for(int i=0;i<2;i++){LocalDate day=i==0?past:future;long begin=day.atTime(10,0).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();ContentValues event=new ContentValues();event.put(CalendarContract.Events.CALENDAR_ID,ContentUris.parseId(calendar));event.put(CalendarContract.Events.TITLE,i==0?pastTitle:futureTitle);event.put(CalendarContract.Events.DTSTART,begin);event.put(CalendarContract.Events.DTEND,begin+3600000);event.put(CalendarContract.Events.EVENT_TIMEZONE,TimeZone.getDefault().getID());assertNotNull(resolver.insert(CalendarContract.Events.CONTENT_URI,event));}
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();js(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
    for(int i:new int[]{0,1,0}){date(i==0?past:future);String title=i==0?pastTitle:futureTitle,other=i==0?futureTitle:pastTitle;until("[...document.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')?.startsWith("+JSONObject.quote(title+",")+"))");assertEquals("Other date does not leak stale event", "false",js("[...document.querySelectorAll('button')].some(e=>e.getAttribute('aria-label')?.startsWith("+JSONObject.quote(other+",")+"))"));}
   }
  }finally{if(calendar!=null){Uri cleanup=calendar.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();assertEquals(1,resolver.delete(cleanup,null,null));}}
 }
}
