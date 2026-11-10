package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.*;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.CalendarContract;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;

/** Real CalendarProvider and encrypted journal. External runner restores permissions. */
public final class WorkflowPhoneNativeInstrumentedTest {
 private static void enabled(){org.junit.Assume.assumeTrue("Explicit native workflow scope campaign","1".equals(InstrumentationRegistry.getArguments().getString("workflowPhoneNative")));}
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void ready(String expression)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Native workflow fixture state missing");}
 private JSONObject call(String expression)throws Exception{ready("window.Capacitor?.Plugins?.AlphaActionJournal");js("window.__workflowNative=null;Promise.resolve().then(()=>"+expression+").then(v=>window.__workflowNative=JSON.stringify(v||{}),()=>window.__workflowNative=JSON.stringify({error:true}))");ready("window.__workflowNative!==null");return new JSONObject((String)new JSONTokener(js("window.__workflowNative")).nextValue());}
 private static String sha(String value)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
 @Test public void privateReadResultSurvivesRecreationButNeverExpandsPassiveHistory()throws Exception{
  enabled();String scope=sha(UUID.randomUUID().toString()),proposal=UUID.randomUUID().toString(),operation=UUID.randomUUID().toString(),noteId=UUID.randomUUID().toString(),sentinel="private-workflow-read-"+UUID.randomUUID(),content=sentinel+String.join("",Collections.nCopies(19000,"界"));
  String entrySlot="action-journal:v1:"+scope+":entry:"+proposal,indexSlot="action-journal:v1:"+scope+":index";File folder=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials");Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   try{
    JSONObject binding=new JSONObject().put("scope",scope).put("proposalId",proposal);JSONObject record=new JSONObject().put("workflow",new JSONObject().put("runId",UUID.randomUUID().toString())).put("operation",new JSONObject().put("type","read_selected_notes"));
    JSONObject reserve=new JSONObject(binding.toString()).put("operationId",operation).put("operationHash",sha("owned-read")).put("record",record);
    assertTrue(call("Capacitor.Plugins.AlphaActionJournal.reserve("+reserve+")").getBoolean("created"));assertFalse(call("Capacitor.Plugins.AlphaActionJournal.markApplying("+new JSONObject(binding.toString()).put("attemptId",UUID.randomUUID().toString())+")").has("error"));
    JSONObject read=new JSONObject().put("kind","notes").put("notes",new JSONArray().put(new JSONObject().put("id",noteId).put("revision",sha(content)).put("title","Synthetic selected note").put("text",content)));
    JSONObject finish=new JSONObject(binding.toString()).put("status","succeeded").put("summary","One explicitly selected note read").put("result",new JSONObject().put("operationId",operation).put("readResult",read));
    JSONObject tooLarge=new JSONObject(finish.toString());tooLarge.getJSONObject("result").getJSONObject("readResult").getJSONArray("notes").getJSONObject(0).put("text",String.join("",Collections.nCopies(22000,"界")));assertTrue("Byte limit rejects multibyte content below character limit",call("Capacitor.Plugins.AlphaActionJournal.finish("+tooLarge+")").has("error"));
    assertFalse(call("Capacitor.Plugins.AlphaActionJournal.finish("+finish+")").has("error"));assertFalse("Exact terminal retry accepted",call("Capacitor.Plugins.AlphaActionJournal.finish("+finish+")").has("error"));
    byte[] stored=Files.readAllBytes(new File(folder,sha(entrySlot)).toPath());assertFalse(new String(stored,StandardCharsets.ISO_8859_1).contains(sentinel));
    JSONObject history=call("Capacitor.Plugins.AlphaActionJournal.list("+new JSONObject().put("scope",scope)+")");assertFalse(history.toString().contains(sentinel));assertTrue(history.getJSONArray("entries").getJSONObject(0).getJSONObject("result").getBoolean("readResultRetained"));
    scenario.recreate();JSONObject retained=call("Capacitor.Plugins.AlphaActionJournal.get("+binding+")").getJSONObject("entry");assertEquals(content,retained.getJSONObject("result").getJSONObject("readResult").getJSONArray("notes").getJSONObject(0).getString("text"));assertEquals(operation,retained.getString("operationId"));
    assertTrue("Recovered entry cannot execute again",call("Capacitor.Plugins.AlphaActionJournal.markApplying("+new JSONObject(binding.toString()).put("attemptId",UUID.randomUUID().toString())+")").has("error"));
    finish.getJSONObject("result").getJSONObject("readResult").getJSONArray("notes").getJSONObject(0).put("text","changed");assertTrue(call("Capacitor.Plugins.AlphaActionJournal.finish("+finish+")").has("error"));
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{try{
    // Journal slots are native-only (RendererCredentialSlots): the page's secure-storage bridge must
    // refuse to remove them, so the fixture is removed through the native store the journal uses.
    AlphaCredentialStore nativeStore=new AlphaCredentialStore(InstrumentationRegistry.getInstrumentation().getTargetContext());
    for(String slot:new String[]{entrySlot,indexSlot}){assertTrue("The page cannot remove a native journal slot",call("Capacitor.Plugins.AlphaConnection.secureRemove({slot:"+JSONObject.quote(slot)+"})").has("error"));nativeStore.removeCredentialSlot(slot);for(String suffix:new String[]{"",".bak",".new"})assertFalse(new File(folder,sha(slot)+suffix).exists());}}catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}}
  }
 }
 @Test public void deniedCalendarGrantReturnsNoEvents()throws Exception{
  org.junit.Assume.assumeTrue("External denied permission runner","1".equals(InstrumentationRegistry.getArguments().getString("workflowPhoneDenied")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals(android.content.pm.PackageManager.PERMISSION_DENIED,context.checkSelfPermission(Manifest.permission.READ_CALENDAR));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   JSONObject value=call("Capacitor.Plugins.AlphaCalendar.readWorkflowRange({calendarIds:['1'],start:'2026-10-01T00:00:00.000Z',end:'2026-10-02T00:00:00.000Z',maximumEvents:1})");assertEquals("permission-required",value.getString("status"));assertFalse(value.has("events"));
  }
 }
 private static Uri calendar(ContentResolver resolver,String account)throws Exception{ContentValues c=new ContentValues();c.put(CalendarContract.Calendars.ACCOUNT_NAME,account);c.put(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL);c.put(CalendarContract.Calendars.NAME,account);c.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,account);c.put(CalendarContract.Calendars.OWNER_ACCOUNT,account);c.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,CalendarContract.Calendars.CAL_ACCESS_OWNER);c.put(CalendarContract.Calendars.CALENDAR_TIME_ZONE,"UTC");c.put(CalendarContract.Calendars.VISIBLE,1);c.put(CalendarContract.Calendars.SYNC_EVENTS,1);Uri uri=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();Uri created=resolver.insert(uri,c);assertNotNull(created);return created;}
 private static Uri event(ContentResolver resolver,Uri calendar,String title,long start,long end){ContentValues value=new ContentValues();value.put(CalendarContract.Events.CALENDAR_ID,ContentUris.parseId(calendar));value.put(CalendarContract.Events.TITLE,title);value.put(CalendarContract.Events.DESCRIPTION,"Private description must not leave the provider");value.put(CalendarContract.Events.EVENT_LOCATION,"Private location must not leave the provider");value.put(CalendarContract.Events.DTSTART,start);value.put(CalendarContract.Events.DTEND,end);value.put(CalendarContract.Events.EVENT_TIMEZONE,"UTC");Uri uri=resolver.insert(CalendarContract.Events.CONTENT_URI,value);assertNotNull(uri);return uri;}
 @Test public void selectedCalendarQueryExcludesOtherAccountsAndRefusesOverflow()throws Exception{
  enabled();Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})assertEquals("Runner must preserve and grant fixture permissions",android.content.pm.PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(permission));ContentResolver resolver=context.getContentResolver();String account="Alpha workflow fixture "+UUID.randomUUID(),otherAccount=account+" other";Uri selected=null,other=null;Throwable primary=null;
  try{selected=calendar(resolver,account);other=calendar(resolver,otherAccount);long begin=Instant.parse("2026-10-01T00:00:00Z").toEpochMilli(),end=begin+86400000L;Uri one=event(resolver,selected,"Selected one",begin+3600000,begin+7200000);event(resolver,selected,"Selected two",begin+10800000,begin+14400000);event(resolver,selected,"Ends at exclusive beginning",begin-3600000,begin);event(resolver,selected,"Starts at exclusive end",end,end+3600000);event(resolver,other,"UNSELECTED SECRET TITLE",begin+3600000,begin+7200000);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();js(AppNavigation.request("Workflows"));ready(AppNavigation.selected("Workflows"));ready("window.__alphaTestNavigation?.status==='complete'");JSONObject args=new JSONObject().put("calendarIds",new JSONArray().put(Long.toString(ContentUris.parseId(selected)))).put("start","2026-10-01T00:00:00.000Z").put("end","2026-10-02T00:00:00.000Z").put("maximumEvents",2);
    JSONObject read=call("Capacitor.Plugins.AlphaCalendar.readWorkflowRange("+args+")");assertEquals("ready",read.getString("status"));assertEquals(2,read.getJSONArray("events").length());assertFalse(read.toString().contains("UNSELECTED"));assertFalse(read.toString().contains("Private description"));assertFalse(read.toString().contains("Private location"));JSONObject first=read.getJSONArray("events").getJSONObject(0);assertEquals("Selected one",first.getString("title"));assertEquals(6,first.length());String original=first.toString();
    ContentValues changed=new ContentValues();changed.put(CalendarContract.Events.TITLE,"Changed selected one");assertEquals(1,resolver.update(one,changed,null,null));JSONObject reread=call("Capacitor.Plugins.AlphaCalendar.readWorkflowRange("+args+")");assertNotEquals("Provider revision input changes with actual title",original,reread.getJSONArray("events").getJSONObject(0).toString());
    args.put("maximumEvents",1);assertTrue("Never silently truncate",call("Capacitor.Plugins.AlphaCalendar.readWorkflowRange("+args+")").has("error"));args.put("maximumEvents",2).put("end","2026-10-09T00:00:00.000Z");assertTrue(call("Capacitor.Plugins.AlphaCalendar.readWorkflowRange("+args+")").has("error"));args.put("end","2026-10-02T00:00:00.000Z").put("calendarIds",new JSONArray().put(Long.toString(ContentUris.parseId(selected))).put(Long.toString(ContentUris.parseId(selected))));assertTrue(call("Capacitor.Plugins.AlphaCalendar.readWorkflowRange("+args+")").has("error"));
   }
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{try{for(int i=0;i<2;i++){Uri row=i==0?selected:other;if(row!=null){String owner=i==0?account:otherAccount;Uri cleanup=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,owner).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();assertEquals(1,resolver.delete(cleanup,CalendarContract.Calendars._ID+"=? AND "+CalendarContract.Calendars.ACCOUNT_NAME+"=? AND "+CalendarContract.Calendars.ACCOUNT_TYPE+"=?",new String[]{Long.toString(ContentUris.parseId(row)),owner,CalendarContract.ACCOUNT_TYPE_LOCAL}));}}}catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}}
 }
 /** Real CalendarProvider: one reviewed source serves morning and evening reads with distinct occurrences and windows. */
 @Test public void morningAndEveningShareOneCalendarSourceWithDistinctWindows()throws Exception{
  enabled();Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})assertEquals("Runner must preserve and grant fixture permissions",android.content.pm.PackageManager.PERMISSION_GRANTED,context.checkSelfPermission(permission));
  ContentResolver resolver=context.getContentResolver();String account="Alpha digest fixture "+UUID.randomUUID();Uri selected=null;Throwable primary=null;
  try{selected=calendar(resolver,account);long day=Instant.parse("2026-10-01T00:00:00Z").toEpochMilli();event(resolver,selected,"Shared calendar meeting",day+9*3600000L,day+10*3600000L);
   String id=Long.toString(ContentUris.parseId(selected)),revision=null;
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();js(AppNavigation.request("Workflows"));ready(AppNavigation.selected("Workflows"));ready("window.__alphaTestNavigation?.status==='complete'");
    JSONArray calendars=call("Capacitor.Plugins.AlphaCalendar.workflowCalendars()").getJSONArray("calendars");for(int i=0;i<calendars.length();i++)if(id.equals(calendars.getJSONObject(i).getString("id")))revision=calendars.getJSONObject(i).getString("sourceRevision");
   }
   assertNotNull("Fixture calendar revision",revision);
   Map<String,String> slots=new HashMap<>();NativeDigestSources sources=new NativeDigestSources(new NativeDigestSources.Storage(){public String read(String key){return slots.get(key);}public void write(String key,String value){slots.put(key,value);}},new Object());
   JSONObject binding=new JSONObject().put("ownerId","owner").put("agentId","agent").put("installationId","installation").put("enrollmentId","enrollment");
   JSONObject scope=new JSONObject().put("calendars",new JSONArray().put(new JSONObject().put("id",id).put("revision",revision))).put("reminders",true).put("timeZone","UTC").put("window","owner_day_and_overdue_reminders").put("maximumItems",20).put("modelEgress",true);
   long now=System.currentTimeMillis();assertThrows(SecurityException.class,()->sources.approve(binding,"too-long",scope,now+7*86400000L+1,now,()->{}));
   JSONObject grant=sources.approve(binding,"shared",scope,now+7*86400000L,now,()->{});String grantRevision=grant.getString("revision");
   long morningAt=day+8*3600000L,eveningAt=day+18*3600000L;
   NativeDigestSources.Reader reader=new NativeDigestSources.Reader(){
    public JSONArray calendar(JSONArray ids,String start,String end,int maximum,String startDate,String endDateExclusive)throws Exception{return ai.eliza.plugins.calendar.read.SelectedCalendarReader.readOwnerDay(resolver,ids,start,end,maximum,startDate,endDateExclusive);}
    // Synthetic reminder rows in the engine's list() shape, including an upgraded one-off legacy alarm.
    public JSONArray reminders()throws Exception{return new JSONArray().put(new JSONObject().put("id","legacy").put("title","Upgraded alarm").put("at",day+7*3600000L).put("dueAt",day+7*3600000L).put("legacyAlarm",true).put("status","posted")).put(new JSONObject().put("id","done").put("title","Done today").put("at",day+11*3600000L).put("dueAt",day+11*3600000L).put("status","completed").put("completedAt",day+12*3600000L));}
   };
   JSONObject morning=sources.read(binding,"shared",grantRevision,morningAt,now,"morning",reader,()->{}),evening=sources.read(binding,"shared",grantRevision,eveningAt,now,"evening",reader,()->{});
   assertNotEquals(morning.getString("occurrence"),evening.getString("occurrence"));assertFalse(morning.has("template"));assertEquals("evening",evening.getString("template"));
   assertEquals(1,morning.getJSONArray("events").length());assertEquals(morning.getJSONArray("events").toString(),evening.getJSONArray("events").toString());assertEquals("Shared calendar meeting",evening.getJSONArray("events").getJSONObject(0).getString("title"));assertFalse(evening.toString().contains("Private description"));
   assertEquals(1,morning.getJSONArray("reminders").length());assertEquals("legacy",morning.getJSONArray("reminders").getJSONObject(0).getString("id"));
   assertEquals(2,evening.getJSONArray("reminders").length());assertEquals("completed",evening.getJSONArray("reminders").getJSONObject(1).getString("status"));
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{try{if(selected!=null){Uri cleanup=CalendarContract.Calendars.CONTENT_URI.buildUpon().appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER,"true").appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME,account).appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE,CalendarContract.ACCOUNT_TYPE_LOCAL).build();assertEquals(1,resolver.delete(cleanup,CalendarContract.Calendars._ID+"=? AND "+CalendarContract.Calendars.ACCOUNT_NAME+"=? AND "+CalendarContract.Calendars.ACCOUNT_TYPE+"=?",new String[]{Long.toString(ContentUris.parseId(selected)),account,CalendarContract.ACCOUNT_TYPE_LOCAL}));}}catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}}
 }
}
