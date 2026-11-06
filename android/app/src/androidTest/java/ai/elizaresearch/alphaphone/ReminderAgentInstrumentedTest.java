package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.reminders.ReminderTestAccess;

import android.content.Context;
import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.UUID;
import static org.junit.Assert.*;

/** Owned synthetic records only. Real Android store and AlarmManager; no timing/clock changes. */
@RunWith(AndroidJUnit4.class)
public class ReminderAgentInstrumentedTest {
 @Test public void receiptSurvivesActualProcessReplacement()throws Exception {
  String phase=InstrumentationRegistry.getArguments().getString("reminderAgentPhase","");org.junit.Assume.assumeTrue("Use owned prepare/verify/cleanup campaign",!phase.isEmpty());
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();android.content.SharedPreferences fixture=c.getSharedPreferences("alpha-reminder-agent-process-fixture",0);
  String binding=ReminderTestAccess.digest("synthetic-process-owner-device");
  if(phase.equals("prepare")){
   assertFalse("Prior fixture requires cleanup",fixture.contains("id"));assertTrue(ReminderTestAccess.allowed(c));
   String id="agent_process_"+UUID.randomUUID(),op=UUID.randomUUID().toString();assertTrue(fixture.edit().putString("id",id).putString("op",op).putInt("pid",android.os.Process.myPid()).commit());
   ReminderTestAccess.schedule(c,id,"Process replacement fixture","Synthetic only",System.currentTimeMillis()+3600000);
   JSONObject operation=new JSONObject().put("type","reminder_snooze").put("target",ReminderTestAccess.selected(c,id));assertTrue(fixture.edit().putString("operation",operation.toString()).commit());
   JSONObject result=ReminderTestAccess.operate(c,op,binding,operation);assertEquals("succeeded",result.getString("status"));assertTrue(fixture.edit().putString("result",result.toString()).commit());
  }else if(phase.equals("verify")){
   assertTrue(fixture.contains("result"));assertNotEquals("Runner must replace process",fixture.getInt("pid",0),android.os.Process.myPid());
   JSONObject receipt=ReminderTestAccess.operationReceipt(c,fixture.getString("op",null),binding,new JSONObject(fixture.getString("operation",null)));
   assertEquals(fixture.getString("result",null),receipt.toString());assertEquals(receipt.getJSONObject("result").getLong("at"),ReminderTestAccess.read(c,fixture.getString("id",null)).getLong("at"));
  }else if(phase.equals("cleanup")){
   String id=fixture.getString("id",null),op=fixture.getString("op",null);if(id!=null){assertTrue(id.startsWith("agent_process_"));ReminderTestAccess.cancel(c,id);ReminderTestAccess.removeFixture(c,java.util.Collections.singletonList(id),op==null?java.util.Collections.<String>emptyList():java.util.Collections.singletonList(op));}
   assertTrue(fixture.edit().clear().commit());
  }else fail("Unknown reminder process phase");
 }
 @Test public void legacyMigrationRetainsRawRecordsAndOccurrenceIdentity()throws Exception {
  Context base=InstrumentationRegistry.getInstrumentation().getTargetContext();String prefix="reminder_migration_"+UUID.randomUUID();
  Context c=new android.content.ContextWrapper(base){@Override public android.content.SharedPreferences getSharedPreferences(String name,int mode){return super.getSharedPreferences(prefix+"_"+name,mode);}};
  ReminderTestAccess.isolate(c);
  android.content.SharedPreferences legacy=c.getSharedPreferences("alpha-local-reminders-v1",0);
  String id="legacy_fixture",raw=new JSONObject().put("id",id).put("title","Original legacy title").put("body","Original legacy body").put("at",2000000000000L).put("createdAt",1).put("status","completed").put("mode","inexact").toString();
  try {
   assertTrue(legacy.edit().putString(id,raw).putString("damaged","broken-json").putInt("wrong_type",7).commit());
   JSONObject one=ReminderTestAccess.read(c,id),two=ReminderTestAccess.read(c,id);assertEquals(one.toString(),two.toString());assertTrue(one.getString("occurrenceId").startsWith("legacy_"));
   JSONObject envelope=new ReminderTestAccess.Envelope(c).snapshot();assertEquals(raw,envelope.getJSONObject("legacyArchive").getString(id));assertEquals(raw,envelope.getJSONObject("records").getString(id));assertEquals("broken-json",envelope.getJSONObject("records").getString("damaged"));assertEquals(7,envelope.getJSONObject("records").getInt("wrong_type"));
   JSONObject op=new JSONObject().put("type","reminder_read_selected").put("target",ReminderTestAccess.selected(c,id));
   JSONObject result=ReminderTestAccess.operate(c,"migration_read",ReminderTestAccess.digest("synthetic migration owner"),op);assertEquals("succeeded",result.getString("status"));
   assertEquals(1,ReminderTestAccess.list(c).length());assertEquals(3,new ReminderTestAccess.Envelope(c).snapshot().getJSONObject("records").length());assertEquals(1,new ReminderTestAccess.Envelope(c).snapshot().getJSONObject("operations").length());assertEquals(raw,legacy.getString(id,null));
  }finally{ReminderTestAccess.release(c);assertTrue(legacy.edit().clear().commit());assertTrue(c.getSharedPreferences("alpha-reminder-envelope-v1",0).edit().clear().commit());}
 }
 @Test public void selectedCrudPersistsExactReceiptsAndRejectsChangedBindings()throws Exception {
  org.junit.Assume.assumeTrue("Explicit owned reminder fixture gate", "1".equals(InstrumentationRegistry.getArguments().getString("reminderAgent")));
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertTrue("Enable normal notification permission before this campaign",ReminderTestAccess.allowed(c));
  String id="agent_fixture_"+UUID.randomUUID();String binding=ReminderTestAccess.digest("synthetic-owner-device-session");ArrayList<String> operations=new ArrayList<>();
  try {
   ReminderTestAccess.schedule(c,id,"Synthetic selected reminder","Original content",System.currentTimeMillis()+3600000);
   JSONObject target=ReminderTestAccess.selected(c,id),read=new JSONObject().put("type","reminder_read_selected").put("target",target);
   String readId=UUID.randomUUID().toString();operations.add(readId);
   JSONObject first=ReminderTestAccess.operate(c,readId,binding,read);assertEquals("succeeded",first.getString("status"));assertEquals("Original content",first.getJSONObject("result").getJSONObject("fields").getString("body"));
   String updateId=UUID.randomUUID().toString();operations.add(updateId);
   JSONObject update=new JSONObject().put("type","reminder_update").put("target",target).put("fields",new JSONObject().put("title","Updated synthetic reminder").put("body","Updated content"));
   assertEquals("succeeded",ReminderTestAccess.operate(c,updateId,binding,update).getString("status"));
   assertEquals("Updated content",ReminderTestAccess.read(c,id).getString("body"));
   // A newly constructed envelope rereads disk for every call; this must be historical content.
   assertEquals(first.toString(),ReminderTestAccess.operate(c,readId,binding,read).toString());
   try {ReminderTestAccess.operate(c,readId,ReminderTestAccess.digest("wrong-owner"),read);fail("Changed binding accepted");}catch(IllegalArgumentException expected){}
   try {ReminderTestAccess.operate(c,UUID.randomUUID().toString(),binding,update);fail("Stale target accepted");}catch(IllegalArgumentException expected){}
   JSONObject snooze=new JSONObject().put("type","reminder_snooze").put("target",ReminderTestAccess.selected(c,id));String snoozeId=UUID.randomUUID().toString();operations.add(snoozeId);
   long before=System.currentTimeMillis();JSONObject snoozed=ReminderTestAccess.operate(c,snoozeId,binding,snooze);long exact=snoozed.getJSONObject("result").getLong("at");assertTrue(exact>=before+600000&&exact<=System.currentTimeMillis()+600000);
   assertEquals(snoozed.toString(),ReminderTestAccess.operate(c,snoozeId,binding,snooze).toString());assertEquals(exact,ReminderTestAccess.read(c,id).getLong("at"));
   String occurrence=ReminderTestAccess.read(c,id).getString("occurrenceId");
   Intent alarm=new Intent(c,ReminderReceiver.class).setAction("ai.elizaresearch.alphaphone.REMIND").setData(Uri.parse("alpha-reminder:"+id+"/"+occurrence));
   assertNotNull("Real scheduled PendingIntent",PendingIntent.getBroadcast(c,0,alarm,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE));
   JSONObject done=new JSONObject().put("type","reminder_complete").put("target",ReminderTestAccess.selected(c,id));String doneId=UUID.randomUUID().toString();operations.add(doneId);
   assertEquals("completed",ReminderTestAccess.operate(c,doneId,binding,done).getJSONObject("result").getString("status"));
   ReminderTestAccess.deliver(c,id,occurrence);assertEquals("completed",ReminderTestAccess.read(c,id).getString("status"));
   JSONObject completedRow=ReminderTestAccess.read(c,id);
   JSONObject metadata=new JSONObject().put("type","reminder_update").put("target",ReminderTestAccess.selected(c,id)).put("fields",new JSONObject().put("title","Completed metadata edit").put("body","Completion must survive"));
   String metadataId=UUID.randomUUID().toString();operations.add(metadataId);
   JSONObject metadataReceipt=ReminderTestAccess.operate(c,metadataId,binding,metadata);
   assertEquals("succeeded",metadataReceipt.getString("status"));assertEquals("completed",metadataReceipt.getJSONObject("result").getString("status"));
   assertEquals(occurrence,ReminderTestAccess.read(c,id).getString("occurrenceId"));assertEquals(completedRow.getLong("at"),ReminderTestAccess.read(c,id).getLong("at"));
   assertEquals(completedRow.getLong("completedAt"),ReminderTestAccess.read(c,id).getLong("completedAt"));assertEquals(completedRow.getJSONArray("history").toString(),ReminderTestAccess.read(c,id).getJSONArray("history").toString());
   long reviewedAt=System.currentTimeMillis()+7200000;
   JSONObject reschedule=new JSONObject().put("type","reminder_update").put("target",ReminderTestAccess.selected(c,id)).put("fields",new JSONObject().put("title","Explicit new occurrence").put("body","Reviewed reschedule").put("schedule",new JSONObject().put("at",reviewedAt).put("recurrence",JSONObject.NULL)));
   String rescheduleId=UUID.randomUUID().toString();operations.add(rescheduleId);
   JSONObject rescheduled=ReminderTestAccess.operate(c,rescheduleId,binding,reschedule);assertEquals("succeeded",rescheduled.getString("status"));assertEquals("scheduled",rescheduled.getJSONObject("result").getString("status"));
   String newOccurrence=ReminderTestAccess.read(c,id).getString("occurrenceId");assertNotEquals(occurrence,newOccurrence);assertEquals(reviewedAt,ReminderTestAccess.read(c,id).getLong("at"));
   assertFalse(ReminderTestAccess.read(c,id).has("completedAt"));assertEquals(completedRow.getJSONArray("history").toString(),ReminderTestAccess.read(c,id).getJSONArray("history").toString());
   Intent newAlarm=new Intent(c,ReminderReceiver.class).setAction("ai.elizaresearch.alphaphone.REMIND").setData(Uri.parse("alpha-reminder:"+id+"/"+newOccurrence));
   assertNotNull("New occurrence has a real scheduled PendingIntent",PendingIntent.getBroadcast(c,0,newAlarm,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE));
   assertEquals(rescheduled.toString(),ReminderTestAccess.operate(c,rescheduleId,binding,reschedule).toString());assertEquals(rescheduled.toString(),ReminderTestAccess.operationReceipt(c,rescheduleId,binding,reschedule).toString());
   assertEquals(newOccurrence,ReminderTestAccess.read(c,id).getString("occurrenceId"));assertEquals(reviewedAt,ReminderTestAccess.read(c,id).getLong("at"));
   try{ReminderTestAccess.operate(c,UUID.randomUUID().toString(),binding,reschedule);fail("Stale reschedule target accepted");}catch(IllegalArgumentException expected){}
   String beforeOldDelivery=ReminderTestAccess.read(c,id).toString();ReminderTestAccess.deliver(c,id,occurrence);assertEquals(beforeOldDelivery,ReminderTestAccess.read(c,id).toString());
   JSONObject cancel=new JSONObject().put("type","reminder_cancel").put("target",ReminderTestAccess.selected(c,id));String cancelId=UUID.randomUUID().toString();operations.add(cancelId);
   assertEquals("cancelled",ReminderTestAccess.operate(c,cancelId,binding,cancel).getJSONObject("result").getString("status"));
   assertEquals("cancelled",ReminderTestAccess.read(c,id).getString("status"));
   String cancelledSnapshot=ReminderTestAccess.read(c,id).toString();int receiptCount=new ReminderTestAccess.Envelope(c).snapshot().getJSONObject("operations").length();
   for(boolean scheduleUpdate:new boolean[]{false,true}){
    JSONObject fields=new JSONObject().put("title","Must not revive cancellation").put("body","");if(scheduleUpdate)fields.put("schedule",new JSONObject().put("at",reviewedAt+3600000).put("recurrence",JSONObject.NULL));
    JSONObject cancelledUpdate=new JSONObject().put("type","reminder_update").put("target",ReminderTestAccess.selected(c,id)).put("fields",fields);String rejectedId=UUID.randomUUID().toString();operations.add(rejectedId);
    try{ReminderTestAccess.operate(c,rejectedId,binding,cancelledUpdate);fail("Cancelled reminder edit accepted");}catch(IllegalArgumentException expected){}
    assertEquals("unknown",ReminderTestAccess.operationReceipt(c,rejectedId,binding,cancelledUpdate).getString("status"));assertEquals(cancelledSnapshot,ReminderTestAccess.read(c,id).toString());assertEquals(receiptCount,new ReminderTestAccess.Envelope(c).snapshot().getJSONObject("operations").length());
   }
  } finally {
   ReminderTestAccess.cancel(c,id);
   ReminderTestAccess.removeFixture(c,java.util.Collections.singletonList(id),operations);
   assertNull(ReminderTestAccess.read(c,id));
  }
 }
}
