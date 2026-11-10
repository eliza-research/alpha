package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.ContentResolver;
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
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Two-process, baseline-to-candidate witness. Never run outside an owned fresh secondary user. */
@RunWith(AndroidJUnit4.class)
public final class CalendarUpgradeInstrumentedTest {
 private static final String OLD="ai.elizaresearch.alphaphone.", NEW="ai.eliza.plugins.calendar.";
 private static final String ACCOUNT="Alpha Phone", NAME="alpha-phone-local", JOURNAL="alpha-calendar-creations-v1";
 private static final String WITNESS="calendar-extraction-upgrade-witness-v1";
 private static final String PREFIX="alphaphone://calendar-creation/";
 private Context context;
 private SharedPreferences witness(){return context.getSharedPreferences(WITNESS,Context.MODE_PRIVATE);}
 private SharedPreferences journal(){return context.getSharedPreferences(JOURNAL,Context.MODE_PRIVATE);}
 private Class<?> type(String name)throws Exception{return Class.forName(name,true,context.getClassLoader());}
 private void absent(String name)throws Exception {try{type(name);fail("Unexpected implementation in target classloader: "+name);}catch(ClassNotFoundException expected){}}
 private Object call(Class<?> owner,Object receiver,String name,Class<?>[] parameters,Object... arguments)throws Exception {
  Method method=owner.getDeclaredMethod(name,parameters);method.setAccessible(true);return method.invoke(receiver,arguments);
 }
 private String field(Object object,String name)throws Exception {Field value=object.getClass().getDeclaredField(name);value.setAccessible(true);return String.valueOf(value.get(object));}
 private JSONObject json(Object value)throws Exception{return new JSONObject(value.toString());}
 private Object store(boolean candidate)throws Exception {
  if(!candidate)return null;
  Class<?> config=type(NEW+"CalendarConfiguration");
  Object value=config.getConstructor(String.class,String.class,String.class,String.class,String.class,int.class).newInstance(ACCOUNT,NAME,"On this phone",JOURNAL,PREFIX,0xff0000ff);
  return type(NEW+"CalendarCreationStore").getConstructor(config).newInstance(value);
 }
 private JSONObject revisions(boolean candidate,long calendar,long event)throws Exception {
  Class<?> guard=type((candidate?NEW:OLD)+"CalendarEventGuard");
  Object snapshot=call(guard,null,"read",new Class<?>[]{ContentResolver.class,long.class,long.class},context.getContentResolver(),event,calendar);
  assertNotNull("Fixture event snapshot",snapshot);
  String source=(String)call(guard,null,"sourceRevision",new Class<?>[]{ContentResolver.class,long.class,String.class,String.class},context.getContentResolver(),calendar,ACCOUNT,NAME);
  assertEquals(source,field(snapshot,"sourceRevision"));assertEquals(Long.toString(event),field(snapshot,"id"));assertEquals(Long.toString(calendar),field(snapshot,"calendarId"));
  return new JSONObject().put("source",source).put("event",field(snapshot,"revision"));
 }
 private ContentValues values(JSONObject evidence)throws Exception {
  ContentValues values=new ContentValues();values.put("calendar_id",evidence.getLong("calendarId"));values.put("title",evidence.getString("title"));values.put("description","Synthetic upgrade witness");values.put("eventLocation","Fixture");values.put("dtstart",evidence.getLong("begin"));values.put("dtend",evidence.getLong("end"));values.put("eventTimezone","UTC");return values;
 }
 private Uri calendarUri(long id){return ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,id).buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter("account_name",ACCOUNT).appendQueryParameter("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL).build();}
 private void assertCalendar(long id){try(Cursor rows=context.getContentResolver().query(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,id),new String[]{"account_name","account_type","name"},null,null,null)){assertNotNull(rows);assertTrue(rows.moveToFirst());assertEquals(ACCOUNT,rows.getString(0));assertEquals(CalendarContract.ACCOUNT_TYPE_LOCAL,rows.getString(1));assertEquals(NAME,rows.getString(2));assertFalse(rows.moveToNext());}}
 private void assertOne(JSONObject evidence)throws Exception {
  try(Cursor rows=context.getContentResolver().query(CalendarContract.Events.CONTENT_URI,new String[]{CalendarContract.Events._ID,CalendarContract.Events.CUSTOM_APP_PACKAGE,CalendarContract.Events.CUSTOM_APP_URI,CalendarContract.Events.TITLE},"calendar_id=? AND deleted=0",new String[]{Long.toString(evidence.getLong("calendarId"))},null)){
   assertNotNull(rows);assertEquals(1,rows.getCount());assertTrue(rows.moveToFirst());assertEquals(evidence.getLong("eventId"),rows.getLong(0));assertEquals(context.getPackageName(),rows.getString(1));assertEquals(PREFIX+evidence.getString("creationId"),rows.getString(2));assertEquals(evidence.getString("title"),rows.getString(3));
  }
 }
 private void saveWitness(JSONObject value){assertTrue("Durable fixture witness",witness().edit().putString("fixture",value.toString()).commit());}
 @Test public void baselineToCandidatePreservesCalendarIdentity()throws Exception {
  String phase=InstrumentationRegistry.getArguments().getString("calendarUpgradePhase");org.junit.Assume.assumeTrue("Explicit Calendar upgrade campaign required",phase!=null);assertTrue("Explicit seed or verify required","seed".equals(phase)||"verify".equals(phase));
  assertTrue("Never operate in owner user",Process.myUid()/100000>0);
  context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertEquals(PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(Manifest.permission.READ_CALENDAR));assertEquals(PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(Manifest.permission.WRITE_CALENDAR));
  if("seed".equals(phase))seed();else verify();
 }
 private void seed()throws Exception {
  type(OLD+"CalendarCreationStore");type(OLD+"CalendarEventGuard");absent(NEW+"CalendarCreationStore");absent(NEW+"CalendarEventGuard");
  assertFalse("Fresh fixture witness required",witness().contains("fixture"));assertEquals(0,new JSONObject(journal().getString("operations","{}")).length());
  try(Cursor rows=context.getContentResolver().query(CalendarContract.Calendars.CONTENT_URI,new String[]{"_id"},"account_name=? AND account_type=? AND name=?",new String[]{ACCOUNT,CalendarContract.ACCOUNT_TYPE_LOCAL,NAME},null)){assertNotNull(rows);assertEquals("Fresh local Alpha calendar required",0,rows.getCount());}
  String creationId=UUID.randomUUID().toString();
  ContentValues calendar=new ContentValues();calendar.put("account_name",ACCOUNT);calendar.put("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL);calendar.put("name",NAME);calendar.put("calendar_displayName","On this phone");calendar.put("calendar_color",0xff0000ff);calendar.put("calendar_access_level",CalendarContract.Calendars.CAL_ACCESS_OWNER);calendar.put("ownerAccount",ACCOUNT);calendar.put("calendar_timezone","UTC");calendar.put("visible",1);calendar.put("sync_events",1);
  Uri target=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter("account_name",ACCOUNT).appendQueryParameter("account_type",CalendarContract.ACCOUNT_TYPE_LOCAL).build();
  Uri inserted=context.getContentResolver().insert(target,calendar);assertNotNull(inserted);long calendarId=ContentUris.parseId(inserted);assertTrue(calendarId>0);
  long begin=System.currentTimeMillis()+3600000;
  JSONObject evidence=new JSONObject().put("package",context.getPackageName()).put("uid",Process.myUid()).put("calendarId",calendarId).put("creationId",creationId).put("title","Calendar upgrade "+creationId).put("begin",begin).put("end",begin+3600000).put("phase","allocated");saveWitness(evidence);
  JSONObject saved=json(call(type(OLD+"CalendarCreationStore"),null,"create",new Class<?>[]{Context.class,String.class,ContentValues.class,boolean.class},context,creationId,values(evidence),false));assertEquals("saved",saved.getString("status"));assertEquals(Long.toString(calendarId),saved.getString("calendarId"));evidence.put("eventId",Long.parseLong(saved.getString("id")));assertOne(evidence);evidence.put("revisions",revisions(false,calendarId,evidence.getLong("eventId")));saveWitness(evidence);
  JSONObject operations=new JSONObject(journal().getString("operations","{}"));assertEquals(1,operations.length());JSONObject record=operations.getJSONObject(creationId);assertFalse(record.getBoolean("acknowledged"));record.put("status","unknown");record.remove("eventId");assertTrue(journal().edit().putString("operations",operations.toString()).commit());
  evidence.put("unknownRecord",new JSONObject(record.toString())).put("phase","seeded");saveWitness(evidence);
 }
 private void verify()throws Exception {
  // Compatibility adapters may remain; qualify the shared implementation and durable data.
  type(NEW+"CalendarCreationStore");type(NEW+"CalendarEventGuard");assertEquals(NEW+"CalendarPlugin",type(OLD+"AlphaCalendarPlugin").getSuperclass().getName());
  JSONObject evidence=new JSONObject(witness().getString("fixture","{}"));assertEquals("seeded",evidence.getString("phase"));assertEquals(context.getPackageName(),evidence.getString("package"));assertEquals(Process.myUid(),evidence.getInt("uid"));
  long calendar=evidence.getLong("calendarId"),event=evidence.getLong("eventId");String id=evidence.getString("creationId");assertCalendar(calendar);assertOne(evidence);
  JSONObject before=new JSONObject(journal().getString("operations","{}"));assertEquals(1,before.length());assertEquals("unknown",before.getJSONObject(id).getString("status"));assertFalse(before.getJSONObject(id).has("eventId"));assertEquals(evidence.getJSONObject("unknownRecord").getString("argumentHash"),before.getJSONObject(id).getString("argumentHash"));
  JSONObject actual=revisions(true,calendar,event),expected=evidence.getJSONObject("revisions");assertEquals(expected.getString("source"),actual.getString("source"));assertEquals(expected.getString("event"),actual.getString("event"));
  Class<?> owner=type(NEW+"CalendarCreationStore");Object store=store(true);
  JSONObject pending=json(call(owner,store,"pendingCreations",new Class<?>[]{Context.class},context));assertEquals("ready",pending.getString("status"));assertEquals(1,pending.getJSONArray("creations").length());JSONObject recovered=pending.getJSONArray("creations").getJSONObject(0);assertEquals(id,recovered.getString("creationId"));assertEquals("saved",recovered.getString("status"));assertEquals(Long.toString(event),recovered.getString("id"));assertEquals(Long.toString(calendar),recovered.getString("calendarId"));assertOne(evidence);
  JSONObject replay=json(call(owner,store,"create",new Class<?>[]{Context.class,String.class,ContentValues.class,boolean.class},context,id,values(evidence),false));assertEquals("saved",replay.getString("status"));assertEquals(Long.toString(event),replay.getString("id"));assertOne(evidence);
  call(owner,store,"acknowledge",new Class<?>[]{Context.class,String.class},context,id);assertEquals(0,json(call(owner,store,"pendingCreations",new Class<?>[]{Context.class},context)).getJSONArray("creations").length());assertTrue(new JSONObject(journal().getString("operations","{}")).getJSONObject(id).getBoolean("acknowledged"));
  // Cleanup only after all evidence passes. Failures retain their witness for diagnosis;
  // the owning runner must remove its exact disposable secondary user in finally.
  assertCalendar(calendar);assertOne(evidence);assertEquals(1,context.getContentResolver().delete(calendarUri(calendar),null,null));
  JSONObject operations=new JSONObject(journal().getString("operations","{}"));assertEquals(1,operations.length());operations.remove(id);assertTrue(journal().edit().putString("operations",operations.toString()).commit());assertTrue(witness().edit().remove("fixture").commit());
 }
}
