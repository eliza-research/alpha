package ai.elizaresearch.alphaphone;

import android.content.Context;
import ai.eliza.plugins.actionjournal.ActionJournal;
import ai.eliza.plugins.actionjournal.ActionJournalConfiguration;
import java.util.Set;
import org.json.JSONObject;
import static ai.eliza.plugins.actionjournal.ActionJournal.sameJson;

/** Installed slot identity and product result policy for the shared journal. */
final class AlphaActionJournal {
 private static ActionJournal instance;
 static synchronized ActionJournal get(Context context) {
  if(instance==null){
   AlphaCredentialStore store=new AlphaCredentialStore(context.getApplicationContext());
   instance=new ActionJournal(ActionJournalConfiguration.standard("action-journal:v1"),new ActionJournal.Storage(){
    public String read(String slot)throws Exception{return store.readCredentialSlot(slot);}
    public void write(String slot,String value)throws Exception{store.writeCredentialSlot(slot,value);}
   },new ActionJournal.ResultPolicy(){
    public void check(JSONObject entry,String status,JSONObject result)throws Exception{checkResult(entry,status,result);}
    public JSONObject listView(JSONObject saved)throws Exception{
     JSONObject entry=new JSONObject(saved.toString());
   // Passive history never expands every retained private read payload. Explicit
   // receipt recovery calls get() for one exact journal entry at a time.
   JSONObject result=entry.optJSONObject("result");if(result!=null&&result.has("readResult")){JSONObject summary=new JSONObject(result.toString());summary.remove("readResult");summary.put("readResultRetained",true);entry.put("result",summary);}if(result!=null&&result.optJSONObject("calendarResult")!=null&&result.getJSONObject("calendarResult").has("fields")){JSONObject summary=new JSONObject(result.toString());summary.getJSONObject("calendarResult").remove("fields");summary.put("calendarReadRetained",true);entry.put("result",summary);}if(result!=null&&result.optJSONObject("notesResult")!=null){JSONObject summary=new JSONObject(result.toString()),note=summary.getJSONObject("notesResult");if(note.has("fields")){note.remove("fields");summary.put("notesReadRetained",true);entry.put("result",summary);}else if(note.optJSONObject("record")!=null&&note.getJSONObject("record").has("fields")){note.getJSONObject("record").remove("fields");summary.put("notesReadRetained",true);entry.put("result",summary);}}if(result!=null&&result.optJSONObject("mapsResult")!=null){JSONObject summary=new JSONObject(result.toString());summary.remove("mapsResult");summary.put("mapsReadRetained",true);entry.put("result",summary);}
     return entry;
    }
   });
  }
  return instance;
 }
 static void checkResult(JSONObject entry,String status,JSONObject result)throws Exception{
  JSONObject retainedOperation=entry.getJSONObject("record").optJSONObject("operation");
  if(retainedOperation!=null&&"sms_send".equals(retainedOperation.optString("type"))){SmsActionJournalResult.check(entry,status,result);return;}
  // A free/busy answer holds up to 200 busy intervals: it has its own exact shape and bound.
  if(retainedOperation!=null&&CalendarAvailabilityJournalResult.TYPE.equals(retainedOperation.optString("type"))){CalendarAvailabilityJournalResult.check(retainedOperation,entry.getString("operationId"),status,result);return;}
  if("succeeded".equals(status)&&entry.getJSONObject("record").has("workflow")&&retainedOperation!=null&&Set.of("read_selected_notes","read_calendar_range","read_selected_reminders").contains(retainedOperation.optString("type"))&&result==null)throw new IllegalArgumentException();
  if("succeeded".equals(status)&&retainedOperation!=null&&Set.of("calendar_create_local","calendar_read_next","clock_handoff","maps_read_selected","photo_library_search","photo_library_inspect","photo_library_select","photo_library_review","photos_filter","photos_open","photos_album_create","photos_share","notes_read_selected","notes_query","notes_update","notes_delete","reminder_create","reminder_read_selected","reminder_update","reminder_complete","reminder_snooze","reminder_cancel").contains(retainedOperation.optString("type"))&&result==null)throw new IllegalArgumentException();
  if(result!=null){
   JSONObject record=entry.getJSONObject("record"),operation=record.optJSONObject("operation");String type=operation==null?"":operation.optString("type");boolean workflowRead=record.has("workflow")&&Set.of("read_selected_notes","read_calendar_range","read_selected_reminders").contains(type);
   if("clock_handoff".equals(type)){
    if(result.length()!=(result.has("clockResult")?2:1)||!entry.getString("operationId").equals(result.optString("operationId")))throw new IllegalArgumentException();
    JSONObject clock=result.optJSONObject("clockResult");
    if(clock==null){if("succeeded".equals(status))throw new IllegalArgumentException();}
    else{
     String outcome=clock.optString("status");
     if(clock.length()!=3||!"clock-handoff".equals(clock.optString("kind"))||!operation.optString("action").equals(clock.optString("action"))||!Set.of("opened","unavailable","denied","failed","unknown").contains(outcome))throw new IllegalArgumentException();
     String expected="opened".equals(outcome)?"succeeded":"unknown".equals(outcome)?"unknown":"failed";
     if(!expected.equals(status))throw new IllegalArgumentException();
    }
   }else if("maps_read_selected".equals(type)){
    if(result.length()!=(result.has("mapsResult")?2:1)||!entry.getString("operationId").equals(result.optString("operationId")))throw new IllegalArgumentException();
    JSONObject maps=result.optJSONObject("mapsResult");
    if("succeeded".equals(status)){if(maps==null||maps.length()!=4||!type.equals(maps.optString("kind"))||maps.optInt("version")!=1||maps.optJSONObject("fields")==null||!sameJson(operation.optJSONObject("target"),maps.optJSONObject("target")))throw new IllegalArgumentException();}
    else if(maps!=null)throw new IllegalArgumentException();
    if(result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>8000)throw new IllegalArgumentException();
   }else if(Set.of("reminder_create","reminder_read_selected","reminder_update","reminder_complete","reminder_snooze","reminder_cancel").contains(type)){
    if(result.length()!=(result.has("reminderResult")?2:1)||!entry.getString("operationId").equals(result.optString("operationId")))throw new IllegalArgumentException();
    JSONObject reminder=result.optJSONObject("reminderResult");if("succeeded".equals(status)){if(reminder==null||!type.equals(reminder.optString("kind"))||reminder.optInt("version")!=1)throw new IllegalArgumentException();}else if(reminder!=null)throw new IllegalArgumentException();
    if("reminder_create".equals(type)&&reminder!=null){
     JSONObject fields=operation.getJSONObject("fields"),schedule=fields.getJSONObject("schedule");
     if(reminder.length()!=11||!entry.getString("operationId").equals(reminder.optString("reminderId"))||!sameJson(fields,reminder.optJSONObject("fields"))||!sameJson(schedule.get("at"),reminder.opt("at"))||!sameJson(schedule.get("dueAt"),reminder.opt("dueAt"))||!sameJson(schedule.get("alertMinutes"),reminder.opt("alertMinutes")))throw new IllegalArgumentException();
     if(!(reminder.opt("version") instanceof Number)||reminder.getDouble("version")!=1||!(reminder.opt("revision") instanceof String)||!reminder.getString("revision").matches("[a-f0-9]{64}"))throw new IllegalArgumentException();
     for(String identity:new String[]{"sourceId","reminderId","occurrenceId"})if(!(reminder.opt(identity) instanceof String)||!reminder.getString(identity).matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}"))throw new IllegalArgumentException();
     if(schedule.isNull("alertMinutes")?!"pending".equals(reminder.optString("status")):!Set.of("scheduled","permission-denied","scheduling-failed").contains(reminder.optString("status")))throw new IllegalArgumentException();
    }
    if(result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>32768)throw new IllegalArgumentException();
   }else if(Set.of("notes_read_selected","notes_query","notes_update","notes_delete").contains(type)){
    if(result.length()!=(result.has("notesResult")?2:1)||!entry.getString("operationId").equals(result.optString("operationId")))throw new IllegalArgumentException();
    JSONObject note=result.optJSONObject("notesResult");if("succeeded".equals(status)){if(note==null||!type.equals(note.optString("kind"))||note.optInt("version")!=1)throw new IllegalArgumentException();}else if(note!=null)throw new IllegalArgumentException();
    if("notes_query".equals(type)&&note!=null){if(!sameJson(operation.getJSONObject("query"),note.getJSONObject("query")))throw new IllegalArgumentException();if("no-match".equals(note.optString("basis"))){if(note.length()!=4||note.has("target")||note.has("record"))throw new IllegalArgumentException();}else if(note.length()!=6||note.optJSONObject("target")==null||note.optJSONObject("record")==null||!"notes_read_selected".equals(note.getJSONObject("record").optString("kind")))throw new IllegalArgumentException();}
    if(result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>150000)throw new IllegalArgumentException();
   }else if(Set.of("calendar_create_local","calendar_read_next","calendar_create","calendar_read_selected","calendar_update","calendar_delete").contains(type)){
    if(result.length()!=(result.has("calendarResult")?2:1)||!entry.getString("operationId").equals(result.optString("operationId")))throw new IllegalArgumentException();
    JSONObject calendar=result.optJSONObject("calendarResult");if("succeeded".equals(status)){if(calendar==null||!type.equals(calendar.optString("kind"))||calendar.optInt("version")!=1)throw new IllegalArgumentException();}else if(calendar!=null)throw new IllegalArgumentException();
    if(result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>80000)throw new IllegalArgumentException();
   }else if(Set.of("photo_library_search","photo_library_inspect","photo_library_select","photo_library_review","photos_filter","photos_open","photos_album_create","photos_share").contains(type)){
    // Photo library results (issue 408) and Photos view results (photos.view.v1, carried in photoLibraryResult):
    // identity-only rows or counts, validated in photo-library.ts / photos-view-contract.ts; here only shape and bound.
    if(result.length()!=(result.has("photoLibraryResult")?2:1)||!entry.getString("operationId").equals(result.optString("operationId")))throw new IllegalArgumentException();
    JSONObject library=result.optJSONObject("photoLibraryResult");if("succeeded".equals(status)){if(library==null||!type.equals(library.optString("kind")))throw new IllegalArgumentException();}else if(library!=null)throw new IllegalArgumentException();
    if(result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>16000)throw new IllegalArgumentException();
   }else if(workflowRead){
    if(result.length()!=(result.has("readResult")?2:1)||!entry.getString("operationId").equals(result.optString("operationId")))throw new IllegalArgumentException();
    JSONObject read=result.optJSONObject("readResult");
    if("succeeded".equals(status)){if(read==null||read.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>65536)throw new IllegalArgumentException();}
    else if(result.has("readResult"))throw new IllegalArgumentException();
    if(result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>66048)throw new IllegalArgumentException();
   }else if(result.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>8000||result.has("readResult"))throw new IllegalArgumentException();
  }
 }
}
