package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.actionjournal.ActionJournal;
import ai.eliza.plugins.actionjournal.ActionJournalPlugin;
import ai.eliza.plugins.notifications.NoticeRecovery;
import ai.eliza.plugins.reminders.ReminderReceiptFixture;
import android.content.Context;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ActionRecoveryTraces {
 private static final String SCOPE="a".repeat(64), PEER="b".repeat(64), HASH="c".repeat(64);
 private static final String PROPOSAL="proposal", OPERATION="operation", PRIVATE="fixture-private";
 private static final String JOURNAL_SLOT="action-journal:v1:"+SCOPE+":entry:"+PROPOSAL;
 private static final String NOTICE_SLOT="workflow-notice-delivery:v1";
 private static final Map<String,String> slots=new HashMap<>();
 private static final JSONObject owner=new JSONObject().put("account","fixture-owner");
 private static final JSONObject target=new JSONObject().put("sourceId","source").put("eventId","event")
  .put("reminderId","reminder").put("occurrenceId","occurrence").put("revision","revision");
 private static JSONObject deletion, reminders=new JSONObject();
 private static AlphaActionJournalPlugin plugin;
 private static Trace trace;
 private static String kind,proof="exact",status="missing",fault="none",method="none",requestedBinding="none",reply="none",replyResult="none";
 private static String binding,foreignBinding;
 private static boolean visible, live=true, completeBinding=true;
 private static int noticeReads,deletionReads,reminderReads,matches,noticeWrites,journalWrites,process=1;

 static String read(String slot)throws Exception {
  if(slot.equals(NOTICE_SLOT)) {
   noticeReads++;
   if(fault.equals("notice-read"))throw new java.io.IOException("synthetic receipt unavailable");
  }
  if(slot.startsWith("action-journal:v1:")&&fault.equals("journal-read"))
   throw new java.io.IOException("synthetic journal unavailable");
  return slots.get(slot);
 }

 static void write(String slot,String value)throws Exception {
  String label;
  if(slot.equals(NOTICE_SLOT)){noticeWrites++;label="notice";}
  else if(slot.startsWith("action-journal:v1:")){journalWrites++;label="journal";}
  else throw new AssertionError("Unexpected storage slot");
  if(fault.equals(label+"-before"))throw new java.io.IOException("synthetic precommit refusal");
  slots.put(slot,value);
  if(fault.equals(label+"-after"))throw new java.io.IOException("synthetic postcommit refusal");
 }

 static boolean matches(String id,String title,String body) {
  if(!OPERATION.equals(id)||!PRIVATE.equals(title)||!"fixture-body".equals(body))
   throw new AssertionError("Notification active-list read was not bound to the reviewed operation");
  matches++;
  return visible;
 }

 static JSONObject deletionReceipt(String route,String id)throws Exception {
  if(!OPERATION.equals(id)||!route.equals(kind.equals("calendar-delete")?"calendar":"reminder"))
   throw new AssertionError("Unexpected deletion receipt lookup");
  deletionReads++;
  if(fault.equals("receipt-read"))throw new java.io.IOException("synthetic deletion receipt unavailable");
  return deletion==null?null:copy(deletion);
 }

 public static void reminderLookup(String id,String requested,JSONObject operation)throws Exception {
  if(!OPERATION.equals(id)||!ActionJournal.sameJson(operation,operation()))
   throw new AssertionError("Unexpected reminder receipt lookup");
  reminderReads++;
  if(fault.equals("receipt-read"))throw new IllegalStateException("synthetic reminder receipt unavailable");
 }

 public static JSONObject reminderEnvelope() {return new JSONObject().put("operations",copy(reminders));}

 private static JSONObject copy(JSONObject value){return new JSONObject(value.toString());}
 private static String hex(String value)throws Exception {
  return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
 }

 private static JSONObject operation() {
  return switch(kind) {
   case "notice" -> new JSONObject().put("type","post_notification").put("title",PRIVATE).put("body","fixture-body");
   case "calendar-delete" -> new JSONObject().put("type","calendar_delete").put("target",target);
   case "reminder-cancel" -> new JSONObject().put("type","reminder_cancel").put("target",target);
   case "reminder-read" -> new JSONObject().put("type","reminder_read_selected").put("target",target);
   case "reminder-complete" -> new JSONObject().put("type","reminder_complete").put("target",target);
   case "reminder-update" -> new JSONObject().put("type","reminder_update").put("target",target)
     .put("fields",new JSONObject().put("title",PRIVATE));
   case "reminder-snooze" -> new JSONObject().put("type","reminder_snooze").put("target",target);
   case "reminder-create" -> new JSONObject().put("type","reminder_create")
     .put("fields",new JSONObject().put("title",PRIVATE).put("body",PRIVATE).put("schedule",
       new JSONObject().put("at",1000).put("dueAt",1000).put("alertMinutes",JSONObject.NULL)));
   case "workflow-read" -> new JSONObject().put("type","read_selected_notes");
   case "calendar-read" -> new JSONObject().put("type","calendar_read_next");
   case "note-read" -> new JSONObject().put("type","notes_read_selected");
   case "note-query" -> new JSONObject().put("type","notes_query").put("query",new JSONObject().put("text","fixture-query"));
   case "maps-read" -> new JSONObject().put("type","maps_read_selected").put("target",target);
   default -> throw new AssertionError(kind);
  };
 }

 private static JSONObject record() {
  JSONObject record=new JSONObject().put("ownerId","owner-a").put("agentId","agent").put("sessionId","session")
   .put("origin","https://fixture.invalid").put("installationId","installation").put("enrollmentId","enrollment")
   .put("digest","digest").put("operation",operation());
  if(kind.equals("notice")||kind.equals("workflow-read"))record.put("workflow",new JSONObject().put("step","step"));
  if(!completeBinding)record.remove("enrollmentId");
  return record;
 }

 private static JSONObject reminderResult(boolean valid) {
  JSONObject result=new JSONObject().put("kind",valid?operation().getString("type"):"unexpected").put("version",1)
   .put("sourceId","source").put("reminderId","reminder").put("occurrenceId","occurrence")
   .put("revision","revision").put("at",1000).put("status",kind.equals("reminder-cancel")?"cancelled":"pending");
  if(kind.equals("reminder-read"))result.put("fields",new JSONObject().put("title",PRIVATE).put("body",PRIVATE)
   .put("schedule",new JSONObject().put("at",1000)));
  if(kind.equals("reminder-create"))result.put("reminderId",OPERATION).put("revision","d".repeat(64))
   .put("dueAt",1000).put("alertMinutes",JSONObject.NULL).put("fields",operation().getJSONObject("fields"));
  return result;
 }

 private static JSONObject initialResult() {
  JSONObject base=new JSONObject().put("operationId",OPERATION);
  JSONObject fields=new JSONObject().put("name",PRIVATE);
  return switch(kind) {
   case "notice" -> base;
   case "reminder-read","reminder-cancel","reminder-complete","reminder-create","reminder-update","reminder-snooze" -> base.put("reminderResult",reminderResult(true));
   case "calendar-delete" -> base.put("calendarResult",new JSONObject().put("kind","calendar_delete").put("version",1));
   case "workflow-read" -> base.put("readResult",fields);
   case "calendar-read" -> base.put("calendarResult",new JSONObject().put("kind","calendar_read_next").put("version",1).put("fields",fields));
   case "note-read" -> base.put("notesResult",new JSONObject().put("kind","notes_read_selected").put("version",1).put("fields",fields));
   case "note-query" -> base.put("notesResult",new JSONObject().put("kind","notes_query").put("version",1)
    .put("query",operation().getJSONObject("query")).put("basis","match").put("target",target)
    .put("record",new JSONObject().put("kind","notes_read_selected").put("fields",fields)));
   case "maps-read" -> base.put("mapsResult",new JSONObject().put("kind","maps_read_selected").put("version",1).put("target",target).put("fields",fields));
   default -> throw new AssertionError(kind);
  };
 }

 private static String result(JSONObject entry) {
  JSONObject body=entry==null?null:entry.optJSONObject("result");
  if(body==null)return "none";
  if(!OPERATION.equals(body.getString("operationId")))throw new AssertionError("Unexpected operation result");
  if(body.optBoolean("readResultRetained"))return "workflow-retained";
  if(body.optBoolean("calendarReadRetained"))return "calendar-retained";
  if(body.optBoolean("notesReadRetained"))return kind.equals("note-query")?"query-retained":"note-retained";
  if(body.optBoolean("mapsReadRetained"))return "maps-retained";
  if(body.optBoolean("reminderReadRetained")){
   JSONObject reminder=body.getJSONObject("reminderResult");
   if(reminder.has("fields")||!"reminder_read_selected".equals(reminder.getString("kind"))
       ||reminder.getInt("version")!=1||!"source".equals(reminder.getString("sourceId"))
       ||!"reminder".equals(reminder.getString("reminderId"))
       ||!"occurrence".equals(reminder.getString("occurrenceId"))
       ||!"revision".equals(reminder.getString("revision"))||reminder.getInt("at")!=1000)
    throw new AssertionError("Passive reminder identity or summary changed");
   return "reminder-retained";
  }
  if(body.has("readResult"))return "workflow";
  if(body.has("calendarResult"))return body.getJSONObject("calendarResult").has("fields")?"calendar-read":"calendar-delete";
  if(body.has("notesResult"))return body.getJSONObject("notesResult").has("record")?"query":"note";
  if(body.has("mapsResult"))return "maps";
  if(body.has("reminderResult")) {
   JSONObject reminder=body.getJSONObject("reminderResult");
   if("reminder_create".equals(reminder.optString("kind")))return "reminder-create";
   return reminder.has("fields")?"reminder-read":"reminder";
  }
  return "operation";
 }

 private static String phase(JSONObject entry) {
  if(entry==null)return "absent";
  String phase=entry.getString("phase");
  return phase.equals("terminal")?entry.getString("status"):phase;
 }

 private static JSONObject entry() {
  String raw=slots.get(JOURNAL_SLOT);
  return raw==null?null:new JSONObject(raw);
 }

 private static void verifyEntry(JSONObject saved)throws Exception {
  if(saved==null)return;
  if(!SCOPE.equals(saved.getString("scope"))||!PROPOSAL.equals(saved.getString("proposalId"))
      ||!OPERATION.equals(saved.getString("operationId"))||!HASH.equals(saved.getString("operationHash"))
      ||!ActionJournal.sameJson(record(),saved.getJSONObject("record")))
   throw new AssertionError("Journal identity changed");
  JSONObject claim=saved.optJSONObject("nativeDispatchClaim");
  if(claim!=null&&!ActionJournal.sameJson(claim.getJSONObject("owner"),owner))throw new AssertionError("Native claim changed");
 }

 private static JSONObject observe()throws Exception {
  JSONObject saved=entry();
  verifyEntry(saved);
  String notice="missing";
  if(slots.containsKey(NOTICE_SLOT))notice=new JSONObject(slots.get(NOTICE_SLOT)).getJSONObject(OPERATION).getString("status");
  return Trace.fields("kind",kind,"phase",phase(saved),"attempt",saved!=null&&saved.has("attemptId"),
    "claim",saved!=null&&saved.has("nativeDispatchClaim"),
    "completeBinding",saved==null?completeBinding:saved.getJSONObject("record").has("enrollmentId"),"result",result(saved),
    "proof",proof,"status",status,"notice",notice,"visible",visible,"live",live,"process",process,
    "method",method,"requestedBinding",requestedBinding,"reply",reply,"replyResult",replyResult,"noticeReads",noticeReads,"deletionReads",deletionReads,
    "reminderReads",reminderReads,"matches",matches,"noticeWrites",noticeWrites,"journalWrites",journalWrites);
 }

 private static void prepare(String mode,String phase,boolean attempt,boolean claim)throws Exception {
  kind=mode;
  plugin=new AlphaActionJournalPlugin();
  ActionJournal journal=AlphaActionJournal.get(new Context());
  if(!phase.equals("absent")) {
   journal.reserve(SCOPE,PROPOSAL,OPERATION,HASH,record());
   if(attempt)journal.markApplying(SCOPE,PROPOSAL,"attempt");
   if(claim)journal.update(SCOPE,PROPOSAL,previous->previous.put("nativeDispatchClaim",
     new JSONObject().put("kind","deletion").put("operationId",OPERATION).put("owner",owner)));
   if(!phase.equals("reserved")&&!phase.equals("applying"))
    journal.finish(SCOPE,PROPOSAL,phase,"fixture-original",phase.equals("succeeded")?initialResult():null);
  }
  JSONObject current=new JSONObject().put("record",record().put("enrollmentId","enrollment")).put("operationId",OPERATION);
  binding=NoticeRecovery.binding(current,SCOPE,PROPOSAL);
  JSONObject peer=new JSONObject().put("record",record().put("ownerId","owner-b").put("enrollmentId","enrollment")).put("operationId",OPERATION);
  foreignBinding=NoticeRecovery.binding(peer,PEER,"peer-proposal");
  journalWrites=0;
 }

 private static void receipt(String next,String mismatch,boolean active)throws Exception {
  status=next;proof=mismatch;visible=active;
  slots.remove(NOTICE_SLOT);reminders=new JSONObject();deletion=null;
  if(!next.equals("missing")) {
   if(kind.equals("notice")) {
    JSONObject row=new JSONObject().put("binding",mismatch.equals("foreign")?foreignBinding:binding)
     .put("digest",hex(new JSONArray().put(mismatch.equals("payload")?"other-title":PRIVATE).put("fixture-body").toString()))
     .put("status",next);
    slots.put(NOTICE_SLOT,new JSONObject().put(OPERATION,row).toString());
   } else if(kind.equals("calendar-delete")||kind.equals("reminder-cancel")) {
    JSONObject keys=new JSONObject().put("scope",SCOPE).put("proposalId",mismatch.equals("proposal")?"peer-proposal":PROPOSAL)
     .put("operationHash",mismatch.equals("hash")?"b".repeat(64):HASH);
    JSONObject proofTarget=copy(target);
    if(mismatch.equals("target"))proofTarget.put("revision","other");
    deletion=new JSONObject().put("id",mismatch.equals("operation")?"peer-operation":OPERATION)
     .put("owner",mismatch.equals("owner")?new JSONObject().put("account","peer-owner"):owner)
     .put("target",proofTarget).put("phase",next)
     .put("outcome",new JSONObject().put("status",mismatch.equals("outcome")?"unknown":"deleted"))
     .put("effects",mismatch.equals("effects")?"pending":"complete");
    if(kind.equals("calendar-delete"))proofTarget.put("journalBinding",keys);
    else {
     JSONObject exact=operation();
     JSONObject savedOperation=mismatch.equals("payload")?copy(exact).put("target",copy(target).put("revision","other")):exact;
     deletion.put("operationBinding",new JSONObject().put("operation",savedOperation).put("bindingHash",binding).put("journalBinding",keys));
     if(next.equals("deleted")&&!mismatch.equals("missing-result"))reminderSlot(binding,exact,"succeeded",!mismatch.equals("result"));
    }
   } else if(kind.startsWith("reminder-")) {
    JSONObject exact=operation();
    if(mismatch.equals("payload"))exact=copy(exact).put("target",copy(target).put("revision","other"));
    reminderSlot(mismatch.equals("foreign")?foreignBinding:binding,exact,next,!mismatch.equals("result"));
   } else throw new AssertionError("Unexpected synthetic receipt type");
  }
  trace.step("receipt",observe(),next,mismatch,active);
 }

 private static void reminderSlot(String hash,JSONObject operation,String status,boolean valid) {
  JSONObject response=new JSONObject().put("status",status);
  if(status.equals("succeeded"))response.put("result",reminderResult(valid));
  reminders.put(OPERATION,new JSONObject().put("argumentHash",ReminderReceiptFixture.argumentHash(hash,operation)).put("response",response));
 }

 private static void resetCounters() {noticeReads=deletionReads=reminderReads=matches=noticeWrites=journalWrites=0;}

 private static void call(String method,String address,String candidate,String injected)throws Exception {
  resetCounters();
  ActionRecoveryTraces.method=method;requestedBinding=candidate;
  String before=slots.get(JOURNAL_SLOT);
  fault=injected;
  JSONObject request=new JSONObject().put("scope",address.equals("invalid")?"invalid":address.equals("scope")?PEER:SCOPE)
   .put("proposalId",address.equals("proposal")?"peer-proposal":PROPOSAL)
   .put("bindingHash",candidate.equals("exact")?binding:candidate.equals("foreign")?foreignBinding:"d".repeat(64));
  PluginCall call=new PluginCall(request);
  switch(method) {
   case "notice" -> plugin.recoverNotification(call);
   case "deletion" -> plugin.recoverDeletion(call);
   case "reminder" -> plugin.recoverReminder(call);
   case "get" -> plugin.get(call);
   case "list" -> plugin.list(call);
   default -> throw new AssertionError(method);
  }
  call.await();
  fault="none";
  if(call.rejection!=null) {
   if(!call.rejection.equals("Action journal unavailable or transition rejected"))throw new AssertionError("Unexpected refusal text");
   reply="refused";replyResult="none";
  } else {
   JSONObject seen;
   if(method.equals("list")) {
    JSONArray list=call.result.getJSONArray("entries");
    if(list.length()>1)throw new AssertionError("Passive list crossed scope");
    seen=list.length()==0?null:list.getJSONObject(0);
   } else seen=call.result.optJSONObject("entry");
   verifyEntry(seen);
   if(method.equals("get")&&address.equals("exact")&&!ActionJournal.sameJson(entry(),seen))
    throw new AssertionError("Exact read did not return the stored receipt");
   reply=phase(seen);replyResult=result(seen);
   if(replyResult.endsWith("-retained") && seen.getJSONObject("result").toString().contains(PRIVATE))
    throw new AssertionError("Passive marker still retained private data");
  }
  if((method.equals("list")||method.equals("get"))&&!java.util.Objects.equals(before,slots.get(JOURNAL_SLOT)))
   throw new AssertionError("Reading changed the durable row");
  trace.step("call",observe(),method,address,candidate,injected);
 }

 private static void call(String method)throws Exception {call(method,"exact","exact","none");}

 private static void closePlugin()throws Exception {
  Method destroy=ActionJournalPlugin.class.getDeclaredMethod("handleOnDestroy");
  destroy.setAccessible(true);destroy.invoke(plugin);
 }

 private static void retire()throws Exception {closePlugin();live=false;trace.step("retire",observe());}

 private static void restart()throws Exception {
  closePlugin();
  var cached=AlphaActionJournal.class.getDeclaredField("instance");cached.setAccessible(true);cached.set(null,null);
  plugin=new AlphaActionJournalPlugin();live=true;process++;
  trace.step("restart",observe());
 }

 public static void main(String[] args)throws Exception {
  String scenario=args[0], phase=args[2];
  boolean attempt=Boolean.parseBoolean(args[3]), claim=Boolean.parseBoolean(args[4]);
  completeBinding=!scenario.startsWith("legacy-missing-binding");
  prepare(args[1],phase,attempt,claim);
  trace=new Trace(scenario,observe());
  trace.value.put("init",completeBinding?Trace.action("initWith",kind,phase,attempt,claim):
   Trace.action("initWithMetadata",kind,phase,attempt,claim,false));
  try {
   switch(scenario) {
    case "notice-recovered" -> {
     receipt("applying","exact",false);call("notice");
     receipt("unknown","exact",true);call("notice");call("notice");
     call("notice","exact","foreign","none");call("get");
    }
    case "notice-exact" -> {
     receipt("succeeded","exact",false);
     call("notice","scope","exact","none");call("notice","proposal","exact","none");
     call("notice","invalid","exact","none");call("notice","exact","foreign","none");call("notice");
    }
    case "notice-foreign-receipt" -> {receipt("succeeded","foreign",false);call("notice");}
    case "notice-changed-content" -> {receipt("succeeded","payload",false);call("notice");}
    case "notice-faults" -> {
     receipt("applying","exact",true);
     call("notice","exact","exact","journal-read");call("notice","exact","exact","notice-read");
     call("notice","exact","exact","notice-before");call("notice","exact","exact","notice-after");
     call("notice","exact","exact","journal-before");call("notice","exact","exact","journal-after");
     restart();call("notice");retire();call("notice");
    }
    case "notice-no-admission" -> {receipt("succeeded","exact",false);call("notice");}
    case "notice-uncertain" -> {receipt("unknown","exact",false);call("notice");}
    case "read-shapes" -> {call("list");call("get");call("list","scope","exact","none");call("get","proposal","exact","none");}
    case "wrong-type" -> {call("notice");call("reminder");call("deletion");}
    case "missing-entry" -> {call("get");call("list");call("notice");call("reminder");call("deletion");}
    case "reminder-recovered" -> {
     receipt("unknown","exact",false);call("reminder");receipt("succeeded","exact",false);
     call("reminder","exact","wrong","none");call("reminder","exact","exact","receipt-read");call("reminder");
     call("reminder","exact","wrong","none");call("list");call("get");
    }
    case "reminder-exact" -> {receipt("succeeded","exact",false);call("reminder");call("list");call("get");}
    case "reminder-foreign" -> {
     receipt("succeeded","foreign",false);call("reminder","exact","foreign","none");call("reminder");call("get");
     receipt("succeeded","exact",false);call("reminder");call("list");call("get");
    }
    case "reminder-cancel-exact" -> {receipt("deleted","exact",false);call("reminder");call("list");}
    case "legacy-missing-binding-settled" -> {call("reminder","exact","foreign","none");call("list");call("get");}
    case "legacy-missing-binding-applying" -> {receipt("succeeded","exact",false);call("reminder");call("get");}
    case "reminder-invalid-result" -> {receipt("succeeded","result",false);call("reminder");}
    case "reminder-legacy-no-attempt" -> {receipt("succeeded","exact",false);call("reminder");}
    case "reminder-no-admission" -> {receipt("succeeded","exact",false);call("reminder");}
    case "reminder-changed-operation" -> {receipt("succeeded","payload",false);call("reminder");}
    case "deletion-recovered" -> {receipt("deleted","exact",false);call("deletion");call("deletion");call("get");}
    case "deletion-mismatches" -> {
     call("deletion");
     for(String mismatch:new String[]{"owner","proposal","hash","target","operation","outcome"}){receipt("deleted",mismatch,false);call("deletion");}
     receipt("dispatching","exact",false);call("deletion");
     receipt("unknown","exact",false);call("deletion");
    }
    case "deletion-no-claim" -> {receipt("deleted","exact",false);call("deletion");}
    case "deletion-failed" -> {receipt(args[5],"exact",false);call("deletion");}
    case "deletion-reminder-uncertain" -> {
     for(String mismatch:new String[]{"effects","missing-result","payload","result"}){receipt("deleted",mismatch,false);call("deletion");}
     receipt("deleted","exact",false);call("deletion","exact","exact","receipt-read");call("deletion");
    }
    default -> throw new AssertionError(scenario);
   }
   java.lang.System.out.println(trace.value);
  } finally {closePlugin();}
 }
}
