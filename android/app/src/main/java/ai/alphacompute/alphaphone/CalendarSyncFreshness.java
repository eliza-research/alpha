package ai.alphacompute.alphaphone;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.provider.CalendarContract;
import ai.eliza.plugins.calendar.read.SelectedCalendarReader;
import java.time.ZoneId;
import org.json.JSONArray;

/**
 * Alpha's freshness gate in front of the pinned upstream SelectedCalendarReader availability
 * read. A successful query of a synced cache cannot establish remote availability: only
 * device-local calendars have no remote freshness dependency. When any selected calendar is not
 * device-local the whole read is refused before any instance is queried, so no partial
 * intervals from the remaining calendars are returned.
 *
 * {@link #readAvailability} is the provider part of AlphaCalendarPlugin.readAvailability, kept free
 * of Capacitor so the host JVM test runs this exact order. Permission, foreground, unlock and
 * time-zone checks stay in the plugin.
 */
final class CalendarSyncFreshness {
 /** CalendarProvider does not prove whether a remote calendar has finished syncing. */
 static final class FreshnessUnknown extends Exception {FreshnessUnknown(){super("Calendar sync freshness is unknown");}}
 private CalendarSyncFreshness(){}

 /** Throws {@link FreshnessUnknown} unless every selected calendar is a device-local calendar. */
 static void requireLocal(ContentResolver resolver,JSONArray selected)throws Exception {
  if(selected==null||selected.length()<1)throw new IllegalArgumentException("Invalid availability read");
  for(int i=0;i<selected.length();i++){
   String id=selected.getJSONObject(i).getString("id");
   if(!id.matches("[1-9][0-9]{0,18}"))throw new IllegalArgumentException("Invalid calendar selection");
   try(Cursor source=resolver.query(ContentUris.withAppendedId(CalendarContract.Calendars.CONTENT_URI,Long.parseLong(id)),
     new String[]{CalendarContract.Calendars.ACCOUNT_TYPE},null,null,null)){
    if(source==null||!source.moveToFirst()||!CalendarContract.ACCOUNT_TYPE_LOCAL.equals(source.getString(0))||source.moveToNext())throw new FreshnessUnknown();
   }
  }
 }
 /**
  * Source identity, then the freshness gate, then the pinned upstream read. A changed source is
  * reported as changed before freshness is judged; an unknown-freshness source refuses the whole
  * read before any instance is queried. A missing selection is refused by the freshness gate.
  */
 static JSONArray readAvailability(ContentResolver resolver,JSONArray selected,String start,String end,ZoneId zone)throws Exception {
  if(selected!=null)SelectedCalendarReader.assertSourceIdentities(resolver,selected);
  requireLocal(resolver,selected);
  return SelectedCalendarReader.readAvailability(resolver,selected,start,end,zone);
 }
}
