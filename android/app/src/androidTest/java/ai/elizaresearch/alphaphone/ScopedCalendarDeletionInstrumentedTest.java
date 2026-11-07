package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.actionjournal.deletion.DeletionDeadline;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Process;
import android.provider.CalendarContract;
import androidx.test.platform.app.InstrumentationRegistry;
import ai.eliza.plugins.calendar.CalendarEventGuard;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Owned CalendarProvider and encrypted journal evidence. Synthetic synced rows do not
 * contact a service. Journal reconstruction is not an installed process-kill test. */
public final class ScopedCalendarDeletionInstrumentedTest {
 @Test public void localRecurrenceUndoAndExpiryPreserveOtherOccurrences()throws Exception{for(int attempt=0;attempt<10;attempt++)try{exercise(false);}catch(AssertionError failure){throw new AssertionError("Local recurrence iteration "+attempt,failure);}}
 @Test public void syntheticSyncedRecurrenceUsesAppDeletionAndExactReadback()throws Exception{exercise(true);}
 private void exercise(boolean synced)throws Exception{
  assertTrue("Explicit disposable Calendar deletion fixture required","1".equals(InstrumentationRegistry.getArguments().getString("scopedCalendarDeletion")));
  assertTrue("Never mutate providers as user 0",Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})assertEquals(PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(permission));
  AlphaCredentialStore encrypted=new AlphaCredentialStore(context);assertNull("Fresh deletion journal required",encrypted.readCredentialSlot(NativeDeletionCoordinator.JOURNAL));
  String name="alpha-delete-fixture-"+UUID.randomUUID(),type=synced?"ai.elizaresearch.synthetic.calendar":CalendarContract.ACCOUNT_TYPE_LOCAL;
  ContentValues calendar=new ContentValues();calendar.put("account_name",name);calendar.put("account_type",type);calendar.put("name",name);calendar.put("calendar_displayName",name);calendar.put("calendar_access_level",CalendarContract.Calendars.CAL_ACCESS_OWNER);calendar.put("ownerAccount",name);calendar.put("calendar_timezone","UTC");calendar.put("visible",1);calendar.put("sync_events",1);
  Uri calendars=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter("account_name",name).appendQueryParameter("account_type",type).build();
  Uri created=resolver.insert(calendars,calendar);assertNotNull(created);long calendarId=ContentUris.parseId(created);
  try{
   long begin=(System.currentTimeMillis()/86400000L+2)*86400000L+12*3600000L,end=begin+3600000L;
   ContentValues event=new ContentValues();event.put("calendar_id",calendarId);event.put("title",name);event.put("description","Owned synthetic recurrence");event.put("eventLocation","Fixture");event.put("dtstart",begin);event.put("duration","PT1H");event.put("eventTimezone","UTC");event.put("rrule","FREQ=DAILY;COUNT=3");
   Uri events=CalendarContract.Events.CONTENT_URI;
   if(synced){event.put("_sync_id",name);events=events.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter("account_name",name).appendQueryParameter("account_type",type).build();}
   Uri inserted=resolver.insert(events,event);assertNotNull(inserted);long eventId=ContentUris.parseId(inserted);assertEquals(3,instances(resolver,calendarId,begin,end+3*86400000L));
   var selected=CalendarEventGuard.selectScopedDeletion(resolver,eventId,calendarId,"occurrence",begin,end);JSONObject target=CalendarScopedDeletionReview.target(selected),owner=new JSONObject().put("kind","manual").put("installationId",name);
   DeferredDeletionJournal.Store store=new DeferredDeletionJournal.Store(){public String read()throws Exception{return encrypted.readCredentialSlot(NativeDeletionCoordinator.JOURNAL);}public void save(String value)throws Exception{encrypted.writeCredentialSlot(NativeDeletionCoordinator.JOURNAL,value);}};
   DeferredDeletionJournal journal=new DeferredDeletionJournal(store);journal.stage("undo",owner,target,new DeletionDeadline("fixture-boot",100,1000));
   DeferredDeletionJournal restored=new DeferredDeletionJournal(store);assertEquals("undone",restored.undo("undo",owner,"fixture-boot",10099).getString("phase"));assertEquals(3,instances(resolver,calendarId,begin,end+3*86400000L));assertEquals(selected.revision,CalendarEventGuard.selectScopedDeletion(resolver,eventId,calendarId,"occurrence",begin,end).revision);
   restored.stage("expire",owner,target,new DeletionDeadline("fixture-boot",20000,20000));
   JSONObject expired=restored.expire("expire","fixture-boot",30000,(who,what)->DeferredDeletionJournal.same(who,owner)?null:"wrong-owner",what->CalendarScopedDeletionReview.dispatch(context,what));assertEquals("Exact readback after expiry: "+selected.deletionVerified(resolver)+"; owned provider: "+providerEvidence(resolver,calendarId,begin,end+3*86400000L),"deleted",expired.getString("phase"));assertEquals("Remaining instances: "+providerEvidence(resolver,calendarId,begin,end+3*86400000L),2,instances(resolver,calendarId,begin,end+3*86400000L));assertTrue(selected.deletionVerified(resolver));
   JSONObject replay=restored.expire("expire","fixture-boot",40000,(who,what)->{throw new AssertionError("Terminal deletion cannot be admitted again");},what->{throw new AssertionError("Terminal deletion cannot dispatch twice");});assertEquals("deleted",replay.getString("phase"));
   var later=CalendarEventGuard.selectScopedDeletion(resolver,eventId,calendarId,"occurrence",begin+86400000L,end+86400000L);JSONObject stale=CalendarScopedDeletionReview.target(later);ContentValues changed=new ContentValues();changed.put("title",name+" changed elsewhere");assertEquals(1,resolver.update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,eventId),changed,null,null));assertEquals("conflict",CalendarScopedDeletionReview.dispatch(context,stale).getString("status"));assertEquals("Remaining instances: "+providerEvidence(resolver,calendarId,begin,end+3*86400000L),2,instances(resolver,calendarId,begin,end+3*86400000L));
   var series=CalendarEventGuard.selectScopedDeletion(resolver,eventId,calendarId,"series",begin+86400000L,end+86400000L);assertEquals("deleted",CalendarScopedDeletionReview.dispatch(context,CalendarScopedDeletionReview.target(series)).getString("status"));assertEquals(0,instances(resolver,calendarId,begin,end+3*86400000L));
   if(synced)try(Cursor row=resolver.query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,eventId),new String[]{"deleted"},null,null,null)){assertNotNull(row);assertTrue("App-mode delete leaves synced tombstone",row.moveToFirst());assertEquals(1,row.getInt(0));}
  }finally{
   // Exact account/calendar identity verified before fixture-only sync-adapter cleanup.
   Uri exact=ContentUris.withAppendedId(calendars,calendarId);try(Cursor row=resolver.query(exact,new String[]{"account_name","name"},null,null,null)){assertNotNull(row);assertTrue(row.moveToFirst());assertEquals(name,row.getString(0));assertEquals(name,row.getString(1));}assertEquals(1,resolver.delete(exact,null,null));
   String actual=encrypted.readCredentialSlot(NativeDeletionCoordinator.JOURNAL);if(actual!=null){JSONObject records=new JSONObject(actual).getJSONObject("records");for(java.util.Iterator<String> keys=records.keys();keys.hasNext();)assertEquals(name,records.getJSONObject(keys.next()).getJSONObject("owner").getString("installationId"));assertTrue("Exact owned journal cleanup",encrypted.compareExchangeCredentialSlot(NativeDeletionCoordinator.JOURNAL,actual,null));}
  }
 }
 private static String providerEvidence(ContentResolver resolver,long calendar,long begin,long end){try(Cursor rows=resolver.query(CalendarContract.Events.CONTENT_URI,new String[]{"_id","original_id","original_sync_id","originalInstanceTime","eventStatus","deleted","dtstart","dtend","duration","eventTimezone","allDay","rrule","exdate","lastDate"},"calendar_id=?",new String[]{Long.toString(calendar)},"_id ASC")){return "instances="+instances(resolver,calendar,begin,end)+" "+instanceEvidence(resolver,calendar,begin,end)+" "+(rows==null?"null":android.database.DatabaseUtils.dumpCursorToString(rows));}}
 private static String instanceEvidence(ContentResolver resolver,long calendar,long begin,long end){Uri.Builder range=CalendarContract.Instances.CONTENT_URI.buildUpon();ContentUris.appendId(range,begin);ContentUris.appendId(range,end);try(Cursor rows=resolver.query(range.build(),new String[]{"event_id","begin","end","eventStatus"},"calendar_id=?",new String[]{Long.toString(calendar)},null)){return rows==null?"null instances":android.database.DatabaseUtils.dumpCursorToString(rows);}}
 private static int instances(ContentResolver resolver,long calendar,long begin,long end){Uri.Builder range=CalendarContract.Instances.CONTENT_URI.buildUpon();ContentUris.appendId(range,begin);ContentUris.appendId(range,end);try(Cursor rows=resolver.query(range.build(),new String[]{"event_id"},"calendar_id=?",new String[]{Long.toString(calendar)},null)){assertNotNull(rows);return rows.getCount();}}
}
