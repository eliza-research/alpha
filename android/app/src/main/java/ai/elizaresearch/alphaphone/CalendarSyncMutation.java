package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal;

import android.content.ContentProviderOperation;
import android.content.ContentUris;
import android.content.ContentValues;
import android.provider.CalendarContract;
import ai.eliza.plugins.calendar.write.CalendarEventOptions;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** A conditional rich-event mutation plan. The bridge owns consent, lifecycle, the durable
 * dispatch claim and readback. Alerts, RSVP and provider metadata are never reconstructed. */
final class CalendarSyncMutation {
 private CalendarSyncMutation(){}
 private static String text(JSONObject value,String key){Object raw=value.opt(key);if(!(raw instanceof String))throw new IllegalArgumentException("Invalid Calendar "+key);return (String)raw;}
 private static long instant(String value,boolean allDay){return allDay?LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli():Instant.parse(value).toEpochMilli();}
 static ArrayList<ContentProviderOperation> plan(CalendarSyncSnapshot before,String expectedRevision,JSONObject event)throws Exception{
  if(!before.revision.equals(expectedRevision)||before.missing||before.deleted)throw new IllegalStateException("Calendar event changed");
  Set<String> allowed=Set.of("title","description","location","startAt","endAt","timeZone","isAllDay","attendees","recurrence");
  if(event.length()<8||event.length()>9)throw new IllegalArgumentException("Invalid Calendar event");
  for(var keys=event.keys();keys.hasNext();)if(!allowed.contains(keys.next()))throw new IllegalArgumentException("Unknown Calendar event field");
  if(!(event.opt("isAllDay") instanceof Boolean))throw new IllegalArgumentException("Invalid Calendar all-day flag");
  JSONObject previous=before.semantic(); // Reject exception families rather than dropping their state.
  boolean allDay=event.getBoolean("isAllDay");
  String zone=allDay?"UTC":text(event,"timeZone"),rrule="",exdate="";
  if(allDay&&event.has("timeZone")&&!event.isNull("timeZone"))throw new IllegalArgumentException("All-day events use civil dates");
  JSONArray recurrence=event.optJSONArray("recurrence");if(recurrence==null)recurrence=new JSONArray();
  if(recurrence.length()>2)throw new UnsupportedOperationException("Review unsupported Calendar recurrence");
  for(int i=0;i<recurrence.length();i++){
   String line=recurrence.getString(i);
   if(line.startsWith("RRULE:")&&rrule.isEmpty())rrule=line.substring(6);
   else if(line.startsWith(allDay?"EXDATE;VALUE=DATE:":"EXDATE:")&&exdate.isEmpty()){
    exdate=line.substring(line.indexOf(':')+1);if(exdate.length()>16000)throw new IllegalArgumentException("Too many excluded dates");
    for(String date:exdate.split(",",-1)){if(allDay){if(!date.matches("[0-9]{8}"))throw new IllegalArgumentException("Invalid excluded date");LocalDate.parse(date,java.time.format.DateTimeFormatter.BASIC_ISO_DATE);}else{if(!date.matches("[0-9]{8}T[0-9]{6}Z"))throw new IllegalArgumentException("Invalid excluded date");Instant.from(java.time.format.DateTimeFormatter.ofPattern("uuuuMMdd'T'HHmmssX",java.util.Locale.ROOT).withResolverStyle(java.time.format.ResolverStyle.STRICT).parse(date));}}
   }else throw new UnsupportedOperationException("Review unsupported Calendar recurrence");
  }
  if(rrule.isEmpty()&&!exdate.isEmpty())throw new IllegalArgumentException("Excluded dates require a recurrence rule");
  JSONObject options=new JSONObject().put("title",text(event,"title")).put("body",text(event,"description")).put("location",text(event,"location")).put("begin",instant(text(event,"startAt"),allDay)).put("end",instant(text(event,"endAt"),allDay)).put("allDay",allDay).put("timeZone",zone).put("rrule",rrule);
  CalendarEventOptions validated=CalendarEventOptions.parse(options);
  if(!validated.title.equals(event.getString("title")))throw new IllegalArgumentException("Review whitespace in the Calendar title");
  ContentValues changes=new ContentValues();
  for(String[] fields:new String[][]{{"title","title"},{"description","description"},{"location","eventLocation"}})if(!event.getString(fields[0]).equals(previous.getString(fields[0])))changes.put(fields[1],event.getString(fields[0]));
  boolean timeChanged=allDay!=previous.getBoolean("isAllDay")||validated.begin!=instant(previous.getString("startAt"),previous.getBoolean("isAllDay"))||validated.end!=instant(previous.getString("endAt"),previous.getBoolean("isAllDay"))||!event.optString("timeZone","").equals(previous.optString("timeZone",""));
  boolean repeatChanged=!sameLines(recurrence,previous.getJSONArray("recurrence"));
  if(timeChanged||repeatChanged){
   // Supplying the whole timing group keeps CalendarProvider's recurrence expansion coherent.
   changes.put("dtstart",validated.begin);changes.put("allDay",allDay?1L:0L);changes.put("eventTimezone",zone);
   if(rrule.isEmpty()){changes.put("dtend",validated.end);changes.putNull("duration");changes.putNull("rrule");}
   else{changes.putNull("dtend");changes.put("duration",allDay?"P"+(validated.end-validated.begin)/86400000L+"D":"PT"+(validated.end-validated.begin)/1000L+"S");changes.put("rrule",rrule);}
   if(repeatChanged){changes.putNull("rdate");changes.putNull("exrule");if(exdate.isEmpty())changes.putNull("exdate");else changes.put("exdate",exdate);}
  }
  JSONArray requested=event.getJSONArray("attendees");if(requested.length()>100)throw new IllegalArgumentException("Review the Calendar guest list");
  Map<String,ContentValues> existing=new HashMap<>();Set<String> organizers=new HashSet<>();
  for(ContentValues guest:before.attendees){String email=guest.getAsString("attendeeEmail");if(email==null)throw new UnsupportedOperationException("Review Calendar guest identities");email=email.toLowerCase(java.util.Locale.ROOT);if(Long.valueOf(2).equals(guest.getAsLong("attendeeRelationship")))organizers.add(email);else existing.put(email,guest);}
  long hasGuests=requested.length()>0||!organizers.isEmpty()?1L:0L;
  if(!Long.valueOf(hasGuests).equals(before.parent().getAsLong("hasAttendeeData")))changes.put("hasAttendeeData",hasGuests);
  ArrayList<ContentProviderOperation> result=before.assertions();
  if(changes.size()>0)result.add(ContentProviderOperation.newUpdate(ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI,before.eventId)).withValues(changes).withExpectedCount(1).build());
  Set<String> seen=new HashSet<>();
  for(int i=0;i<requested.length();i++){
   JSONObject guest=requested.getJSONObject(i);if(guest.length()!=2||!(guest.opt("optional") instanceof Boolean))throw new IllegalArgumentException("Invalid Calendar guest");
   String email=text(guest,"email").toLowerCase(java.util.Locale.ROOT);if(email.length()>320||!email.matches("[^\\s@,;<>]+@[^\\s@,;<>]+\\.[^\\s@,;<>]+")||!seen.add(email)||organizers.contains(email))throw new IllegalArgumentException("Invalid Calendar guest email");
   long type=guest.getBoolean("optional")?2L:1L;ContentValues old=existing.remove(email);
   if(old!=null){if((Long.valueOf(2).equals(old.getAsLong("attendeeType")))!=guest.getBoolean("optional")){ContentValues patch=new ContentValues();patch.put("attendeeType",type);result.add(ContentProviderOperation.newUpdate(ContentUris.withAppendedId(CalendarContract.Attendees.CONTENT_URI,old.getAsLong("_id"))).withValues(patch).withExpectedCount(1).build());}}
   else{ContentValues added=new ContentValues();added.put("event_id",before.eventId);added.put("attendeeEmail",email);added.put("attendeeType",type);added.put("attendeeRelationship",1L);added.put("attendeeStatus",0L);result.add(ContentProviderOperation.newInsert(CalendarContract.Attendees.CONTENT_URI).withValues(added).build());}
  }
  for(ContentValues removed:existing.values())result.add(ContentProviderOperation.newDelete(ContentUris.withAppendedId(CalendarContract.Attendees.CONTENT_URI,removed.getAsLong("_id"))).withExpectedCount(1).build());
  return result;
 }
 static boolean equivalent(JSONObject left,JSONObject right)throws Exception{return DeferredDeletionJournal.same(normalized(left),normalized(right));}
 static JSONObject normalized(JSONObject event)throws Exception{
  JSONObject copy=new JSONObject(event.toString());boolean allDay=copy.getBoolean("isAllDay");
  if(!allDay){copy.put("startAt",Instant.ofEpochMilli(instant(copy.getString("startAt"),false)).toString());copy.put("endAt",Instant.ofEpochMilli(instant(copy.getString("endAt"),false)).toString());}
  else copy.put("timeZone",JSONObject.NULL);
  JSONArray guests=copy.getJSONArray("attendees");List<JSONObject> ordered=new ArrayList<>();for(int i=0;i<guests.length();i++){JSONObject guest=guests.getJSONObject(i);ordered.add(new JSONObject().put("email",guest.getString("email").toLowerCase(java.util.Locale.ROOT)).put("optional",guest.getBoolean("optional")));}ordered.sort(java.util.Comparator.comparing(value->value.optString("email")));copy.put("attendees",new JSONArray(ordered));
  JSONArray recurrence=copy.optJSONArray("recurrence");List<String> lines=new ArrayList<>();if(recurrence!=null)for(int i=0;i<recurrence.length();i++){String line=recurrence.getString(i);if(line.startsWith("RRULE:")){String[] fields=line.substring(6).split(";");java.util.Arrays.sort(fields);line="RRULE:"+String.join(";",fields);}else if(line.startsWith("EXDATE")){int colon=line.indexOf(':');String[] dates=line.substring(colon+1).split(",");java.util.Arrays.sort(dates);line=line.substring(0,colon+1)+String.join(",",dates);}lines.add(line);}java.util.Collections.sort(lines);copy.put("recurrence",new JSONArray(lines));return copy;
 }
 private static boolean sameLines(JSONArray left,JSONArray right)throws Exception{List<String> a=new ArrayList<>(),b=new ArrayList<>();for(int i=0;i<left.length();i++)a.add(left.getString(i));for(int i=0;i<right.length();i++)b.add(right.getString(i));java.util.Collections.sort(a);java.util.Collections.sort(b);return a.equals(b);}
}
