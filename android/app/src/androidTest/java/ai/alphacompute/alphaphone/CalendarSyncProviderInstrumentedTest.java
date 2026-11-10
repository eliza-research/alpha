package ai.alphacompute.alphaphone;

import static org.junit.Assert.*;
import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.OperationApplicationException;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real CalendarProvider on an authorized disposable device/emulator. No Google, network,
 * resident agent or real account. This source is not evidence that it has been installed/run. */
@RunWith(AndroidJUnit4.class)
public final class CalendarSyncProviderInstrumentedTest {
 @Before public void requireDisposableProviderFixture(){
  org.junit.Assume.assumeTrue("Explicit disposable Calendar sync fixture required","1".equals(InstrumentationRegistry.getArguments().getString("calendarSyncProvider")));
  assertTrue("Never mutate CalendarProvider as user 0",android.os.Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})assertEquals(android.content.pm.PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(permission));
 }
 private static final class Fixture implements AutoCloseable {
  final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  final ContentResolver resolver=context.getContentResolver();
  final String account="Alpha sync fixture "+java.util.UUID.randomUUID(),name="owned-sync-fixture",generation=java.util.UUID.randomUUID().toString();
  final long calendar,event,guest,reminder,property;
  Fixture()throws Exception{
   ContentValues source=new ContentValues();source.put("account_name",account);source.put("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL);source.put("name",name);source.put("calendar_displayName",name);source.put("calendar_access_level",CalendarContract.Calendars.CAL_ACCESS_OWNER);source.put("ownerAccount",account);source.put("calendar_timezone","UTC");source.put("visible",1);source.put("sync_events",1);source.put("cal_sync1",generation);
   Uri created=resolver.insert(sync(CalendarContract.Calendars.CONTENT_URI),source);assertNotNull(created);calendar=ContentUris.parseId(created);
   try{
   ContentValues row=new ContentValues();row.put("calendar_id",calendar);row.put("title","Private fixture series");row.put("description","Retain description");row.put("eventLocation","Fixture room");row.put("dtstart",java.time.LocalDate.parse("2035-10-16").atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli());row.put("duration","P1D");row.put("eventTimezone","UTC");row.put("allDay",1);row.put("rrule","FREQ=DAILY");row.put("hasAttendeeData",1);row.put("hasAlarm",1);row.put("availability",1);
   created=resolver.insert(CalendarContract.Events.CONTENT_URI,row);assertNotNull(created);event=ContentUris.parseId(created);
   row=new ContentValues();row.put("event_id",event);row.put("attendeeEmail","fixture@example.invalid");row.put("attendeeName","Retain guest name");row.put("attendeeRelationship",1);row.put("attendeeType",1);row.put("attendeeStatus",1);created=resolver.insert(CalendarContract.Attendees.CONTENT_URI,row);assertNotNull(created);guest=ContentUris.parseId(created);
   row=new ContentValues();row.put("event_id",event);row.put("minutes",15);row.put("method",1);created=resolver.insert(CalendarContract.Reminders.CONTENT_URI,row);assertNotNull(created);reminder=ContentUris.parseId(created);
   row=new ContentValues();row.put("event_id",event);row.put("name","fixture-extra");row.put("value","Retain provider metadata");created=resolver.insert(sync(CalendarContract.ExtendedProperties.CONTENT_URI),row);assertNotNull(created);property=ContentUris.parseId(created);
   }catch(Exception|AssertionError failure){try{close();}catch(Exception cleanup){failure.addSuppressed(cleanup);}throw failure;}
  }
  Uri sync(Uri uri){return uri.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();}
  CalendarSyncSnapshot read()throws Exception{return CalendarSyncSnapshot.read(resolver,calendar,event,account,name,generation);}
  String field(Uri uri,String column){try(Cursor rows=resolver.query(uri,new String[]{column},null,null,null)){assertNotNull(rows);assertTrue(rows.moveToFirst());return rows.getString(0);}}
  @Override public void close(){try(Cursor source=resolver.query(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,calendar),new String[]{"account_name","account_type","name","cal_sync1"},null,null,null)){
   if(source==null||!source.moveToFirst())return;
   if(account.equals(source.getString(0))&&CalendarContract.ACCOUNT_TYPE_LOCAL.equals(source.getString(1))&&name.equals(source.getString(2))&&generation.equals(source.getString(3)))resolver.delete(sync(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,calendar)),null,null);
  }}
 }
 @Test public void exactRichUpdateOutsideTheViewRangePreservesGuestsAlertsAndMetadata()throws Exception{
  try(Fixture fixture=new Fixture()){
   CalendarSyncSnapshot before=fixture.read();JSONObject desired=before.semantic().put("title","Updated fixture series");fixture.resolver.applyBatch(CalendarContract.AUTHORITY,CalendarSyncMutation.plan(before,before.revision,desired));CalendarSyncSnapshot after=fixture.read();assertTrue(CalendarSyncMutation.equivalent(after.semantic(),desired));assertNotEquals(before.revision,after.revision);
   assertEquals("1",fixture.field(ContentUris.withAppendedId(CalendarContract.Attendees.CONTENT_URI,fixture.guest),"attendeeStatus"));assertEquals("Retain guest name",fixture.field(ContentUris.withAppendedId(CalendarContract.Attendees.CONTENT_URI,fixture.guest),"attendeeName"));assertEquals("15",fixture.field(ContentUris.withAppendedId(CalendarContract.Reminders.CONTENT_URI,fixture.reminder),"minutes"));assertEquals("Retain provider metadata",fixture.field(ContentUris.withAppendedId(CalendarContract.ExtendedProperties.CONTENT_URI,fixture.property),"value"));assertEquals("FREQ=DAILY",fixture.field(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,fixture.event),"rrule"));
  }
 }
 @Test public void changedReminderRefusesTheWholeTransaction()throws Exception{
  try(Fixture fixture=new Fixture()){
   CalendarSyncSnapshot before=fixture.read();JSONObject desired=before.semantic().put("title","Must not be applied");ContentValues edited=new ContentValues();edited.put("minutes",30);fixture.resolver.update(ContentUris.withAppendedId(CalendarContract.Reminders.CONTENT_URI,fixture.reminder),edited,null,null);
   try{fixture.resolver.applyBatch(CalendarContract.AUTHORITY,CalendarSyncMutation.plan(before,before.revision,desired));fail("Changed child row must reject CAS");}catch(OperationApplicationException expected){}
   assertEquals("Private fixture series",fixture.field(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,fixture.event),"title"));assertEquals("30",fixture.field(ContentUris.withAppendedId(CalendarContract.Reminders.CONTENT_URI,fixture.reminder),"minutes"));
  }
 }
 @Test public void missingExactEventIsDistinctFromSourceReplacement()throws Exception{
  try(Fixture fixture=new Fixture()){
   fixture.resolver.delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,fixture.event),null,null);CalendarSyncSnapshot missing=fixture.read();assertTrue(missing.missing||missing.deleted);
   ContentValues changed=new ContentValues();changed.put("cal_sync1",java.util.UUID.randomUUID().toString());fixture.resolver.update(fixture.sync(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,fixture.calendar)),changed,null,null);
   try{fixture.read();fail("Replacement generation must refuse");}catch(SecurityException expected){}
   // Restore only this fixture's marker, so guarded cleanup can remove exactly its owned source.
   changed.put("cal_sync1",fixture.generation);fixture.resolver.update(fixture.sync(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,fixture.calendar)),changed,null,null);
  }
 }
}
