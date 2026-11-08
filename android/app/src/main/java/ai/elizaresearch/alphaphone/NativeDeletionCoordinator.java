package ai.elizaresearch.alphaphone;

import android.content.Context;
import org.json.*;
import java.util.concurrent.TimeUnit;
import androidx.work.*;

/** Main-process admission. Agent identity comes from authenticated native owner context,
 * never a renderer-supplied owner or the notification privacy fence. */
final class NativeDeletionCoordinator {
 static final String JOURNAL="native-delete-journal:v1",INSTALLATION="native-delete-installation:v1";
 private static NativeDeletionCoordinator instance;
 private static final String UNKNOWN_BOOT="unknown:"+java.util.UUID.randomUUID();
 private final Context context;private final AlphaCredentialStore store;private final DeferredDeletionJournal calendar;
 static synchronized NativeDeletionCoordinator get(Context context){if(instance==null)instance=new NativeDeletionCoordinator(context.getApplicationContext());return instance;}
 private NativeDeletionCoordinator(Context context){this.context=context;store=new AlphaCredentialStore(context);calendar=new DeferredDeletionJournal(new DeferredDeletionJournal.Store(){public String read()throws Exception{return store.readCredentialSlot(JOURNAL);}public void save(String value)throws Exception{store.writeCredentialSlot(JOURNAL,value);}});}
 private String boot(){try{return "boot:"+android.provider.Settings.Global.getInt(context.getContentResolver(),android.provider.Settings.Global.BOOT_COUNT);}catch(Exception unavailable){return UNKNOWN_BOOT;}}
 private JSONObject clock()throws Exception{return new JSONObject().put("continuity",boot()).put("elapsed",android.os.SystemClock.elapsedRealtime()).put("wall",System.currentTimeMillis());}
 synchronized JSONObject manualOwner()throws Exception{String raw=store.readCredentialSlot(INSTALLATION);if(raw==null){raw=new JSONObject().put("kind","manual").put("installationId",java.util.UUID.randomUUID().toString()).toString();store.writeCredentialSlot(INSTALLATION,raw);}return new JSONObject(raw);}
 JSONObject agentOwner()throws Exception{NativeOwnerReminderHost host=new NativeOwnerReminderHost(context);JSONObject identity=host.read();return new JSONObject().put("kind","agent").put("identity",identity).put("reviewFence",host.reviewFence(identity));}
 private String ownerKey(JSONObject value){return value.toString();}
 private boolean stageOwnerCurrent(JSONObject owner)throws Exception{return "manual".equals(owner.getString("kind"))?DeferredDeletionJournal.same(owner,manualOwner()):owner.getString("reviewFence").equals(new NativeOwnerReminderHost(context).reviewFence(owner.getJSONObject("identity")));}
 /** Deterministic owner precondition of stage, checked before an agent claim is written. No network. */
 boolean stageAdmissible(JSONObject owner){try{return stageOwnerCurrent(owner);}catch(Exception changed){return false;}}
 synchronized JSONObject stageCalendar(JSONObject target,JSONObject owner,String operationId)throws Exception{
  if(!stageOwnerCurrent(owner))throw new SecurityException("Deletion owner changed during review");
  JSONObject time=clock();String id=operationId==null?java.util.UUID.randomUUID().toString():operationId;
  JSONObject row=calendar.stage(id,owner,target,new DeletionDeadline(time.getString("continuity"),time.getLong("elapsed"),time.getLong("wall")));schedule(0);return row;
 }
 synchronized JSONObject stageReminder(JSONObject target,JSONObject owner,String operationId,JSONObject binding)throws Exception{
  if(!stageOwnerCurrent(owner))throw new SecurityException("Deletion owner changed during review");
  String id=operationId==null?java.util.UUID.randomUUID().toString():operationId;JSONObject row=AlphaReminders.engine(context).stageDeletion(id,ownerKey(owner),target,clock(),binding);schedule(0);return row;
 }
 JSONObject receipt(String kind,String id)throws Exception{
  JSONObject time=clock();JSONArray rows="calendar".equals(kind)?calendar.list(time.getString("continuity"),time.getLong("elapsed")):AlphaReminders.engine(context).pendingDeletions();
  for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.getString("id")))return row;}return null;
 }
 /** A pending Undo window is not a deleted event and cannot be overwritten by sync. */
 synchronized boolean calendarPending(long source,long event)throws Exception{
  JSONObject time=clock();JSONArray rows=calendar.list(time.getString("continuity"),time.getLong("elapsed"));
  for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(!pendingPhase(row))continue;JSONObject target=row.getJSONObject("target");if(!Long.toString(source).equals(target.optString("sourceId")))continue;
   if(target.optInt("version")==3){if(Long.toString(event).equals(target.optString("eventId")))return true;}
   else{CalendarDeletionIdentity id=CalendarDeletionIdentity.parse(target.getString("eventId"));if(id.eventId==event)return true;}
  }
  return false;
 }
 JSONArray pending()throws Exception{
  java.util.Set<String> acknowledged=calendar.acknowledgements();
  JSONObject time=clock();JSONArray result=new JSONArray(),events=calendar.list(time.getString("continuity"),time.getLong("elapsed"));
  for(int i=0;i<events.length();i++){JSONObject row=events.getJSONObject(i);if(pendingPhase(row)&&!acknowledged.contains("calendar:"+row.getString("id"))&&visible(row.getJSONObject("owner")))result.put(row.put("kind","calendar"));}
  JSONArray reminders=AlphaReminders.engine(context).pendingDeletions();for(int i=0;i<reminders.length();i++){JSONObject row=reminders.getJSONObject(i);if(!pendingPhase(row)||acknowledged.contains("reminder:"+row.getString("id"))||!visible(new JSONObject(row.getString("owner"))))continue;
   if("queued".equals(row.getString("phase"))){String state=!time.getString("continuity").equals(row.getString("continuity"))||time.getLong("elapsed")<row.getLong("createdElapsed")?"clock-changed":time.getLong("elapsed")<row.getLong("expiresElapsed")?"open":"expired";row.put("window",state);}
   result.put(row.put("kind","reminder"));}
  return result;
 }
 /** Note links exist for native reminders only. A queued/undone/uncertain receipt proves nothing. */
 JSONArray deletedNoteOrigins()throws Exception{
  JSONArray result=new JSONArray(),rows=AlphaReminders.engine(context).pendingDeletions();
  for(int i=0;i<rows.length();i++){
   JSONObject receipt=rows.getJSONObject(i);
   if(!"deleted".equals(receipt.optString("phase"))||!"complete".equals(receipt.optString("effects"))||!visible(new JSONObject(receipt.getString("owner"))))continue;
   String id=receipt.getJSONObject("target").getString("reminderId");JSONObject row=AlphaReminders.engine(context).read(id);
   if(row!=null&&"cancelled".equals(row.optString("status"))&&row.optString("occurrenceId").equals(receipt.getJSONObject("target").getString("occurrenceId")))result.put(new JSONObject().put("kind","reminder").put("id",id));
  }
  return result;
 }
 private static boolean pendingPhase(JSONObject row){return java.util.Set.of("queued","paused","unknown","dispatching").contains(row.optString("phase"));}
 private final Object visibilityLock=new Object();private JSONObject visibleOwner;private long visibleUntil;
 private static boolean stableOwner(JSONObject a,JSONObject b)throws Exception{
  if(!a.getString("kind").equals(b.getString("kind")))return false;if("manual".equals(a.getString("kind")))return DeferredDeletionJournal.same(a,b);
  JSONObject x=a.getJSONObject("identity"),y=b.getJSONObject("identity");for(String field:new String[]{"subjectUserId","agentId","installationId","enrollmentId","accountRef","environment"})if(!x.getString(field).equals(y.getString(field)))return false;return true;
 }
 private boolean visible(JSONObject owner){try{
  if("manual".equals(owner.getString("kind")))return stageOwnerCurrent(owner);
  synchronized(visibilityLock){
   boolean valid=false;try{valid=visibleOwner!=null&&android.os.SystemClock.elapsedRealtime()<visibleUntil&&stageOwnerCurrent(visibleOwner);}catch(Exception changed){}
   if(!valid){visibleOwner=null;JSONObject authenticated=agentOwner();visibleUntil=android.os.SystemClock.elapsedRealtime()+5000;visibleOwner=authenticated;}
   return stableOwner(owner,visibleOwner);
  }
 }catch(Exception unavailable){return false;}}

 /** Agent owner authenticated over the owner route (HTTP, up to 12 s). Always resolved before the
  * coordinator lock is taken, so a slow or offline owner never blocks review staging on the UI thread. */
 private JSONObject agentOwnerOrNull(){try{return agentOwner();}catch(Exception unavailable){return null;}}
 private static boolean agentKind(JSONObject owner){return "agent".equals(owner.optString("kind"));}
 private JSONObject agentOwnerFor(String kind,String id){
  try{JSONObject row=receipt(kind,id);if(row==null)return null;JSONObject owner="calendar".equals(kind)?row.getJSONObject("owner"):new JSONObject(row.getString("owner"));return agentKind(owner)?agentOwnerOrNull():null;}
  catch(Exception unavailable){return null;}
 }
 /** Exact owner match against an owner resolved outside the lock. An unavailable agent owner throws (owner-unavailable). */
 private boolean admitted(JSONObject owner,JSONObject agent)throws Exception{
  if(!agentKind(owner))return DeferredDeletionJournal.same(owner,manualOwner());
  if(agent==null)throw new SecurityException("Deletion owner unavailable");return stageOwnerCurrent(owner)&&DeferredDeletionJournal.same(owner,agent);
 }
 private boolean undoAllowed(JSONObject owner,JSONObject agent)throws Exception{return agentKind(owner)?agent!=null&&stableOwner(owner,agent):stableOwner(owner,manualOwner());}

 JSONObject dismiss(String kind,String id)throws Exception{
  if(!"calendar".equals(kind)&&!"reminder".equals(kind))throw new IllegalArgumentException("Unknown deletion kind");
  JSONObject agent=agentOwnerFor(kind,id);
  synchronized(this){
   JSONObject row=receipt(kind,id);if(row==null)throw new IllegalArgumentException("Deletion receipt unavailable");
   JSONObject owner="calendar".equals(kind)?row.getJSONObject("owner"):new JSONObject(row.getString("owner"));
   if(!undoAllowed(owner,agent))throw new SecurityException("Deletion owner changed");
   String phase=row.getString("phase");if(!"unknown".equals(phase)&&!"dispatching".equals(phase))throw new IllegalStateException("Only uncertain outcomes can be dismissed");
   calendar.acknowledge(kind,id);return new JSONObject().put("status","acknowledged");
  }
 }
 JSONObject undo(String kind,String id)throws Exception{
  JSONObject agent=agentOwnerFor(kind,id);
  synchronized(this){
   JSONObject time=clock();if("calendar".equals(kind)){JSONArray rows=calendar.list(time.getString("continuity"),time.getLong("elapsed"));for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.getString("id"))&&undoAllowed(row.getJSONObject("owner"),agent))return calendar.undo(id,row.getJSONObject("owner"),time.getString("continuity"),time.getLong("elapsed"));}}
   else if("reminder".equals(kind)){JSONArray rows=AlphaReminders.engine(context).pendingDeletions();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(id.equals(row.getString("id"))&&undoAllowed(new JSONObject(row.getString("owner")),agent))return DeferredDeletionJournal.requireUndone(AlphaReminders.engine(context).settleDeletion(id,row.getString("owner"),time,true));}}
   throw new SecurityException("Deletion no longer belongs to this session");
  }
 }
 /** Whether any row the next reconcile acts on is agent-owned, so the owner route must be read first. */
 private boolean reconcileNeedsAgent()throws Exception{
  JSONObject time=clock();JSONArray events=calendar.list(time.getString("continuity"),time.getLong("elapsed"));
  for(int i=0;i<events.length();i++){JSONObject row=events.getJSONObject(i);if("queued".equals(row.optString("phase"))&&agentKind(row.getJSONObject("owner")))return true;}
  JSONArray reminders=AlphaReminders.engine(context).pendingDeletions();
  for(int i=0;i<reminders.length();i++){JSONObject row=reminders.getJSONObject(i);if(("queued".equals(row.optString("phase"))||"pending".equals(row.optString("effects")))&&agentKind(new JSONObject(row.getString("owner"))))return true;}
  return false;
 }
 /**
  * Settles expired windows. Every row is isolated: an owner that cannot be confirmed counts as not
  * admitted and one row's failure never stops later rows or the next wake-up from being scheduled.
  * Returns true when a row failed and the worker should retry with backoff.
  */
 boolean reconcile()throws Exception{
  JSONObject agent=reconcileNeedsAgent()?agentOwnerOrNull():null;
  synchronized(this){
   JSONObject time=clock();long elapsed=time.getLong("elapsed");long[] next={Long.MAX_VALUE};boolean failed=false;String continuity=time.getString("continuity");
   try{
    JSONArray events=calendar.list(continuity,elapsed);
    for(int i=0;i<events.length();i++){try{JSONObject row=events.getJSONObject(i);if(!"queued".equals(row.getString("phase")))continue;
     if("open".equals(row.getString("window")))next[0]=Math.min(next[0],row.getJSONObject("deadline").getLong("expiresElapsed")-elapsed);
     else if("expired".equals(row.getString("window")))calendar.expire(row.getString("id"),continuity,elapsed,(owner,target)->admitted(owner,agent)?target.optInt("version")==3?CalendarSyncBridge.deletionRefusal(context,owner,target):null:"owner-changed",target->target.optInt("version")==3?CalendarSyncBridge.dispatchDeletion(context,target):target.optInt("version")==2?CalendarScopedDeletionReview.dispatch(context,target):ai.eliza.plugins.calendar.CalendarPlugin.deleteReviewedExact(context,AlphaCalendarPlugin.CONFIGURATION,target));
    }catch(Exception rowFailed){failed=true;}}
    JSONArray reminders=AlphaReminders.engine(context).pendingDeletions();
    for(int i=0;i<reminders.length();i++){try{JSONObject row=reminders.getJSONObject(i);String phase=row.getString("phase");
     if(!"queued".equals(phase)){
      if(!"pending".equals(row.optString("effects")))continue;
      boolean owned;try{owned=admitted(new JSONObject(row.getString("owner")),agent);}catch(Exception unavailable){owned=false;}
      if(owned)AlphaReminders.engine(context).settleDeletion(row.getString("id"),row.getString("owner"),time,"undone".equals(phase));
      continue;
     }
     if(!continuity.equals(row.getString("continuity"))||elapsed<row.getLong("createdElapsed"))continue;
     if(elapsed<row.getLong("expiresElapsed")){next[0]=Math.min(next[0],row.getLong("expiresElapsed")-elapsed);continue;}
     boolean owned;try{owned=admitted(new JSONObject(row.getString("owner")),agent);}catch(Exception unavailable){owned=false;}
     if(owned)AlphaReminders.engine(context).settleDeletion(row.getString("id"),row.getString("owner"),time,false);else AlphaReminders.engine(context).pauseDeletion(row.getString("id"),row.getString("owner"),"owner-unavailable");
    }catch(Exception rowFailed){failed=true;}}
   }catch(Exception listFailed){failed=true;}
   finally{if(next[0]!=Long.MAX_VALUE)schedule(Math.max(1,next[0]));}
   return failed;
  }
 }
 void start(){schedule(0);}
 private void schedule(long delay){WorkManager.getInstance(context).enqueueUniqueWork("alpha-delete-window",ExistingWorkPolicy.REPLACE,new OneTimeWorkRequest.Builder(DeletionWorker.class).setInitialDelay(delay,TimeUnit.MILLISECONDS).build());}
}
