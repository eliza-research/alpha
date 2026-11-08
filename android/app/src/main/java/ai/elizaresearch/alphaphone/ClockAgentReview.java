package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.clock.ClockDays;
import ai.eliza.plugins.system.clock.ClockHandoff;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.provider.AlarmClock;
import com.getcapacitor.JSObject;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import org.json.JSONObject;

/** Agent requests are owner-reviewed handoffs. Targetless dismiss/snooze never mutate alarms. */
final class ClockAgentReview {
 private static final Map<String,AlertDialog> dialogs=new HashMap<>();
 private static final Map<String,Decision> pending=new HashMap<>();
 interface Decision {void selected(boolean accepted);}
 private ClockAgentReview(){}
 static JSObject result(String action,String status){JSObject value=new JSObject();value.put("kind","clock-handoff");value.put("action",action);value.put("status",status);return value;}
 static void validate(JSONObject operation)throws Exception{
  String action=operation.getString("action");Set<String> keys;
  switch(action){
   case "set":keys=operation.has("days")?Set.of("type","action","hour","minute","label","timeZone","days"):Set.of("type","action","hour","minute","label","timeZone");break;
   case "snooze":keys=Set.of("type","action","snoozeMinutes");break;
   case "show":case "dismiss":keys=Set.of("type","action");break;
   default:throw new IllegalArgumentException();
  }
  if(!"clock_handoff".equals(operation.getString("type"))||operation.length()!=keys.size())throw new IllegalArgumentException();
  java.util.Iterator<String> names=operation.keys();while(names.hasNext())if(!keys.contains(names.next()))throw new IllegalArgumentException();
  if("set".equals(action)){
   integer(operation,"hour",0,23);integer(operation,"minute",0,59);
   if(!(operation.get("label") instanceof String)||operation.getString("label").length()>200)throw new IllegalArgumentException();
   for(char c:operation.getString("label").toCharArray())if(c<32||c==127)throw new IllegalArgumentException();
   if(!(operation.get("timeZone") instanceof String)||operation.getString("timeZone").length()>100)throw new IllegalArgumentException();
   // Upstream admits unordered days and an explicit empty list (a one-time alarm); see the shared ClockDays.agent.
   if(operation.has("days"))ClockDays.agent(operation.get("days"));
  }
  if("snooze".equals(action))integer(operation,"snoozeMinutes",1,60);
 }
 private static int integer(JSONObject object,String key,int min,int max)throws Exception{
  Object value=object.get(key);if(!(value instanceof Number))throw new IllegalArgumentException();double n=((Number)value).doubleValue();if(!Double.isFinite(n)||n!=Math.rint(n)||n<min||n>max)throw new IllegalArgumentException();return (int)n;
 }
 static void foreground(Activity activity){
  if(activity==null||activity.isFinishing()||activity.isDestroyed()||!activity.hasWindowFocus())throw new IllegalStateException();
  KeyguardManager keyguard=(KeyguardManager)activity.getSystemService(Context.KEYGUARD_SERVICE);if(keyguard==null||keyguard.isKeyguardLocked())throw new IllegalStateException();
 }
 static void zone(JSONObject operation)throws Exception{
  if(!"set".equals(operation.getString("action")))return;
  String wanted=android.icu.util.TimeZone.getCanonicalID(operation.getString("timeZone")),actual=android.icu.util.TimeZone.getCanonicalID(java.util.TimeZone.getDefault().getID());
  if(wanted==null||!wanted.equals(actual))throw new IllegalStateException();
 }
 static Intent intent(JSONObject operation)throws Exception{
  validate(operation);String action=operation.getString("action");
  if("set".equals(action))return ClockHandoff.intent("set",operation.getInt("hour"),operation.getInt("minute"),operation.getString("label"),null,ClockDays.agent(operation.opt("days")));
  // Android's unqualified snooze affects all ringing alarms; dismissal can act without selection.
  // Open Clock instead: the owner selects the actual alarm and completes either action there.
  return new Intent(AlarmClock.ACTION_SHOW_ALARMS);
 }
 static void show(Activity activity,String id,JSONObject operation,Decision decision)throws Exception{
  validate(operation);foreground(activity);zone(operation);String action=operation.getString("action");String text;
  if("set".equals(action))text=String.format(java.util.Locale.ROOT,"Send %02d:%02d (%s)%s, label “%s”, to Clock? Clock may create this alarm immediately. Alpha cannot confirm creation or ringing.",operation.getInt("hour"),operation.getInt("minute"),operation.getString("timeZone"),repeatText(operation),operation.getString("label"));
  else if("show".equals(action))text="Open Clock to review your alarms. No alarm change is requested.";
  else text="Open Clock and choose the intended alarm yourself to "+action+" it. Alpha will not "+action+" any alarm. "+("snooze".equals(action)?"Choose the duration in Clock; the requested "+operation.getInt("snoozeMinutes")+" minutes is not applied automatically. ":"")+"Completion remains manual and unverified.";
  AlertDialog dialog=new AlertDialog.Builder(activity).setTitle("Review agent Clock handoff").setMessage(text).setPositiveButton("Continue to Clock",(d,w)->{dialogs.remove(id);pending.remove(id);decision.selected(true);}).setNegativeButton("Cancel",(d,w)->{dialogs.remove(id);pending.remove(id);decision.selected(false);}).setOnCancelListener(d->{dialogs.remove(id);pending.remove(id);decision.selected(false);}).create();
  dialogs.put(id,dialog);pending.put(id,decision);dialog.show();
 }
 private static String repeatText(JSONObject operation){java.util.List<Integer> days=ClockDays.agent(operation.opt("days"));return days==null?(operation.has("days")?", one time":""):", repeating "+ClockDays.names(days);}
 static void abandon(){for(AlertDialog dialog:dialogs.values())dialog.dismiss();dialogs.clear();pending.clear();}
 static void dismiss(String id){AlertDialog dialog=dialogs.remove(id);Decision decision=pending.remove(id);if(dialog!=null)dialog.dismiss();if(decision!=null)decision.selected(false);}
 static JSObject dispatch(Activity activity,JSONObject operation){String action=operation.optString("action");Intent intent;
  try{foreground(activity);zone(operation);intent=intent(operation);}catch(Exception refused){return result(action,"failed");}
  try{
  android.content.pm.ResolveInfo resolved=activity.getPackageManager().resolveActivity(intent,0);
  if(resolved==null||resolved.activityInfo==null||ClockHandoff.receiver(activity.getPackageName(),resolved.activityInfo.packageName)==null)return result(action,"unavailable");
  // Bind the resolved external component; do not allow an own-app routing loop.
  intent.setComponent(new android.content.ComponentName(resolved.activityInfo.packageName,resolved.activityInfo.name));activity.startActivity(intent);return result(action,"opened");
 }catch(android.content.ActivityNotFoundException absent){return result(action,"unavailable");}catch(SecurityException denied){return result(action,"denied");}catch(Exception uncertain){return result(action,"unknown");}}
}
