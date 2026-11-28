// spec/app/calendar/sharing.md, "A check is asked only on Home or Calendar, while Alpha can be seen, on a screen that is not sensitive"
package ai.alphacompute.alphaphone;

import java.time.ZoneId;

/** Time-zone check for the foreground availability review (product-owned; not part of upstream
 * SelectedCalendarReader, which reads availability for a zone it is given). */
final class CalendarZones {
 private CalendarZones(){}
 /** True when the requested zone has the same rules as the phone's zone (aliases are equal). */
 static boolean sameZone(String requested,ZoneId device){
  try{return requested!=null&&ZoneId.of(requested).getRules().equals(device.getRules());}catch(Exception invalid){return false;}
 }
}
