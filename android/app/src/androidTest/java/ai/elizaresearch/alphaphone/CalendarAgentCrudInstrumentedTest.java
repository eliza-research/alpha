package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.os.SystemClock;
import android.provider.CalendarContract;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real exported native operation boundary. Server queue exercised separately over real SQL/HTTP. */
@RunWith(AndroidJUnit4.class)
public class CalendarAgentCrudInstrumentedTest {
 private String eval(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void until(String condition)throws Exception{for(int i=0;i<150;i++){if("true".equals(eval("Boolean("+condition+")")))return;SystemClock.sleep(100);}fail("Missing Calendar native fixture condition");}
 private void nativeClick(String label)throws Exception{for(int i=0;i<120;i++){String early=eval("window.__calendarAgentResult ? JSON.stringify({status:window.__calendarAgentResult.status,error:window.__calendarAgentResult.error}) : null");if(!"null".equals(early))fail("Calendar operation settled before review control "+label+": "+early);AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root!=null){java.util.ArrayDeque<AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();queue.add(root);while(!queue.isEmpty()){AccessibilityNodeInfo node=queue.removeFirst();if(node.getText()!=null&&label.equalsIgnoreCase(node.getText().toString())&&node.isVisibleToUser()&&node.isClickable()&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;for(int child=0;child<node.getChildCount();child++){AccessibilityNodeInfo value=node.getChild(child);if(value!=null)queue.add(value);}}}SystemClock.sleep(100);}fail("Native Calendar control missing: "+label);}
 private JSONObject result()throws Exception{until("window.__calendarAgentResult");JSONObject value=new JSONObject(eval("window.__calendarAgentResult"));assertFalse(value.has("error"));if("applied".equals(value.optString("status"))||"cancelled".equals(value.optString("status")))assertReviewReleased();return value;}
 private void assertReviewReleased()throws Exception{WebViewTestDriver.withActivity(MainActivity.class,activity->{try{AlphaCalendarPlugin plugin=(AlphaCalendarPlugin)activity.getBridge().getPlugin("AlphaCalendar").getInstance();java.lang.reflect.Field busy=ai.eliza.plugins.calendar.CalendarPlugin.class.getDeclaredField("deleting"),dialog=ai.eliza.plugins.calendar.CalendarPlugin.class.getDeclaredField("deleteDialog");busy.setAccessible(true);dialog.setAccessible(true);assertFalse("Terminal receipt must release native review gate",((java.util.concurrent.atomic.AtomicBoolean)busy.get(plugin)).get());assertNull("Terminal receipt must follow dialog dismissal",dialog.get(plugin));}catch(ReflectiveOperationException error){throw new AssertionError(error);}});}
 // A dialog receipt confirms dismissal, but the Activity can regain focus a frame later.
 // Wait before a new reviewed request; never retry an operation that already settled.
 private void awaitReviewForeground()throws Exception{
  long deadline=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<deadline){
   boolean[] ready={false};
   WebViewTestDriver.withActivity(MainActivity.class,activity->{ready[0]=!activity.isFinishing()&&!activity.isDestroyed()&&activity.hasWindowFocus();});
   if(ready[0])return;
   SystemClock.sleep(100);
  }
  fail("Alpha Activity did not regain foreground focus before Calendar review");
 }
 private void begin(JSONObject operation)throws Exception{awaitReviewForeground();eval("window.__calendarAgentResult=null;Capacitor.Plugins.AlphaCalendar.executeAgent({operation:"+operation+",operationId:"+JSONObject.quote(java.util.UUID.randomUUID().toString())+"}).then(value=>window.__calendarAgentResult=value,error=>window.__calendarAgentResult={error:String(error)})");}
 private JSONObject perform(JSONObject operation,String button)throws Exception{begin(operation);nativeClick(button);return result();}
 /** Upstream review wording (elizaOS/eliza#35913): the review names the calendar and its account and,
  * for a change, says no attendee is involved. Checked on screen before the button is pressed. */
 static final String[] CHANGE_REVIEW={"Calendar: On this phone","Account: Alpha Phone (this phone only)","No attendees are invited, changed or notified."};
 private void reviewShows(String... texts)throws Exception{
  for(int i=0;i<120;i++){
   AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();StringBuilder seen=new StringBuilder();
   if(root!=null){java.util.ArrayDeque<AccessibilityNodeInfo> queue=new java.util.ArrayDeque<>();queue.add(root);while(!queue.isEmpty()){AccessibilityNodeInfo node=queue.removeFirst();if(node.isVisibleToUser()&&node.getText()!=null)seen.append(node.getText()).append('\n');for(int c=0;c<node.getChildCount();c++){AccessibilityNodeInfo child=node.getChild(c);if(child!=null)queue.add(child);}}}
   boolean all=true;for(String text:texts)all&=seen.indexOf(text)>=0;if(all)return;SystemClock.sleep(100);
  }
  fail("Calendar review does not show "+java.util.Arrays.toString(texts));
 }
 private JSONObject performReviewed(JSONObject operation,String button,String... texts)throws Exception{begin(operation);reviewShows(texts);nativeClick(button);return result();}
 private boolean exists(Context context,long id){try(Cursor row=context.getContentResolver().query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),new String[]{CalendarContract.Events.DELETED},null,null,null)){return row!=null&&row.moveToFirst()&&row.getInt(0)==0;}}
 @Test public void reviewedNativeCreateReadUpdateDeleteAndStaleRevision()throws Exception{
  org.junit.Assume.assumeTrue("Explicit synthetic agent Calendar gate", "1".equals(InstrumentationRegistry.getArguments().getString("calendarAgent")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
  long id=0;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();until("document.documentElement.dataset.activeView");eval(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));AppNavigation.declineStartupAccess();
   eval("window.__calendarAgentResult=null;Capacitor.Plugins.AlphaCalendar.prepareAgentSource().then(value=>window.__calendarAgentResult=value)");JSONObject prepared=result();assertEquals("ready",prepared.getString("status"));JSONObject source=new JSONObject().put("sourceId",prepared.getString("sourceId")).put("sourceRevision",prepared.getString("sourceRevision"));
   long begin=System.currentTimeMillis()+3600000;java.time.format.DateTimeFormatter format=new java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter();JSONObject fields=new JSONObject().put("title","Agent Calendar "+java.util.UUID.randomUUID()).put("description","Synthetic approved body").put("location","Fixture").put("start",format.format(java.time.Instant.ofEpochMilli(begin))).put("end",format.format(java.time.Instant.ofEpochMilli(begin+3600000))).put("timeZone","UTC");
   JSONObject created=performReviewed(new JSONObject().put("type","calendar_create").put("source",source).put("fields",fields),"Create event",CHANGE_REVIEW);assertEquals("applied",created.getString("status"));JSONObject receipt=created.getJSONObject("result");id=Long.parseLong(receipt.getString("eventId"));assertTrue(exists(context,id));
   JSONObject target=new JSONObject(source.toString()).put("eventId",Long.toString(id)).put("revision",receipt.getString("revision"));
   JSONObject read=perform(new JSONObject().put("type","calendar_read_selected").put("target",target),"Share with agent");assertEquals(fields.getString("description"),read.getJSONObject("result").getJSONObject("fields").getString("description"));
   JSONObject changed=new JSONObject(fields.toString()).put("title",fields.getString("title")+" edited");JSONObject updated=performReviewed(new JSONObject().put("type","calendar_update").put("target",target).put("fields",changed),"Update event",CHANGE_REVIEW);assertEquals("applied",updated.getString("status"));assertEquals(Long.toString(id),updated.getJSONObject("result").getString("eventId"));assertNotEquals(target.getString("revision"),updated.getJSONObject("result").getString("revision"));
   begin(new JSONObject().put("type","calendar_delete").put("target",target));assertEquals("conflict",result().getString("status"));assertTrue(exists(context,id));
   target.put("revision",updated.getJSONObject("result").getString("revision"));JSONObject deletion=new JSONObject().put("type","calendar_delete").put("target",target);assertEquals("cancelled",perform(deletion,"Cancel").getString("status"));assertTrue(exists(context,id));
   JSONObject deleted=perform(deletion,"Delete event");assertEquals("applied",deleted.getString("status"));assertEquals(target.getString("revision"),deleted.getJSONObject("result").getString("revision"));assertFalse(exists(context,id));
  }finally{if(id>0)context.getContentResolver().delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),null,null);}
 }

 // Patch 0041: direct save of all-day, chosen-zone and RRULE events with provider readback,
 // and the ACTION_INSERT handoff intercepted before any editor opens. Disposable rows only.
 private long eventId(Context context,String creationId){try(Cursor row=context.getContentResolver().query(CalendarContract.Events.CONTENT_URI,new String[]{CalendarContract.Events._ID},CalendarContract.Events.CUSTOM_APP_URI+"=?",new String[]{AlphaCalendarPlugin.CONFIGURATION.creationUriPrefix+"options/"+creationId},null)){return row!=null&&row.moveToFirst()?row.getLong(0):0;}}
 private android.content.ContentValues provider(Context context,long id){String[] fields={CalendarContract.Events.ALL_DAY,CalendarContract.Events.EVENT_TIMEZONE,CalendarContract.Events.RRULE,CalendarContract.Events.DURATION,CalendarContract.Events.DTSTART,CalendarContract.Events.DTEND,CalendarContract.Events.TITLE};android.content.ContentValues out=new android.content.ContentValues();try(Cursor row=context.getContentResolver().query(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),fields,null,null,null)){assertTrue(row!=null&&row.moveToFirst());for(int i=0;i<fields.length;i++)out.put(fields[i],row.isNull(i)?null:row.getString(i));}return out;}
 @Test public void directSaveReadsBackAllDayChosenZoneAndRrule()throws Exception{
  org.junit.Assume.assumeTrue("Explicit synthetic Calendar options gate","1".equals(InstrumentationRegistry.getArguments().getString("calendarOptions")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();for(String permission:new String[]{Manifest.permission.READ_CALENDAR,Manifest.permission.WRITE_CALENDAR})InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),permission);
  java.util.List<String> creations=new java.util.ArrayList<>();java.util.List<Long> ids=new java.util.ArrayList<>();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();until("document.documentElement.dataset.activeView");
   long day=java.time.LocalDate.now(java.time.ZoneOffset.UTC).plusDays(3).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli();
   String allDay=java.util.UUID.randomUUID().toString();creations.add(allDay);
   JSONObject event=new JSONObject().put("title","All-day options "+allDay).put("body","Synthetic").put("location","").put("begin",day).put("end",day+86400000L).put("allDay",true).put("timeZone","UTC").put("rrule","");
   eval("window.__calendarAgentResult=null;Capacitor.Plugins.AlphaCalendar.saveOptions({creationId:"+JSONObject.quote(allDay)+",separateCreation:true,calendarId:'local',event:"+event+"}).then(value=>window.__calendarAgentResult=value,error=>window.__calendarAgentResult={error:String(error)})");
   JSONObject saved=result();assertEquals("saved",saved.getString("status"));assertEquals(allDay,saved.getString("creationId"));long id=Long.parseLong(saved.getString("id"));ids.add(id);
   eval("window.__calendarAgentResult=null;Capacitor.Plugins.AlphaCalendar.readOptions({id:"+JSONObject.quote(Long.toString(id))+"}).then(value=>window.__calendarAgentResult=value,error=>window.__calendarAgentResult={error:String(error)})");
   JSONObject read=result();assertTrue(read.getBoolean("allDay"));assertEquals("UTC",read.getString("timeZone"));assertEquals("",read.getString("rrule"));
   android.content.ContentValues row=provider(context,id);assertEquals("1",row.getAsString(CalendarContract.Events.ALL_DAY));assertEquals(Long.toString(day),row.getAsString(CalendarContract.Events.DTSTART));assertEquals(Long.toString(day+86400000L),row.getAsString(CalendarContract.Events.DTEND));
   // Explicit IANA zone that differs from the device, and a simple weekly RRULE, on the local calendar.
   long localId=ai.eliza.plugins.calendar.write.CalendarDestinations.local(context.getContentResolver(),AlphaCalendarPlugin.CONFIGURATION);
   long begin=java.time.ZonedDateTime.of(java.time.LocalDate.now().plusDays(4),java.time.LocalTime.of(9,0),java.time.ZoneId.of("Asia/Tokyo")).toInstant().toEpochMilli();
   String zoned=java.util.UUID.randomUUID().toString();creations.add(zoned);
   JSONObject repeat=new JSONObject().put("title","Zoned weekly options "+zoned).put("body","").put("location","").put("begin",begin).put("end",begin+3600000L).put("allDay",false).put("timeZone","Asia/Tokyo").put("rrule","FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4");
   com.getcapacitor.JSObject created=AlphaCalendarPlugin.OPTION_CREATIONS.create(context,zoned,ai.eliza.plugins.calendar.write.CalendarEventOptions.parse(repeat).values(localId),true);
   assertEquals("saved",created.getString("status"));long repeating=Long.parseLong(created.getString("id"));ids.add(repeating);
   row=provider(context,repeating);assertEquals("Asia/Tokyo",row.getAsString(CalendarContract.Events.EVENT_TIMEZONE));assertEquals("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4",row.getAsString(CalendarContract.Events.RRULE));assertEquals("PT3600S",row.getAsString(CalendarContract.Events.DURATION));assertNull("Recurring rows store DURATION, not DTEND",row.getAsString(CalendarContract.Events.DTEND));assertEquals("0",row.getAsString(CalendarContract.Events.ALL_DAY));
   // Same creation identity never inserts twice.
   assertEquals(created.getString("id"),AlphaCalendarPlugin.OPTION_CREATIONS.create(context,zoned,ai.eliza.plugins.calendar.write.CalendarEventOptions.parse(repeat).values(localId),true).getString("id"));
   for(String rule:new String[]{"FREQ=HOURLY","FREQ=WEEKLY;COUNT=2;UNTIL=20300101T000000Z","FREQ=DAILY;BYDAY=MO","RRULE:FREQ=DAILY"})try{ai.eliza.plugins.calendar.write.CalendarEventOptions.parse(new JSONObject(repeat.toString()).put("rrule",rule));fail("Unsupported rule accepted: "+rule);}catch(IllegalArgumentException expected){}
   try{ai.eliza.plugins.calendar.write.CalendarEventOptions.parse(new JSONObject(event.toString()).put("begin",day+3600000L));fail("Non-midnight all-day accepted");}catch(IllegalArgumentException expected){}
  }finally{
   for(long id:ids)context.getContentResolver().delete(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,id),null,null);
   for(String creation:creations)try{AlphaCalendarPlugin.OPTION_CREATIONS.acknowledge(context,creation);}catch(Exception unsaved){/* An unsaved journal entry stays visible for recovery. */}
  }
 }
 @Test public void insertHandoffIsInterceptedWithPrefilledFields()throws Exception{
  android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();final java.util.List<android.content.Intent> captured=new java.util.concurrent.CopyOnWriteArrayList<>();
  android.app.Instrumentation.ActivityMonitor monitor=new android.app.Instrumentation.ActivityMonitor(){@Override public android.app.Instrumentation.ActivityResult onStartActivity(android.content.Intent intent){if(android.content.Intent.ACTION_INSERT.equals(intent.getAction())){captured.add(new android.content.Intent(intent));return new android.app.Instrumentation.ActivityResult(0,null);}return null;}};
  instrumentation.addMonitor(monitor);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();until("document.documentElement.dataset.activeView");awaitReviewForeground();
   long begin=System.currentTimeMillis()+86400000L;begin-=begin%60000;
   JSONObject event=new JSONObject().put("title","Handoff fixture").put("body","Synthetic").put("location","Hall").put("begin",begin).put("end",begin+1800000L).put("allDay",false).put("timeZone","Europe/Paris").put("rrule","FREQ=MONTHLY;BYMONTHDAY=15").put("attendees",new org.json.JSONArray().put("guest@example.com")).put("alerts",new org.json.JSONArray().put(10));
   eval("window.__calendarAgentResult=null;Capacitor.Plugins.AlphaCalendar.insertHandoff({event:"+event+"}).then(value=>window.__calendarAgentResult=value,error=>window.__calendarAgentResult={error:String(error)})");
   JSONObject result=result();
   org.junit.Assume.assumeFalse("A Calendar editor must resolve ACTION_INSERT","unavailable".equals(result.getString("status")));
   assertEquals("opened",result.getString("status"));assertFalse("Alerts are not a standard insert extra",result.getBoolean("alertsPrefilled"));
   assertEquals("Launch intercepted before delivery",1,captured.size());android.content.Intent intent=captured.get(0);
   assertEquals(CalendarContract.Events.CONTENT_URI,intent.getData());assertEquals("Handoff fixture",intent.getStringExtra(CalendarContract.Events.TITLE));assertEquals("Hall",intent.getStringExtra(CalendarContract.Events.EVENT_LOCATION));
   assertEquals(begin,intent.getLongExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME,-1));assertEquals(begin+1800000L,intent.getLongExtra(CalendarContract.EXTRA_EVENT_END_TIME,-1));assertFalse(intent.getBooleanExtra(CalendarContract.EXTRA_EVENT_ALL_DAY,true));
   assertEquals("FREQ=MONTHLY;BYMONTHDAY=15",intent.getStringExtra(CalendarContract.Events.RRULE));assertEquals("Europe/Paris",intent.getStringExtra(CalendarContract.Events.EVENT_TIMEZONE));assertEquals("guest@example.com",intent.getStringExtra(android.content.Intent.EXTRA_EMAIL));
  }finally{instrumentation.removeMonitor(monitor);}
 }
}
