package ai.alphacompute.alphaphone;

import android.Manifest;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Process;
import android.provider.CalendarContract;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real CalendarProvider rows and journal recovery in an explicitly owned secondary user.
 * Receipt loss is modeled by restoring the durable pre-receipt journal state after a real insert.
 * No system clock, existing account, provider-wide delete, or device setting is changed. */
@RunWith(AndroidJUnit4.class)
public final class CalendarCreationRecoveryInstrumentedTest {
 @Test public void committedMarkerRecoveryAndMissingMarkerNeverReplay()throws Exception {
  org.junit.Assume.assumeTrue("Explicit owned secondary-user Calendar fixture required","1".equals(InstrumentationRegistry.getArguments().getString("calendarCreationRecovery")));
  assertTrue("Never run this provider fixture as user 0",Process.myUid()/100000>0);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals(PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR));
  assertEquals(PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(Manifest.permission.READ_CALENDAR));
  SharedPreferences journal=context.getSharedPreferences("alpha-calendar-creations-v1",Context.MODE_PRIVATE);
  assertEquals("Fresh owned user journal required",0,new JSONObject(journal.getString("operations","{}")).length());
  String name="alpha-calendar-recovery-"+UUID.randomUUID(),id=UUID.randomUUID().toString(),separate=UUID.randomUUID().toString();
  ContentValues calendar=new ContentValues();calendar.put("account_name",name);calendar.put("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL);calendar.put("name",name);calendar.put("calendar_displayName",name);calendar.put("calendar_access_level",CalendarContract.Calendars.CAL_ACCESS_OWNER);calendar.put("ownerAccount",name);calendar.put("calendar_timezone","UTC");calendar.put("visible",1);calendar.put("sync_events",1);
  Uri calendars=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter("account_name",name).appendQueryParameter("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL).build();
  Uri created=context.getContentResolver().insert(calendars,calendar);assertNotNull(created);long calendarId=ContentUris.parseId(created);
  Throwable primary=null;
  try {
   ContentValues values=new ContentValues();values.put("calendar_id",calendarId);values.put("title","Owned recovery event");values.put("description","");values.put("eventLocation","");values.put("dtstart",System.currentTimeMillis()+3600000);values.put("dtend",System.currentTimeMillis()+7200000);values.put("eventTimezone","UTC");
   JSObject first=CalendarCreationStore.create(context,id,values,false);assertEquals("saved",first.getString("status"));String eventId=first.getString("id");assertEquals(1,count(context,calendarId));
   JSONObject all=new JSONObject(journal.getString("operations","{}"));all.getJSONObject(id).put("status","unknown").remove("eventId");assertTrue(journal.edit().putString("operations",all.toString()).commit());
   JSONObject recovered=CalendarCreationStore.pendingCreations(context).getJSONArray("creations").getJSONObject(0);assertEquals("saved",recovered.getString("status"));assertEquals(eventId,recovered.getString("id"));
   assertEquals(eventId,CalendarCreationStore.create(context,id,values,false).getString("id"));assertEquals(1,count(context,calendarId));
   // Multiple exact marker rows cannot produce an authoritative receipt.
   all=new JSONObject(journal.getString("operations","{}"));all.getJSONObject(id).put("status","unknown").remove("eventId");assertTrue(journal.edit().putString("operations",all.toString()).commit());
   ContentValues duplicate=new ContentValues(values);duplicate.put(CalendarContract.Events.CUSTOM_APP_PACKAGE,context.getPackageName());duplicate.put(CalendarContract.Events.CUSTOM_APP_URI,"alphaphone://calendar-creation/"+id);
   Uri duplicateUri=context.getContentResolver().insert(CalendarContract.Events.CONTENT_URI,duplicate);assertNotNull(duplicateUri);
   assertEquals("unknown",CalendarCreationStore.pendingCreations(context).getJSONArray("creations").getJSONObject(0).getString("status"));
   assertEquals("unknown",CalendarCreationStore.create(context,id,values,false).getString("status"));assertEquals(2,count(context,calendarId));
   assertEquals(1,context.getContentResolver().delete(duplicateUri,null,null));
   // Simulate a provider/sync edit stripping identity before recovery can observe it.
   all=new JSONObject(journal.getString("operations","{}"));all.getJSONObject(id).put("status","unknown").remove("eventId");assertTrue(journal.edit().putString("operations",all.toString()).commit());
   ContentValues stripped=new ContentValues();stripped.putNull(CalendarContract.Events.CUSTOM_APP_URI);assertEquals(1,context.getContentResolver().update(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,Long.parseLong(eventId)),stripped,null,null));
   assertEquals("unknown",CalendarCreationStore.pendingCreations(context).getJSONArray("creations").getJSONObject(0).getString("status"));
   assertEquals("unknown",CalendarCreationStore.create(context,id,values,false).getString("status"));assertEquals(1,count(context,calendarId));
   assertEquals("pending-creation",CalendarCreationStore.create(context,separate,values,false).getString("status"));assertEquals(1,count(context,calendarId));
   assertEquals("saved",CalendarCreationStore.create(context,separate,values,true).getString("status"));assertEquals(2,count(context,calendarId));
   assertEquals(2,CalendarCreationStore.pendingCreations(context).getJSONArray("creations").length());
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}
  finally{
   try{
   Uri exact=ContentUris.withAppendedId(calendars,calendarId);
   try(Cursor row=context.getContentResolver().query(exact,new String[]{"account_name","name"},null,null,null)){assertNotNull(row);assertTrue(row.moveToFirst());assertEquals(name,row.getString(0));assertEquals(name,row.getString(1));}
   assertEquals("Delete only the exact fixture calendar",1,context.getContentResolver().delete(exact,null,null));
   JSONObject all=new JSONObject(journal.getString("operations","{}"));all.remove(id);all.remove(separate);assertTrue(journal.edit().putString("operations",all.toString()).commit());
   }catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
  }
 }
 private int count(Context context,long calendarId){try(Cursor rows=context.getContentResolver().query(CalendarContract.Events.CONTENT_URI,new String[]{"_id"},"calendar_id=? AND deleted=0",new String[]{Long.toString(calendarId)},null)){assertNotNull(rows);return rows.getCount();}}
}
