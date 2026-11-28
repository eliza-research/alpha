// spec/app/calendar/index.md; spec/app/calendar/sharing.md, "Story: Choose the calendars and see the answer before it is shared"
package ai.alphacompute.alphaphone;

import ai.eliza.plugins.calendar.CalendarConfiguration;
import ai.eliza.plugins.calendar.CalendarPlugin;
import ai.eliza.plugins.calendar.read.SelectedCalendarReader;
import android.Manifest;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

@CapacitorPlugin(name = "ElizaCalendar", permissions = {
 @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR }),
 @Permission(alias = "workflowCalendarRead", strings = { Manifest.permission.READ_CALENDAR })
})
public final class AlphaCalendarPlugin extends CalendarPlugin {
 static final CalendarConfiguration CONFIGURATION = new CalendarConfiguration(
  "Alpha Phone", "alpha-phone-local", "On this phone", "alpha-calendar-creations-v1", "alphaphone://calendar-creation/", 0xff0000ff, 2000);

 public AlphaCalendarPlugin() { super(CONFIGURATION); }

 private static JSObject status(String value){JSObject out=new JSObject();out.put("status",value);return out;}
 private boolean readGranted(){return androidx.core.content.ContextCompat.checkSelfPermission(getContext(),Manifest.permission.READ_CALENDAR)==android.content.pm.PackageManager.PERMISSION_GRANTED;}
 private boolean foreground(){return getActivity()!=null&&!getActivity().isFinishing()&&!getActivity().isDestroyed()&&getActivity().hasWindowFocus();}
 private boolean unlocked(){android.app.KeyguardManager keyguard=(android.app.KeyguardManager)getContext().getSystemService(android.content.Context.KEYGUARD_SERVICE);return keyguard!=null&&!keyguard.isDeviceLocked();}
 /**
  * Calendars the owner may choose for one foreground free/busy check: each one this app may read
  * at free/busy level or above, with its name, account and source revision for the on-phone
  * sheet, and no event. Read permission, the unlocked foreground Activity and the requested time
  * zone are all required. Statuses: ready, permission-required, timezone-changed, unavailable.
  */
 @PluginMethod public void availabilitySources(PluginCall c){
  if(!readGranted()){c.resolve(status("permission-required"));return;}
  if(!foreground()||!unlocked()){c.resolve(status("unavailable"));return;}
  String zone=c.getString("timeZone");
  if(!CalendarZones.sameZone(zone,java.time.ZoneId.systemDefault())){c.resolve(status("timezone-changed"));return;}
  try{
   org.json.JSONArray calendars=SelectedCalendarReader.availabilitySources(getContext().getContentResolver());
   if(!readGranted()||!foreground()||!unlocked())throw new IllegalStateException();
   JSObject out=status("ready");out.put("timeZone",zone);out.put("calendars",calendars);c.resolve(out);
  }catch(Exception unavailable){c.resolve(status("unavailable"));}
 }
 /**
  * Free/busy rows of exactly the calendars the owner chose, bound to the source revisions they
  * reviewed, and only when every one lives on this phone. Returns intervals and availability
  * only, never event content. Statuses: ready, permission-required, timezone-changed, changed,
  * too-many, unavailable, freshness-unknown.
  */
 @PluginMethod public void readAvailability(PluginCall c){
  if(!readGranted()){c.resolve(status("permission-required"));return;}
  if(!foreground()||!unlocked()){c.resolve(status("unavailable"));return;}
  java.time.ZoneId zone=java.time.ZoneId.systemDefault();
  if(!CalendarZones.sameZone(c.getString("timeZone"),zone)){c.resolve(status("timezone-changed"));return;}
  try{
   JSArray chosen=c.getArray("calendars");
   org.json.JSONArray selected=chosen==null?null:new org.json.JSONArray(chosen.toString());
   org.json.JSONArray events=CalendarSyncFreshness.readAvailability(getContext().getContentResolver(),selected,c.getString("start"),c.getString("end"),zone);
   if(!readGranted()||!foreground()||!unlocked())throw new IllegalStateException();
   if(!java.time.ZoneId.systemDefault().equals(zone)){c.resolve(status("timezone-changed"));return;}
   JSObject out=status("ready");out.put("freshness","local");out.put("events",events);c.resolve(out);
  }catch(SelectedCalendarReader.SourceChanged changed){c.resolve(status("changed"));}
  catch(CalendarSyncFreshness.FreshnessUnknown unknown){c.resolve(status("freshness-unknown"));}
  catch(SelectedCalendarReader.TooMany bound){c.resolve(status("too-many"));}
  catch(Exception unavailable){c.resolve(status("unavailable"));}
 }
}
