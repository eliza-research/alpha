package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import ai.eliza.plugins.calendar.CalendarEventGuard;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import org.json.JSONObject;

/** Native selection tickets and one review for versioned Calendar deletion scopes. */
final class CalendarScopedDeletionReview {
 private final AlphaCalendarPlugin plugin;
 private final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
 private final java.util.LinkedHashMap<String,Ticket> tickets=new java.util.LinkedHashMap<>();
 private final java.util.concurrent.atomic.AtomicBoolean reviewing=new java.util.concurrent.atomic.AtomicBoolean();
 private volatile boolean retired;private volatile long epoch;
 private android.app.AlertDialog dialog;
 private static final class Ticket {final JSONObject target;final long expires;Ticket(JSONObject target){this.target=target;expires=SystemClock.elapsedRealtime()+60000;}}
 CalendarScopedDeletionReview(AlphaCalendarPlugin plugin){this.plugin=plugin;}
 private static JSObject status(String value){JSObject result=new JSObject();result.put("status",value);return result;}
 private static boolean granted(Context context){return ContextCompat.checkSelfPermission(context,Manifest.permission.READ_CALENDAR)==PackageManager.PERMISSION_GRANTED&&ContextCompat.checkSelfPermission(context,Manifest.permission.WRITE_CALENDAR)==PackageManager.PERMISSION_GRANTED;}
 private boolean foreground(){android.app.Activity activity=plugin.getActivity();android.app.KeyguardManager lock=plugin.getContext().getSystemService(android.app.KeyguardManager.class);return !retired&&activity!=null&&!activity.isFinishing()&&!activity.isDestroyed()&&activity.hasWindowFocus()&&lock!=null&&!lock.isDeviceLocked();}
 private boolean reviewForeground(){return !retired&&dialog!=null&&dialog.isShowing()&&plugin.getActivity()!=null&&!plugin.getActivity().isFinishing()&&!plugin.getActivity().isDestroyed()&&plugin.getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)&&(plugin.getActivity().hasWindowFocus()||dialog.getWindow()!=null&&dialog.getWindow().getDecorView().hasWindowFocus())&&plugin.getContext().getSystemService(android.app.KeyguardManager.class)!=null&&!plugin.getContext().getSystemService(android.app.KeyguardManager.class).isDeviceLocked();}
 private synchronized boolean remember(JSONObject target,long generation)throws Exception{
  // Pause retires the generation under this same monitor.
  if(retired||generation!=epoch)return false;
  while(tickets.size()>=32)tickets.remove(tickets.keySet().iterator().next());
  tickets.put(key(target),new Ticket(new JSONObject(target.toString())));
  return true;
 }
 private static String key(JSONObject value){return value.optString("eventId")+"|"+value.optString("revision")+"|"+value.optString("sourceId")+"|"+value.optString("sourceRevision");}
 private synchronized JSONObject ticket(JSONObject requested)throws Exception{Ticket ticket=tickets.get(key(requested));if(ticket==null||SystemClock.elapsedRealtime()>ticket.expires)throw new IllegalStateException("Reopen the exact Calendar event before review");return new JSONObject(ticket.target.toString());}
 static JSONObject target(CalendarEventGuard.ScopedDeletion snapshot)throws Exception{
  String id="delete2:"+snapshot.eventId+":"+(snapshot.scope.equals("occurrence")?"occurrence:"+snapshot.originalInstanceTime:snapshot.scope);
  return new JSONObject().put("version",2).put("eventId",id).put("sourceId",Long.toString(snapshot.calendarId)).put("sourceRevision",snapshot.sourceRevision).put("revision",snapshot.revision).put("scope",snapshot.scope).put("providerEventId",snapshot.eventId).put("selectedEventId",snapshot.selectedEventId).put("originalInstanceTime",snapshot.originalInstanceTime).put("begin",snapshot.begin).put("end",snapshot.end).put("fields",snapshot.fields).put("account",snapshot.account()).put("local",snapshot.local()).put("organizer",snapshot.organizer()).put("attendeeCount",snapshot.attendeeCount());
 }
 private static CalendarEventGuard.ScopedDeletion read(Context context,JSONObject target)throws Exception{
  CalendarDeletionIdentity id=CalendarDeletionIdentity.parse(target.getString("eventId"));if(id.legacy||target.getInt("version")!=2||id.eventId!=target.getLong("providerEventId")||!id.scope.name().equalsIgnoreCase(target.getString("scope"))||id.originalInstanceTime!=target.getLong("originalInstanceTime"))throw new IllegalArgumentException("Deletion scope changed");
  return CalendarEventGuard.readScopedDeletion(context.getContentResolver(),id.eventId,Long.parseLong(target.getString("sourceId")),target.getString("scope"),id.originalInstanceTime,target.getLong("selectedEventId"),target.getLong("begin"),target.getLong("end"));
 }
 void inspect(PluginCall call){
  if(!granted(plugin.getContext())){call.resolve(status("permission-required"));return;}if(!foreground()){call.resolve(status("unavailable"));return;}
  final long generation=epoch;try{worker.execute(()->{try{
   JSONObject expected=call.getObject("expected");if(expected==null)throw new IllegalArgumentException();
   CalendarEventGuard.ScopedDeletion snapshot=CalendarEventGuard.selectScopedDeletion(plugin.getContext().getContentResolver(),Long.parseLong(call.getString("id","")),Long.parseLong(call.getString("calendarId","")),call.getString("scope"),expected.getLong("begin"),expected.getLong("end"));
   if(!snapshot.matchesVisible(expected)){call.resolve(status("conflict"));return;}if(generation!=epoch||!foreground()||!granted(plugin.getContext())){call.resolve(status("unavailable"));return;}
   JSONObject target=target(snapshot);if(!remember(target,generation)){call.resolve(status("unavailable"));return;}
   JSObject result=status("ready");result.put("eventId",target.getString("eventId"));result.put("revision",snapshot.revision);result.put("sourceRevision",snapshot.sourceRevision);result.put("sourceId",Long.toString(snapshot.calendarId));result.put("scope",snapshot.scope);call.resolve(result);
  }catch(UnsupportedOperationException external){call.resolve(status("external"));}catch(Exception changed){call.resolve(status("conflict"));}});}catch(java.util.concurrent.RejectedExecutionException closed){call.resolve(status("unavailable"));}
 }
 void review(PluginCall call,JSONObject operation){
  if(!granted(plugin.getContext())){call.resolve(status("permission-required"));return;}if(!foreground()){call.resolve(status("unavailable"));return;}if(!reviewing.compareAndSet(false,true)){call.resolve(status("busy"));return;}
  final long generation=epoch;try{worker.execute(()->{try{
   JSONObject requested=operation==null?call.getData():operation.getJSONObject("target"),target=ticket(requested);CalendarEventGuard.ScopedDeletion current=read(plugin.getContext(),target);
   if(!current.revision.equals(target.getString("revision"))||!current.sourceRevision.equals(target.getString("sourceRevision"))){reviewing.set(false);call.resolve(status("conflict"));return;}
   plugin.getActivity().runOnUiThread(()->{if(generation!=epoch){reviewing.set(false);call.resolve(status("cancelled"));return;}show(call,target,operation==null?null:call.getString("operationId"));});
  }catch(Exception unavailable){reviewing.set(false);call.resolve(status("conflict"));}});}catch(java.util.concurrent.RejectedExecutionException closed){reviewing.set(false);call.resolve(status("unavailable"));}
 }
 private void show(PluginCall call,JSONObject target,String operationId){
  if(!foreground()||!granted(plugin.getContext())){reviewing.set(false);call.resolve(status("cancelled"));return;}
  final JSObject[] outcome={null};final java.util.concurrent.atomic.AtomicBoolean settled=new java.util.concurrent.atomic.AtomicBoolean();
  try{
   JSONObject fields=target.getJSONObject("fields");String scope=target.getString("scope"),scopeText=scope.equals("series")?"Entire series":scope.equals("occurrence")?"This occurrence only":"This event";
   String message=fields.getString("title")+"\n"+fields.getString("start")+" — "+fields.getString("end")+"\nTime zone: "+fields.getString("timeZone")+"\n"+scopeText+"\nCalendar: "+target.getString("account");
   if(!target.optBoolean("local"))message+="\nThis may sync to your calendar service.";
   if(target.optInt("attendeeCount")>0)message+="\nGuests may be notified. Organizer: "+target.optString("organizer");
   message+="\n\nYou can undo for 10 seconds. Until then the event and its invitation are unchanged.";
   dialog=new android.app.AlertDialog.Builder(plugin.getActivity()).setTitle("Delete calendar event?").setMessage(message).setNegativeButton("Cancel",(d,w)->{}).setPositiveButton("Delete event",(d,w)->{
    if(!reviewForeground()||!granted(plugin.getContext())){outcome[0]=status("cancelled");return;}
    try{outcome[0]=plugin.enqueueReviewedDeletion(target,operationId);}catch(Exception uncertain){outcome[0]=status("unknown");}
   }).create();android.app.AlertDialog owned=dialog;
   owned.setOnDismissListener(d->{if(dialog==owned)dialog=null;reviewing.set(false);if(settled.compareAndSet(false,true))call.resolve(outcome[0]==null?status("cancelled"):outcome[0]);});owned.show();
  }catch(Exception unavailable){reviewing.set(false);if(settled.compareAndSet(false,true))call.resolve(status("unavailable"));}
 }
 void pause(){synchronized(this){epoch++;tickets.clear();}if(dialog!=null)dialog.dismiss();}
 void destroy(){retired=true;pause();worker.shutdown();}
 static JSONObject dispatch(Context context,JSONObject target){
  boolean dispatched=false;try{
   if(!granted(context))return new JSONObject().put("status","permission-required");
   CalendarEventGuard.ScopedDeletion current=read(context,target);if(!current.revision.equals(target.getString("revision"))||!current.sourceRevision.equals(target.getString("sourceRevision")))return new JSONObject().put("status","conflict");
   dispatched=true;current.dispatch(context.getContentResolver());return new JSONObject().put("status",current.deletionVerified(context.getContentResolver())?"deleted":"unknown");
  }catch(android.content.OperationApplicationException conflict){return status("conflict");}catch(Exception failure){return status(dispatched?"unknown":"conflict");}
 }
}
