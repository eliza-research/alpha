package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.Manifest;
import android.app.PendingIntent;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.UUID;
import static org.junit.Assert.*;

/** Two independently owned secondary-user phases: denied permission and granted permission. */
@RunWith(AndroidJUnit4.class)
public class ReminderTimingInstrumentedTest {
 private final ArrayList<String> ids=new ArrayList<>(),operations=new ArrayList<>();
 private final String binding=ReminderTestAccess.digest("synthetic explicit timing fixture");
 private Context admitted(String phase){
  org.junit.Assume.assumeTrue("Owned timing fixture required",phase.equals(InstrumentationRegistry.getArguments().getString("reminderTiming")));
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();assertTrue("Secondary user only",android.os.Process.myUid()/100000>0);return c;
 }
 private String id(){String id="timing_"+UUID.randomUUID();ids.add(id);return id;}
 private JSONObject timing(long due,Object lead)throws Exception{return new JSONObject().put("dueAt",due).put("alertMinutes",lead);}
 private JSONObject operate(Context c,String id,String type,JSONObject fields)throws Exception{
  JSONObject op=new JSONObject().put("type",type).put("target",ReminderTestAccess.selected(c,id));if(fields!=null)op.put("fields",fields);
  String key=UUID.randomUUID().toString();operations.add(key);JSONObject result=ReminderTestAccess.operate(c,key,binding,op);
  assertEquals("succeeded",result.getString("status"));assertEquals(result.toString(),ReminderTestAccess.operate(c,key,binding,op).toString());assertEquals(result.toString(),ReminderTestAccess.operationReceipt(c,key,binding,op).toString());return result.getJSONObject("result");
 }
 private PendingIntent alarm(Context c,String id,String occurrence){return PendingIntent.getBroadcast(c,0,new Intent(c,ReminderReceiver.class).setAction("ai.elizaresearch.alphaphone.REMIND").setData(Uri.parse("alpha-reminder:"+id+"/"+occurrence)),PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE);}
 private void noNotification(Context c,String id){for(android.service.notification.StatusBarNotification n:c.getSystemService(NotificationManager.class).getActiveNotifications())assertNotEquals(id,n.getTag());}
 private void cleanup(Context c)throws Exception{
  for(String id:ids)ReminderTestAccess.cancel(c,id);
  ReminderTestAccess.removeFixture(c,ids,operations);
 }
 private JSONObject bridge(JSONObject args)throws Exception{return bridge("scheduleReminder",args);}
 private JSONObject bridge(String method,JSONObject args)throws Exception{return pluginBridge("DailyApps",method,args);}
 private JSONObject pluginBridge(String plugin,String method,JSONObject args)throws Exception{
  WebViewTestDriver.evaluate("window.__timingResult=null;Capacitor.nativePromise('"+plugin+"','"+method+"',"+args+").then(value=>window.__timingResult=value,()=>window.__timingResult={rejected:true})");
  long end=SystemClock.elapsedRealtime()+20000;
  while(SystemClock.elapsedRealtime()<end){String result=WebViewTestDriver.evaluate("window.__timingResult");if(!"null".equals(result))return new JSONObject(result);SystemClock.sleep(100);}throw new AssertionError("Native reminder save did not resolve without permission interaction");
 }
 private static void assertJsonEquals(Object expected,Object actual)throws Exception{
  if(expected instanceof JSONObject){
   assertTrue(actual instanceof JSONObject);JSONObject a=(JSONObject)expected,b=(JSONObject)actual;
   assertEquals(a.length(),b.length());for(java.util.Iterator<String> keys=a.keys();keys.hasNext();){String key=keys.next();assertTrue("Missing JSON key: "+key,b.has(key));assertJsonEquals(a.get(key),b.get(key));}
  }else if(expected instanceof org.json.JSONArray){
   assertTrue(actual instanceof org.json.JSONArray);org.json.JSONArray a=(org.json.JSONArray)expected,b=(org.json.JSONArray)actual;
   assertEquals(a.length(),b.length());for(int i=0;i<a.length();i++)assertJsonEquals(a.get(i),b.get(i));
  }else if(expected instanceof Number){assertTrue(actual instanceof Number);assertEquals(0,new java.math.BigDecimal(expected.toString()).compareTo(new java.math.BigDecimal(actual.toString())));
  }else assertEquals(expected,actual);
 }
 private JSONObject creation(long due,Object lead)throws Exception{
  return new JSONObject().put("type","reminder_create").put("fields",new JSONObject().put("title","Reviewed creation").put("body","Synthetic only").put("schedule",timing(due,lead).put("at",due-(lead==JSONObject.NULL?0:((Number)lead).longValue()*60000L)).put("recurrence",JSONObject.NULL)));
 }
 private void createFlow(Context c,boolean denied,boolean viaBridge)throws Exception{
  for(Object lead:new Object[]{JSONObject.NULL,10}){
   String id=id();operations.add(id);JSONObject op=creation(System.currentTimeMillis()+7200000,lead);
   JSONObject request=new JSONObject().put("operationId",id).put("bindingHash",binding).put("operation",op);
   JSONObject response=viaBridge?bridge("operateReminder",request):ReminderTestAccess.operate(c,id,binding,op);
   assertEquals("succeeded",response.getString("status"));JSONObject result=response.getJSONObject("result");
   assertEquals("reminder_create",result.getString("kind"));assertEquals(id,result.getString("reminderId"));assertJsonEquals(op.getJSONObject("fields"),result.getJSONObject("fields"));
   assertEquals(lead==JSONObject.NULL?"pending":denied?"permission-denied":"scheduled",result.getString("status"));
   JSONObject row=ReminderTestAccess.read(c,id);assertEquals(result.getString("revision"),ReminderTestAccess.selected(c,id).getString("revision"));
   if(lead==JSONObject.NULL||denied)assertNull(alarm(c,id,row.getString("occurrenceId")));else assertNotNull(alarm(c,id,row.getString("occurrenceId")));
   // Lost response recovery reads the immutable durable receipt, then replay after
   // a later edit must neither recreate nor restore the originally reviewed row.
   if(viaBridge){
    String scope=ReminderTestAccess.digest("owned creation journal "+id),proposal=UUID.randomUUID().toString();JSONObject key=new JSONObject().put("scope",scope).put("proposalId",proposal);
    JSONObject reserve=new JSONObject(key.toString()).put("operationId",id).put("operationHash",binding).put("record",new JSONObject().put("operation",op));
    assertTrue(pluginBridge("AlphaActionJournal","reserve",reserve).getBoolean("created"));
    assertEquals("applying",pluginBridge("AlphaActionJournal","markApplying",new JSONObject(key.toString()).put("attemptId",UUID.randomUUID().toString())).getJSONObject("entry").getString("phase"));
    JSONObject invalidFinish=new JSONObject(key.toString()).put("status","succeeded").put("summary","Not proven");assertTrue(pluginBridge("AlphaActionJournal","finish",invalidFinish).getBoolean("rejected"));
    JSONObject wrong=new JSONObject(result.toString());wrong.getJSONObject("fields").put("title","Changed review");invalidFinish.put("result",new JSONObject().put("operationId",id).put("reminderResult",wrong));assertTrue(pluginBridge("AlphaActionJournal","finish",invalidFinish).getBoolean("rejected"));
    JSONObject recovered=pluginBridge("AlphaActionJournal","recoverReminder",new JSONObject(key.toString()).put("bindingHash",binding)).getJSONObject("entry");assertEquals("succeeded",recovered.getString("status"));assertJsonEquals(result,recovered.getJSONObject("result").getJSONObject("reminderResult"));
    assertTrue(pluginBridge("AlphaActionJournal","markApplying",new JSONObject(key.toString()).put("attemptId",UUID.randomUUID().toString())).getBoolean("rejected"));
    AlphaCredentialStore credentials=new AlphaCredentialStore(c);credentials.removeCredentialSlot("action-journal:v1:"+scope+":entry:"+proposal);credentials.removeCredentialSlot("action-journal:v1:"+scope+":index");
   }
   assertJsonEquals(response,ReminderTestAccess.operationReceipt(c,id,binding,op));
   operate(c,id,"reminder_update",new JSONObject().put("title","Later reviewed edit").put("body","Preserve later state"));String edited=ReminderTestAccess.read(c,id).toString();
   assertJsonEquals(response,ReminderTestAccess.operate(c,id,binding,op));assertEquals(edited,ReminderTestAccess.read(c,id).toString());
   JSONObject changed=new JSONObject(op.toString());changed.getJSONObject("fields").put("title","Different request");
   try{ReminderTestAccess.operate(c,id,binding,changed);fail("Creation binding changed");}catch(IllegalArgumentException expected){}assertEquals(edited,ReminderTestAccess.read(c,id).toString());
  }
  String recurring=id();operations.add(recurring);java.time.ZonedDateTime civil=java.time.ZonedDateTime.now(java.time.ZoneId.of("UTC")).plusDays(1).withHour(12).withMinute(0).withSecond(0).withNano(0);long first=civil.toInstant().toEpochMilli();
  JSONObject repeat=new JSONObject().put("rule","daily").put("zone","UTC").put("date",civil.toLocalDate().toString()).put("time","12:00").put("leadMinutes",0);
  JSONObject recurringOp=creation(first,JSONObject.NULL);recurringOp.getJSONObject("fields").getJSONObject("schedule").put("recurrence",repeat);
  JSONObject recurringResponse=viaBridge?bridge("operateReminder",new JSONObject().put("operationId",recurring).put("bindingHash",binding).put("operation",recurringOp)):ReminderTestAccess.operate(c,recurring,binding,recurringOp);
  assertEquals("succeeded",recurringResponse.getString("status"));assertJsonEquals(repeat,ReminderTestAccess.read(c,recurring).getJSONObject("recurrence"));assertJsonEquals(repeat,recurringResponse.getJSONObject("result").getJSONObject("fields").getJSONObject("schedule").getJSONObject("recurrence"));
  operate(c,recurring,"reminder_complete",null);String advanced=ReminderTestAccess.read(c,recurring).toString();assertEquals(first+86400000,ReminderTestAccess.read(c,recurring).getLong("dueAt"));
  assertJsonEquals(recurringResponse,ReminderTestAccess.operationReceipt(c,recurring,binding,recurringOp));assertJsonEquals(recurringResponse,ReminderTestAccess.operate(c,recurring,binding,recurringOp));assertEquals(advanced,ReminderTestAccess.read(c,recurring).toString());assertNull(alarm(c,recurring,ReminderTestAccess.read(c,recurring).getString("occurrenceId")));
  String occupied=id();long due=System.currentTimeMillis()+7200000;ReminderTestAccess.schedule(c,occupied,"Already owned","",due,null,timing(due,JSONObject.NULL));String original=ReminderTestAccess.read(c,occupied).toString();JSONObject op=creation(due,JSONObject.NULL);
  try{ReminderTestAccess.operate(c,occupied,binding,op);fail("Existing record was adopted");}catch(IllegalArgumentException expected){}assertEquals(original,ReminderTestAccess.read(c,occupied).toString());assertEquals("unknown",ReminderTestAccess.operationReceipt(c,occupied,binding,op).getString("status"));
  for(int malformed=0;malformed<3;malformed++){
   String id=id();JSONObject bad=creation(due,JSONObject.NULL);if(malformed==0)bad.getJSONObject("fields").put("title"," Unreviewed trim ");else if(malformed==1)bad.getJSONObject("fields").getJSONObject("schedule").remove("alertMinutes");else bad.getJSONObject("fields").getJSONObject("schedule").put("at",due+1);
   try{ReminderTestAccess.operate(c,id,binding,bad);fail("Malformed creation accepted");}catch(IllegalArgumentException expected){}assertNull(ReminderTestAccess.read(c,id));assertEquals("unknown",ReminderTestAccess.operationReceipt(c,id,binding,bad).getString("status"));
  }
 }
 @Test public void noAlertBridgeWithoutPermissionRestoresAndCompletesWithoutDelivery()throws Exception{
  Context c=admitted("none");assertEquals(PackageManager.PERMISSION_DENIED,c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS));assertFalse(ReminderTestAccess.allowed(c));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();JSONObject surface=bridge("surfaceInfo",new JSONObject());assertTrue("Timing capability must be numeric",surface.get("reminderTimingVersion") instanceof Number);assertEquals(2,surface.getInt("reminderTimingVersion"));assertTrue(surface.get("reminderCreationVersion") instanceof Number);assertEquals(1,surface.getInt("reminderCreationVersion"));createFlow(c,true,true);String id=id();long due=System.currentTimeMillis()+3600000;
   JSONObject response=bridge(new JSONObject().put("id",id).put("title","No alert native fixture").put("body","Synthetic only").put("at",due).put("dueAt",due).put("alertMinutes",JSONObject.NULL));
   assertEquals("pending",response.getString("status"));assertEquals("none",response.getString("mode"));assertTrue(response.isNull("alertMinutes"));
   JSONObject row=ReminderTestAccess.read(c,id);assertEquals(due,row.getLong("dueAt"));assertEquals(due,row.getLong("at"));assertEquals(2,ReminderTestAccess.selected(c,id).getInt("timingVersion"));assertNull(alarm(c,id,row.getString("occurrenceId")));
   ReminderTestAccess.restore(c);ReminderTestAccess.deliver(c,id,row.getString("occurrenceId"));assertEquals(row.toString(),ReminderTestAccess.read(c,id).toString());assertNull(alarm(c,id,row.getString("occurrenceId")));noNotification(c,id);
   // Even a stale scheduled flag cannot turn an explicit None record into an alarm.
   JSONObject inconsistent=new JSONObject(row.toString()).put("status","scheduled");assertTrue(new ReminderTestAccess.Envelope(c).records().edit().putString(id,inconsistent.toString()).commit());
   ReminderTestAccess.restore(c);ReminderTestAccess.deliver(c,id,row.getString("occurrenceId"));assertNull(alarm(c,id,row.getString("occurrenceId")));noNotification(c,id);assertTrue(new ReminderTestAccess.Envelope(c).records().edit().putString(id,row.toString()).commit());
   String invalid=id();JSONObject invalidResponse=bridge(new JSONObject().put("id",invalid).put("title","Malformed explicit timing").put("at",due).put("dueAt",due));assertEquals("failed",invalidResponse.getString("status"));assertNull(ReminderTestAccess.read(c,invalid));
   JSONObject read=operate(c,id,"reminder_read_selected",null);assertTrue(read.isNull("alertMinutes"));assertEquals(due,read.getJSONObject("fields").getJSONObject("schedule").getLong("dueAt"));
   try{ReminderTestAccess.decide(c,id,row.getString("occurrenceId"),"snooze");fail("No-alert snooze accepted");}catch(IllegalArgumentException expected){}assertEquals(row.toString(),ReminderTestAccess.read(c,id).toString());
   assertEquals("completed",operate(c,id,"reminder_complete",null).getString("status"));assertEquals(due,ReminderTestAccess.read(c,id).getJSONArray("history").getJSONObject(0).getLong("dueAt"));
   String recurring=id();java.time.ZonedDateTime civil=java.time.ZonedDateTime.now(java.time.ZoneId.of("UTC")).plusDays(1).withHour(12).withMinute(0).withSecond(0).withNano(0);long first=civil.toInstant().toEpochMilli();
   JSONObject repeat=new JSONObject().put("rule","daily").put("zone","UTC").put("date",civil.toLocalDate().toString()).put("time","12:00").put("leadMinutes",0);
   try{ReminderTestAccess.schedule(c,recurring,"Bad silent repeat","",first,new JSONObject(repeat.toString()).put("leadMinutes",10),timing(first,JSONObject.NULL));fail("None repeat lead accepted");}catch(IllegalArgumentException expected){}assertNull(ReminderTestAccess.read(c,recurring));
   try{ReminderTestAccess.schedule(c,recurring,"Mismatched civil due","",first+60000,repeat,timing(first+60000,JSONObject.NULL));fail("Civil due mismatch accepted");}catch(IllegalArgumentException expected){}assertNull(ReminderTestAccess.read(c,recurring));
   ReminderTestAccess.schedule(c,recurring,"Silent repeat","",first,repeat,timing(first,JSONObject.NULL));
   JSONObject completed=operate(c,recurring,"reminder_complete",null),next=ReminderTestAccess.read(c,recurring);assertEquals("pending",completed.getString("status"));assertEquals("none",next.getString("mode"));assertEquals(first+86400000,next.getLong("dueAt"));assertEquals(next.getLong("dueAt"),next.getLong("at"));assertNull(alarm(c,recurring,next.getString("occurrenceId")));ReminderTestAccess.restore(c);ReminderTestAccess.deliver(c,recurring,next.getString("occurrenceId"));noNotification(c,recurring);
   assertEquals(PackageManager.PERMISSION_DENIED,c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS));assertFalse(ReminderTestAccess.allowed(c));
  }finally{cleanup(c);}
 }
 @Test public void numericLeadDueTimeStaleTargetsAndLegacyReceiptsRemainBound()throws Exception{
  Context c=admitted("numeric");ReminderTestAccess.channel(c);assertTrue(ReminderTestAccess.allowed(c));
  try{
   createFlow(c,false,false);
   String id=id();long due=System.currentTimeMillis()+7200000,at=due-600000;
   JSONObject row=ReminderTestAccess.schedule(c,id,"Ten minutes before","",at,null,timing(due,10));assertEquals(due,row.getLong("dueAt"));assertEquals(10,row.getInt("alertMinutes"));assertNotNull(alarm(c,id,row.getString("occurrenceId")));
   JSONObject target=ReminderTestAccess.selected(c,id);operate(c,id,"reminder_snooze",null);assertEquals(due,ReminderTestAccess.read(c,id).getLong("dueAt"));JSONObject afterSnooze=operate(c,id,"reminder_read_selected",null);assertEquals(10,afterSnooze.getInt("alertMinutes"));assertEquals(at,afterSnooze.getJSONObject("fields").getJSONObject("schedule").getLong("at"));long snoozeDeadline=afterSnooze.getLong("at");assertEquals(ReminderTestAccess.read(c,id).getLong("at"),snoozeDeadline);operate(c,id,"reminder_update",new JSONObject().put("title","Metadata after snooze").put("body","Keep actual deadline"));assertEquals(snoozeDeadline,ReminderTestAccess.read(c,id).getLong("at"));assertEquals(due,ReminderTestAccess.read(c,id).getLong("dueAt"));assertEquals(10,ReminderTestAccess.read(c,id).getInt("alertMinutes"));
   JSONObject schedule=timing(due,JSONObject.NULL).put("at",due).put("recurrence",JSONObject.NULL),fields=new JSONObject().put("title","Reviewed no alert").put("body","").put("schedule",schedule);
   JSONObject none=operate(c,id,"reminder_update",fields);assertEquals("pending",none.getString("status"));assertTrue(none.isNull("alertMinutes"));assertNull(alarm(c,id,none.getString("occurrenceId")));
   ReminderTestAccess.deliver(c,id,row.getString("occurrenceId"));ReminderTestAccess.deliver(c,id,none.getString("occurrenceId"));ReminderTestAccess.restore(c);assertEquals("pending",ReminderTestAccess.read(c,id).getString("status"));noNotification(c,id);
   String retained=ReminderTestAccess.read(c,id).toString();try{ReminderTestAccess.operate(c,UUID.randomUUID().toString(),binding,new JSONObject().put("type","reminder_update").put("target",target).put("fields",fields));fail("Stale timing target accepted");}catch(IllegalArgumentException expected){}assertEquals(retained,ReminderTestAccess.read(c,id).toString());
   for(JSONObject invalid:new JSONObject[]{new JSONObject().put("dueAt",due),new JSONObject().put("alertMinutes",0),timing(due,"10"),timing(due,0.5),timing(due,10081),timing(due-1,10)}){try{ReminderTestAccess.schedule(c,id,"Must not replace","",at,null,invalid);fail("Malformed timing accepted");}catch(IllegalArgumentException expected){}assertEquals(retained,ReminderTestAccess.read(c,id).toString());}
   try{ReminderTestAccess.schedule(c,id,"Legacy overwrite refused","",due);fail("Legacy call removed explicit timing");}catch(IllegalArgumentException expected){}assertEquals(retained,ReminderTestAccess.read(c,id).toString());
   JSONObject downgrade=new JSONObject().put("type","reminder_update").put("target",ReminderTestAccess.selected(c,id)).put("fields",new JSONObject().put("title","Downgrade refused").put("body","").put("schedule",new JSONObject().put("at",due).put("recurrence",JSONObject.NULL)));
   try{ReminderTestAccess.operate(c,UUID.randomUUID().toString(),binding,downgrade);fail("Canonical downgrade removed explicit timing");}catch(IllegalArgumentException expected){}assertEquals(retained,ReminderTestAccess.read(c,id).toString());
   String legacy=id();ReminderTestAccess.schedule(c,legacy,"Legacy unchanged","",due);JSONObject old=operate(c,legacy,"reminder_read_selected",null);assertFalse(old.has("alertMinutes"));assertFalse(old.has("dueAt"));assertFalse(ReminderTestAccess.selected(c,legacy).has("timingVersion"));assertFalse(old.getJSONObject("fields").getJSONObject("schedule").has("alertMinutes"));
   JSONObject legacyRead=new JSONObject().put("type","reminder_read_selected").put("target",ReminderTestAccess.selected(c,legacy));String legacyOp=UUID.randomUUID().toString();operations.add(legacyOp);String historical=ReminderTestAccess.operate(c,legacyOp,binding,legacyRead).toString();
   operate(c,legacy,"reminder_update",new JSONObject().put("title","Explicit timing upgrade").put("body","").put("schedule",timing(due,JSONObject.NULL).put("at",due).put("recurrence",JSONObject.NULL)));
   assertEquals(historical,ReminderTestAccess.operate(c,legacyOp,binding,legacyRead).toString());assertEquals(historical,ReminderTestAccess.operationReceipt(c,legacyOp,binding,legacyRead).toString());
  }finally{cleanup(c);}
 }
}
