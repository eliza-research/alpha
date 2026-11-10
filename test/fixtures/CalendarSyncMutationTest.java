package ai.elizaresearch.alphaphone;
import android.content.*;import org.json.*;import java.util.*;
public final class CalendarSyncMutationTest {
 static void check(boolean value){if(!value)throw new AssertionError();}
 interface Checked{void run()throws Exception;}
 static void refuses(Checked action)throws Exception{try{action.run();throw new AssertionError("Expected refusal");}catch(IllegalArgumentException|IllegalStateException|UnsupportedOperationException expected){}}
 static CalendarSyncSnapshotTest.Provider provider(){var provider=new CalendarSyncSnapshotTest.Provider();provider.events.get(0).put("rrule","FREQ=DAILY");provider.events.get(0).remove("exdate");provider.events.get(0).put("hasAttendeeData",1L);provider.events.get(0).put("hasAlarm",1L);provider.attendees.get(0).put("attendeeType",1L);provider.attendees.get(0).put("attendeeRelationship",1L);return provider;}
 static CalendarSyncSnapshot read(CalendarSyncSnapshotTest.Provider provider)throws Exception{return CalendarSyncSnapshotTest.read(provider);}
 static List<ContentProviderOperation> writes(ArrayList<ContentProviderOperation> plan){var values=new ArrayList<ContentProviderOperation>();for(var operation:plan)if(!operation.type.equals("assert"))values.add(operation);return values;}
 public static void main(String[] args)throws Exception{
  var provider=provider();var before=read(provider);JSONObject event=before.semantic();check(event.getBoolean("isAllDay"));check(event.getJSONArray("attendees").getJSONObject(0).getString("email").equals("fixture@example.invalid"));
  event.put("title","Changed title");var patch=writes(CalendarSyncMutation.plan(before,before.revision,event));check(patch.size()==1&&patch.get(0).type.equals("update")&&patch.get(0).uri.value.equals("events/42")&&patch.get(0).values.size()==1&&patch.get(0).values.getAsString("title").equals("Changed title"));
  check(provider.attendees.get(0).get("attendeeStatus").equals(1L));check(provider.reminders.get(0).get("minutes").equals(15L));check(provider.properties.get(0).get("value").equals("preserve-private-metadata"));
  event=before.semantic();event.getJSONArray("attendees").getJSONObject(0).put("optional",true);patch=writes(CalendarSyncMutation.plan(before,before.revision,event));check(patch.size()==1&&patch.get(0).uri.value.equals("attendees/8")&&patch.get(0).values.size()==1&&patch.get(0).values.getAsLong("attendeeType")==2);
  final JSONObject rejected=before.semantic();refuses(()->CalendarSyncMutation.plan(before,"stale",rejected));rejected.put("conferenceData",new JSONObject());refuses(()->CalendarSyncMutation.plan(before,before.revision,rejected));
  JSONObject unsupported=before.semantic().put("recurrence",new JSONArray().put("RRULE:FREQ=DAILY").put("EXRULE:FREQ=WEEKLY"));refuses(()->CalendarSyncMutation.plan(before,before.revision,unsupported));
  JSONObject changedRule=before.semantic().put("recurrence",new JSONArray().put("RRULE:FREQ=WEEKLY").put("EXDATE;VALUE=DATE:19700108"));patch=writes(CalendarSyncMutation.plan(before,before.revision,changedRule));check(patch.size()==1&&patch.get(0).values.getAsString("rrule").equals("FREQ=WEEKLY")&&patch.get(0).values.getAsString("duration").equals("P1D")&&patch.get(0).values.getAsString("exdate").equals("19700108")&&patch.get(0).values.get("dtend")==null);
  JSONObject noGuests=before.semantic().put("attendees",new JSONArray());patch=writes(CalendarSyncMutation.plan(before,before.revision,noGuests));check(patch.size()==2&&patch.stream().anyMatch(op->op.type.equals("delete")&&op.uri.value.equals("attendees/8")&&op.count==1));
  JSONObject timed=before.semantic().put("isAllDay",false).put("timeZone","UTC").put("startAt","2026-10-15T12:00:00.000Z").put("endAt","2026-10-15T13:00:00.000Z").put("recurrence",new JSONArray());patch=writes(CalendarSyncMutation.plan(before,before.revision,timed));check(patch.get(0).values.getAsLong("allDay")==0&&patch.get(0).values.get("duration")==null&&patch.get(0).values.get("rrule")==null&&patch.get(0).values.getAsLong("dtend")>patch.get(0).values.getAsLong("dtstart"));
  JSONObject sameTime=new JSONObject(timed.toString()).put("startAt","2026-10-15T12:00:00Z").put("endAt","2026-10-15T13:00:00Z");check(CalendarSyncMutation.equivalent(timed,sameTime));
  provider.events.add(CalendarSyncSnapshotTest.row("_id",43L,"calendar_id",7L,"original_id",42L));var family=read(provider);refuses(()->CalendarSyncMutation.plan(family,family.revision,timed));
  System.out.println("PASS conditional Calendar mutation plans preserve alerts, RSVP and metadata");
 }
}
