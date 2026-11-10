package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.calendar.read.SelectedCalendarReader;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.provider.CalendarContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import ai.eliza.plugins.calendar.read.CalendarSourceIdentity;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Free/busy reads against the device's actual CalendarProvider, using only calendars this test
 * creates and removes. Covers the reader beneath the foreground review: it does not exercise
 * the permission dialog, the WebView review, a synced account, or a declined invitation.
 * Needs READ_CALENDAR and WRITE_CALENDAR granted by the runner; skipped otherwise.
 */
@RunWith(AndroidJUnit4.class)
public final class CalendarAvailabilityInstrumentedTest {
 private static final DateTimeFormatter INSTANT=new DateTimeFormatterBuilder().appendInstant(3).toFormatter();
 private static final long HOUR=3600000L,DAY=86400000L;
 private final List<Uri> created=new ArrayList<>();
 private final List<String> accounts=new ArrayList<>();
 private ContentResolver resolver;
 private final ZoneId zone=ZoneId.systemDefault();
 private final LocalDate date=LocalDate.now(zone).plusDays(40);
 private long dayStart,dayEnd;

 @Before public void permissions(){
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})
   Assume.assumeTrue("Runner grants calendar permission before this test",context.checkSelfPermission(permission)==android.content.pm.PackageManager.PERMISSION_GRANTED);
  resolver=context.getContentResolver();
  dayStart=date.atStartOfDay(zone).toInstant().toEpochMilli();dayEnd=date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli();
 }
 @After public void cleanup(){
  for(int i=0;i<created.size();i++)resolver.delete(sync(created.get(i),accounts.get(i)),null,null);
 }
 private static Uri sync(Uri uri,String account){
  return uri.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();
 }
 private long calendar(String label,int access){
  String account="Alpha availability "+label+" "+UUID.randomUUID();
  ContentValues c=new ContentValues();
  c.put(CalendarContract.Calendars.ACCOUNT_NAME,account);c.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL);c.put(CalendarContract.Calendars.NAME,account);
  c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,account);c.put(CalendarContract.Calendars.OWNER_ACCOUNT,account);c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,access);
  c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,zone.getId());c.put(CalendarContract.Calendars.VISIBLE,1);c.put(CalendarContract.Calendars.SYNC_EVENTS,1);
  Uri uri=resolver.insert(sync(CalendarContract.Calendars.CONTENT_URI,account),c);assertNotNull(uri);created.add(uri);accounts.add(account);
  return ContentUris.parseId(uri);
 }
 private void event(long calendarId,String title,long begin,long end,boolean allDay,Integer availability,Integer status){
  ContentValues e=new ContentValues();
  e.put(CalendarContract.Events.CALENDAR_ID,calendarId);e.put(CalendarContract.Events.TITLE,title);e.put(CalendarContract.Events.DESCRIPTION,"SECRET_DESCRIPTION");e.put(CalendarContract.Events.EVENT_LOCATION,"SECRET_LOCATION");
  e.put(CalendarContract.Events.DTSTART,begin);e.put(CalendarContract.Events.DTEND,end);e.put(CalendarContract.Events.EVENT_TIMEZONE,allDay?"UTC":zone.getId());e.put(CalendarContract.Events.ALL_DAY,allDay?1:0);
  if(availability!=null)e.put(CalendarContract.Events.AVAILABILITY,availability);
  if(status!=null)e.put(CalendarContract.Events.STATUS,status);
  assertNotNull(resolver.insert(CalendarContract.Events.CONTENT_URI,e));
 }
 private JSONArray chosen(long... ids)throws Exception{
  JSONArray selected=new JSONArray();
  for(long id:ids)selected.put(new JSONObject().put("id",Long.toString(id)).put("revision",CalendarSourceIdentity.read(resolver,id).getString("sourceRevision")));
  return selected;
 }
 private static String iso(long at){return INSTANT.format(Instant.ofEpochMilli(at));}
 private static JSONObject row(long start,long end,boolean allDay,String availability)throws Exception{
  return new JSONObject().put("start",iso(start)).put("end",iso(end)).put("allDay",allDay).put("availability",availability);
 }
 private static void assertRows(JSONArray actual,JSONObject... expected)throws Exception{
  assertEquals(actual.toString(),expected.length,actual.length());
  for(int i=0;i<expected.length;i++){
   JSONObject got=actual.getJSONObject(i);
   assertEquals("Only interval, all-day flag and availability are returned: "+got,4,got.length());
   for(String key:new String[]{"start","end","allDay","availability"})assertEquals(key+" of row "+i+" in "+actual,expected[i].get(key),got.get(key));
  }
  String text=actual.toString();
  for(String secret:new String[]{"SECRET","Alpha availability","title","description","location"})assertFalse("No event or calendar content: "+secret,text.contains(secret));
 }

 @Test public void readsOnlyChosenCalendarsAndCarriesProviderAvailability()throws Exception{
  long work=calendar("work",CalendarContract.Calendars.CAL_ACCESS_OWNER),other=calendar("other",CalendarContract.Calendars.CAL_ACCESS_OWNER);
  event(work,"SECRET_BUSY",dayStart+9*HOUR,dayStart+10*HOUR,false,CalendarContract.Events.AVAILABILITY_BUSY,null);
  event(work,"SECRET_FREE",dayStart+11*HOUR,dayStart+12*HOUR,false,CalendarContract.Events.AVAILABILITY_FREE,null);
  event(work,"SECRET_TENTATIVE",dayStart+13*HOUR,dayStart+14*HOUR,false,CalendarContract.Events.AVAILABILITY_TENTATIVE,null);
  event(work,"SECRET_CANCELLED",dayStart+15*HOUR,dayStart+16*HOUR,false,CalendarContract.Events.AVAILABILITY_BUSY,CalendarContract.Events.STATUS_CANCELED);
  event(work,"SECRET_NEXT_DAY",dayEnd+2*HOUR,dayEnd+3*HOUR,false,null,null);
  event(other,"SECRET_UNRELATED",dayStart+9*HOUR,dayStart+17*HOUR,false,CalendarContract.Events.AVAILABILITY_BUSY,null);
  JSONArray rows=SelectedCalendarReader.readAvailability(resolver,chosen(work),iso(dayStart),iso(dayEnd),zone);
  assertRows(rows,row(dayStart+9*HOUR,dayStart+10*HOUR,false,"busy"),row(dayStart+11*HOUR,dayStart+12*HOUR,false,"free"),row(dayStart+13*HOUR,dayStart+14*HOUR,false,"tentative"));
  // Choosing both calendars adds the second calendar's interval and nothing else.
  JSONArray both=SelectedCalendarReader.readAvailability(resolver,chosen(work,other),iso(dayStart),iso(dayEnd),zone);
  assertEquals(both.toString(),4,both.length());
  // A window that touches no event is empty; an event ending at the window start does not overlap.
  assertRows(SelectedCalendarReader.readAvailability(resolver,chosen(work),iso(dayStart+10*HOUR),iso(dayStart+11*HOUR),zone));
 }

 @Test public void allDayEventsFollowTheOwnersCivilDate()throws Exception{
  long home=calendar("home",CalendarContract.Calendars.CAL_ACCESS_OWNER);
  long civil=date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
  event(home,"SECRET_ALL_DAY",civil,civil+DAY,true,CalendarContract.Events.AVAILABILITY_BUSY,null);
  JSONObject allDay=row(civil,civil+DAY,true,"busy");
  // The first and last local hour of the date both fall on it, whatever the UTC offset.
  assertRows(SelectedCalendarReader.readAvailability(resolver,chosen(home),iso(dayStart),iso(dayStart+HOUR),zone),allDay);
  assertRows(SelectedCalendarReader.readAvailability(resolver,chosen(home),iso(dayEnd-HOUR),iso(dayEnd),zone),allDay);
  // The local hours just outside the date do not, even where the UTC date still matches.
  assertRows(SelectedCalendarReader.readAvailability(resolver,chosen(home),iso(dayStart-HOUR),iso(dayStart),zone));
  assertRows(SelectedCalendarReader.readAvailability(resolver,chosen(home),iso(dayEnd),iso(dayEnd+HOUR),zone));
 }

 @Test public void changedSourcesBoundsAndSourceListing()throws Exception{
  long work=calendar("work",CalendarContract.Calendars.CAL_ACCESS_OWNER),shared=calendar("freebusy",CalendarContract.Calendars.CAL_ACCESS_FREEBUSY),hidden=calendar("none",CalendarContract.Calendars.CAL_ACCESS_NONE);
  JSONArray sources=SelectedCalendarReader.availabilitySources(resolver);boolean sawWork=false,sawShared=false;
  for(int i=0;i<sources.length();i++){
   JSONObject source=sources.getJSONObject(i);
   assertEquals(4,source.length());assertTrue(source.getString("sourceRevision").matches("[a-f0-9]{64}"));
   assertNotEquals("A calendar with no access is never offered",Long.toString(hidden),source.getString("id"));
   sawWork|=source.getString("id").equals(Long.toString(work));sawShared|=source.getString("id").equals(Long.toString(shared));
  }
  assertTrue("Readable calendar offered",sawWork);assertTrue("Free/busy-level calendar offered",sawShared);
  // The reviewed revision binds the read: a renamed calendar must be reviewed again.
  JSONArray reviewed=chosen(work);
  ContentValues rename=new ContentValues();rename.put(CalendarContract.Calendars.NAME,"Renamed "+UUID.randomUUID());
  assertEquals(1,resolver.update(sync(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,work),accounts.get(0)),rename,null,null));
  assertThrows(SelectedCalendarReader.SourceChanged.class,()->SelectedCalendarReader.readAvailability(resolver,reviewed,iso(dayStart),iso(dayEnd),zone));
  JSONArray missing=new JSONArray().put(new JSONObject().put("id","987654321").put("revision",reviewed.getJSONObject(0).getString("revision")));
  assertThrows(SelectedCalendarReader.SourceChanged.class,()->SelectedCalendarReader.readAvailability(resolver,missing,iso(dayStart),iso(dayEnd),zone));
  // Malformed selections and windows are refused before any provider read.
  JSONArray current=chosen(work);
  assertThrows(IllegalArgumentException.class,()->SelectedCalendarReader.readAvailability(resolver,new JSONArray(),iso(dayStart),iso(dayEnd),zone));
  assertThrows(IllegalArgumentException.class,()->SelectedCalendarReader.readAvailability(resolver,current,iso(dayStart),iso(dayStart+8*DAY),zone));
  assertThrows(IllegalArgumentException.class,()->SelectedCalendarReader.readAvailability(resolver,current,iso(dayEnd),iso(dayStart),zone));
  assertThrows(IllegalArgumentException.class,()->SelectedCalendarReader.readAvailability(resolver,new JSONArray().put(current.getJSONObject(0)).put(current.getJSONObject(0)),iso(dayStart),iso(dayEnd),zone));
  // More than the reviewed bound fails as a whole instead of returning a partial answer.
  ContentValues[] many=new ContentValues[SelectedCalendarReader.AVAILABILITY_EVENTS+1];
  for(int i=0;i<many.length;i++){ContentValues e=new ContentValues();e.put(CalendarContract.Events.CALENDAR_ID,work);e.put(CalendarContract.Events.TITLE,"SECRET_"+i);e.put(CalendarContract.Events.DTSTART,dayStart+i*60000L);e.put(CalendarContract.Events.DTEND,dayStart+i*60000L+60000L);e.put(CalendarContract.Events.EVENT_TIMEZONE,zone.getId());many[i]=e;}
  assertEquals(many.length,resolver.bulkInsert(CalendarContract.Events.CONTENT_URI,many));
  assertThrows(SelectedCalendarReader.TooMany.class,()->SelectedCalendarReader.readAvailability(resolver,chosen(work),iso(dayStart),iso(dayEnd),zone));
 }

 @Test public void timeZoneMatchesByRulesNotSpelling(){
  assertTrue(CalendarZones.sameZone("Asia/Calcutta",ZoneId.of("Asia/Kolkata")));
  assertTrue(CalendarZones.sameZone("America/New_York",ZoneId.of("America/New_York")));
  assertFalse(CalendarZones.sameZone("Europe/London",ZoneId.of("Asia/Tokyo")));
  assertFalse(CalendarZones.sameZone("Not/AZone",ZoneId.of("UTC")));
  assertFalse(CalendarZones.sameZone(null,ZoneId.of("UTC")));
 }
}
