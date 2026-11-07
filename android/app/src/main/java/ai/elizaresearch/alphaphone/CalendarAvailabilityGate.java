package ai.elizaresearch.alphaphone;

import android.content.ContentResolver;
import ai.eliza.plugins.calendar.read.SelectedCalendarReader;
import java.time.ZoneId;
import org.json.JSONArray;

/**
 * The provider part of AlphaCalendarPlugin.readAvailability, kept free of Capacitor so the host
 * JVM test runs this exact order: source identity, then Alpha's freshness gate, then the pinned
 * upstream read. Permission, foreground, unlock and time-zone checks stay in the plugin.
 */
final class CalendarAvailabilityGate {
 private CalendarAvailabilityGate(){}

 static JSONArray read(ContentResolver resolver,JSONArray selected,String start,String end,ZoneId zone)throws Exception {
  // A changed source is reported as changed before freshness is judged; an unknown-freshness
  // source refuses the whole read before any instance is queried. A missing selection is
  // refused by the freshness gate.
  if(selected!=null)SelectedCalendarReader.assertSourceIdentities(resolver,selected);
  CalendarSyncFreshness.requireLocal(resolver,selected);
  return SelectedCalendarReader.readAvailability(resolver,selected,start,end,zone);
 }
}
