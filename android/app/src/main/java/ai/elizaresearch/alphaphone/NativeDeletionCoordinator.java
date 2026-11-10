package ai.elizaresearch.alphaphone;

import android.content.Context;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import androidx.work.*;
import java.util.concurrent.TimeUnit;
import org.json.*;

/**
 * Alpha's binding of the shared reviewed deletion Undo window
 * ({@link DeferredDeletionCoordinator}, @elizaos/capacitor-action-journal). Alpha supplies its
 * installed slot names, its boot-count clock, the authenticated owner route, its reminder engine,
 * its Calendar provider writes and the WorkManager wake-up. The window, admission, owner fences
 * and no-replay rules are the shared module's.
 */
final class NativeDeletionCoordinator {
 /** Installed slot names: they hold every pending Calendar deletion and the manual owner. */
 static final String JOURNAL="native-delete-journal:v1",INSTALLATION="native-delete-installation:v1";
 static final String WORK="alpha-delete-window";
 private static final String UNKNOWN_BOOT="unknown:"+java.util.UUID.randomUUID();
 private static DeferredDeletionCoordinator instance;
 static synchronized DeferredDeletionCoordinator get(Context context){if(instance==null)instance=create(context.getApplicationContext());return instance;}
 private static DeferredDeletionCoordinator create(Context context){
  AlphaCredentialStore store=new AlphaCredentialStore(context);
  return new DeferredDeletionCoordinator(new DeferredDeletionCoordinator.Configuration(JOURNAL,INSTALLATION),
   new DeferredDeletionCoordinator.Slots(){
    public String read(String slot)throws Exception{return store.readCredentialSlot(slot);}
    public void write(String slot,String value)throws Exception{store.writeCredentialSlot(slot,value);}
   },
   new DeferredDeletionCoordinator.Clock(){
    public String continuity(){try{return "boot:"+android.provider.Settings.Global.getInt(context.getContentResolver(),android.provider.Settings.Global.BOOT_COUNT);}catch(Exception unavailable){return UNKNOWN_BOOT;}}
    public long elapsed(){return android.os.SystemClock.elapsedRealtime();}
    public long wall(){return System.currentTimeMillis();}
   },
   new DeferredDeletionCoordinator.Owners(){
    public JSONObject identity()throws Exception{return new NativeOwnerReminderHost(context).read();}
    public String reviewFence(JSONObject identity)throws Exception{return new NativeOwnerReminderHost(context).reviewFence(identity);}
   },
   new DeferredDeletionCoordinator.Reminders(){
    public JSONArray pendingDeletions()throws Exception{return AlphaReminders.engine(context).pendingDeletions();}
    public JSONObject stageDeletion(String id,String owner,JSONObject target,JSONObject clock,JSONObject binding)throws Exception{return AlphaReminders.engine(context).stageDeletion(id,owner,target,clock,binding);}
    public JSONObject settleDeletion(String id,String owner,JSONObject clock,boolean undo)throws Exception{return AlphaReminders.engine(context).settleDeletion(id,owner,clock,undo);}
    public void pauseDeletion(String id,String owner,String reason)throws Exception{AlphaReminders.engine(context).pauseDeletion(id,owner,reason);}
    public JSONObject reminder(String id)throws Exception{return AlphaReminders.engine(context).read(id);}
   },
   new DeferredDeletionCoordinator.CalendarDeletions(){
    public String refusal(JSONObject owner,JSONObject target){return target.optInt("version")==3?CalendarSyncBridge.deletionRefusal(context,owner,target):null;}
    public JSONObject dispatch(JSONObject target)throws Exception{return target.optInt("version")==3?CalendarSyncBridge.dispatchDeletion(context,target):target.optInt("version")==2?CalendarScopedDeletionReview.dispatch(context,target):ai.eliza.plugins.calendar.CalendarPlugin.deleteReviewedExact(context,AlphaCalendarPlugin.CONFIGURATION,target);}
    public boolean targets(JSONObject target,long source,long event)throws Exception{
     if(target.optInt("version")==3)return Long.toString(event).equals(target.optString("eventId"));
     return CalendarDeletionIdentity.parse(target.getString("eventId")).eventId==event;
    }
   },
   delay->WorkManager.getInstance(context).enqueueUniqueWork(WORK,ExistingWorkPolicy.REPLACE,new OneTimeWorkRequest.Builder(DeletionWorker.class).setInitialDelay(delay,TimeUnit.MILLISECONDS).build()));
 }
 private NativeDeletionCoordinator(){}
}
