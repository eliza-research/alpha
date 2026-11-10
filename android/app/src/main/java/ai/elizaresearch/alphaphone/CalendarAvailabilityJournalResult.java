package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.calendar.read.SelectedCalendarReader;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Journal policy for a foreground free/busy result. A shared answer may hold up to 200 busy
 * intervals, which is larger than the journal's default bound for an opaque result, so it has
 * its own shape check and size. Only the reviewed window, counts and busy times are retained:
 * any other field is refused, so calendar names and event content cannot be journaled.
 */
final class CalendarAvailabilityJournalResult {
 static final String TYPE="calendar_availability";
 /** 200 intervals of about 100 bytes each, plus the window and counts. */
 static final int MAX_BYTES=32768;
 private static final String INSTANT="[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z";
 private CalendarAvailabilityJournalResult(){}

 private static int whole(Object value,int minimum,int maximum){
  if(!(value instanceof Integer)&&!(value instanceof Long))throw new IllegalArgumentException("Invalid availability count");
  long number=((Number)value).longValue();
  if(number<minimum||number>maximum)throw new IllegalArgumentException("Invalid availability count");
  return (int)number;
 }
 private static String instant(Object value){
  if(!(value instanceof String)||!((String)value).matches(INSTANT))throw new IllegalArgumentException("Invalid availability instant");
  return (String)value;
 }
 /**
  * Refuses a terminal journal result that is not this operation's exact free/busy answer.
  * Success requires the answer; a failed, unknown or cancelled check must not retain one.
  */
 static void check(JSONObject operation,String operationId,String status,JSONObject result)throws Exception {
  if(operation==null||!TYPE.equals(operation.optString("type"))||operationId==null)throw new IllegalArgumentException("Not an availability entry");
  boolean succeeded="succeeded".equals(status);
  if(result==null){if(succeeded)throw new IllegalArgumentException("Availability result required");return;}
  JSONObject shared=result.optJSONObject("foregroundResult");
  if(result.length()!=(result.has("foregroundResult")?2:1)||!operationId.equals(result.optString("operationId")))throw new IllegalArgumentException("Unexpected availability journal fields");
  if(!succeeded){if(result.has("foregroundResult"))throw new IllegalArgumentException("An unconfirmed check cannot retain a result");return;}
  if(shared==null||shared.length()!=7||!(shared.opt("version") instanceof Number)||shared.getDouble("version")!=1||!TYPE.equals(shared.opt("kind")))throw new IllegalArgumentException("Invalid availability result");
  JSONObject window=shared.optJSONObject("window");
  if(window==null||window.length()!=3)throw new IllegalArgumentException("Invalid availability window");
  for(String key:new String[]{"start","end","timeZone"})
   if(!(operation.opt(key) instanceof String)||!operation.get(key).equals(window.opt(key)))throw new IllegalArgumentException("Availability window changed");
  whole(shared.opt("calendarCount"),1,SelectedCalendarReader.AVAILABILITY_SELECTED);
  whole(shared.opt("transparentIgnored"),0,SelectedCalendarReader.AVAILABILITY_EVENTS);
  JSONArray busy=shared.optJSONArray("busy");
  if(busy==null||busy.length()>SelectedCalendarReader.AVAILABILITY_EVENTS)throw new IllegalArgumentException("Invalid busy intervals");
  String start=instant(window.get("start")),end=instant(window.get("end")),previous="";
  for(int i=0;i<busy.length();i++){
   JSONObject interval=busy.optJSONObject(i);
   if(interval==null||interval.length()!=4||!(interval.opt("allDay") instanceof Boolean)||!(interval.opt("tentative") instanceof Boolean))throw new IllegalArgumentException("Invalid busy interval");
   // Fixed-width UTC instants order the same way as text and as time.
   String from=instant(interval.opt("start")),to=instant(interval.opt("end"));
   if(from.compareTo(start)<0||to.compareTo(end)>0||to.compareTo(from)<=0||from.compareTo(previous)<0)throw new IllegalArgumentException("Busy interval outside the reviewed window");
   previous=from;
  }
  if(!(busy.length()>0?"busy":"free").equals(shared.opt("status")))throw new IllegalArgumentException("Availability status changed");
  if(result.toString().getBytes(StandardCharsets.UTF_8).length>MAX_BYTES)throw new IllegalArgumentException("Availability result too large");
 }
}
