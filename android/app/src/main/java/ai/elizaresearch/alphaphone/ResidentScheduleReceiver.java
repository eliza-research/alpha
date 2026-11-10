package ai.elizaresearch.alphaphone;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.UserManager;
import android.util.Log;

/**
 * Brings the resident agent back after boot, app update, or a clock/time-zone change (#394) when it
 * is not running; a running resident is untouched. Reminders keep their own AlarmManager receiver;
 * digests and other agent schedules run in the resident runtime and its own timers. Nothing is
 * replayed here: a missed digest runs again only through its explicit, reviewed Run now. An owner
 * stop is process-local, so it does not survive reboot or process death (always-on agent).
 */
public final class ResidentScheduleReceiver extends BroadcastReceiver {
 private static final String TAG="AlphaResidentSchedule";

 @Override public void onReceive(Context context,Intent intent){
  String action=intent==null?null:intent.getAction();
  if(!ResidentScheduleRearm.handles(action))return;
  UserManager users=context.getSystemService(UserManager.class);
  boolean unlocked=users!=null&&users.isUserUnlocked();
  boolean packaged=unlocked&&AlphaLocalAgentPlugin.runtimePackaged(context);
  boolean enabled=packaged&&ElizaAgentService.shouldAutoStart(context);
  try{
   ResidentScheduleRearm.Decision decision=AlphaLocalAgentPlugin.startResidentIfAdmissible(context,action,unlocked,packaged,enabled);
   if(decision!=ResidentScheduleRearm.Decision.START)Log.i(TAG,"Resident not started for "+action+": "+decision);
  }catch(RuntimeException deferred){
   // A refused background start or a retiring provider defers to the next foreground launch.
   Log.w(TAG,"Resident start deferred for "+action+": "+deferred.getClass().getSimpleName());
  }
 }
}
