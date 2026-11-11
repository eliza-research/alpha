package ai.alphacompute.alphaphone;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionCoordinator;
import ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal;
import ai.eliza.plugins.actionjournal.deletion.DeletionDispatchClaim;

import android.app.AlertDialog;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.*;

/** Manual deletion is native-reviewed. The renderer supplies a selected revision, never owner authority. */
@CapacitorPlugin(name="AlphaDeletions")
public final class AlphaDeletionsPlugin extends Plugin {
 private final java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newFixedThreadPool(2);
 private AlertDialog review;private volatile boolean retired;private volatile long reviewEpoch;
 private final java.util.Set<DeletionReviewAdmission> reviews=java.util.concurrent.ConcurrentHashMap.newKeySet();
 @Override public void load(){super.load();NativeDeletionCoordinator.get(getContext()).start();}
 private void task(PluginCall call,Task action){try{worker.execute(()->{try{if(retired)throw new IllegalStateException();call.resolve(JSObject.fromJSONObject(action.run()));}catch(Exception unavailable){call.reject("Deletion state could not be confirmed. Saved data is retained; refresh before reviewing again.");}});}catch(java.util.concurrent.RejectedExecutionException stopped){call.reject("Deletion view retired");}}
 private interface Task{JSONObject run()throws Exception;}
 @PluginMethod public void pending(PluginCall call){task(call,()->new JSONObject().put("deletions",NativeDeletionCoordinator.get(getContext()).pending()).put("deletedOrigins",NativeDeletionCoordinator.get(getContext()).deletedNoteOrigins()));}
 @PluginMethod public void dismiss(PluginCall call){task(call,()->NativeDeletionCoordinator.get(getContext()).dismiss(call.getString("kind"),call.getString("id")));}
 @PluginMethod public void undo(PluginCall call){task(call,()->NativeDeletionCoordinator.get(getContext()).undo(call.getString("kind"),call.getString("id")));}
 @PluginMethod public void reviewReminder(PluginCall call){reviewReminder(call,null,null,null);}
 @PluginMethod public void reviewAgentReminder(PluginCall call){
  try{worker.execute(()->{try{
   if(retired)throw new IllegalStateException();JSONObject operation=call.getObject("operation"),identity=call.getObject("journalIdentity");
   if(operation==null||!"reminder_cancel".equals(operation.getString("type")))throw new IllegalArgumentException();
   JSONObject owner=NativeDeletionCoordinator.get(getContext()).agentOwner();String id=call.getString("operationId");
   DeletionDispatchClaim.check(AlphaActionJournal.get(getContext()),identity,id,operation,owner,false);
   JSONObject binding=new JSONObject().put("operationId",id).put("bindingHash",call.getString("bindingHash")).put("operation",new JSONObject(operation.toString()));
   reviewReminder(call,owner,binding,identity);
  }catch(Exception unavailable){call.reject("Authenticated deletion review is unavailable.");}});}catch(java.util.concurrent.RejectedExecutionException stopped){call.reject("Deletion view retired");}
 }
 private void reviewReminder(PluginCall call,JSONObject agentOwner,JSONObject binding,JSONObject identity){
  final long epoch=reviewEpoch;
  final DeletionReviewAdmission admission=new DeletionReviewAdmission();reviews.add(admission);
  try{getActivity().runOnUiThread(()->{
   if(retired||reviewEpoch!=epoch||!admission.queued()||review!=null||!foreground()){finishStatus(call,admission,"unavailable");return;}
   try{worker.execute(()->{
    try{
     JSONObject raw=binding==null?call.getObject("target"):binding.getJSONObject("operation").getJSONObject("target");
     if(raw==null)throw new IllegalArgumentException();
     JSONObject target=new JSONObject(raw.toString());String id=target.getString("reminderId");
     JSONObject selected=AlphaReminders.engine(getContext()).selected(id);
     if(!DeferredDeletionJournal.same(selected,target)){finishStatus(call,admission,"stale");return;}
     JSONObject row=AlphaReminders.engine(getContext()).read(id);String title=row.getString("title");
     getActivity().runOnUiThread(()->showReminderReview(call,agentOwner,binding,identity,target,id,title,epoch,admission));
    }catch(Exception unavailable){finishFailure(call,admission,"Selected reminder is unavailable.");}
   });}catch(java.util.concurrent.RejectedExecutionException stopped){finishStatus(call,admission,"unavailable");}
  });}catch(RuntimeException unavailable){finishStatus(call,admission,"unavailable");}
 }
 private void showReminderReview(PluginCall call,JSONObject agentOwner,JSONObject binding,JSONObject identity,JSONObject target,String id,String title,long epoch,DeletionReviewAdmission admission){
  if(retired||reviewEpoch!=epoch||!admission.queued()||review!=null||!foreground()){finishStatus(call,admission,"unavailable");return;}
  final boolean[] submitted={false};final AlertDialog[] own={null};
  try{
  own[0]=new AlertDialog.Builder(getActivity()).setTitle("Delete reminder?").setMessage(title+"\n\nIts alert pauses now. You can undo for 10 seconds.").setNegativeButton("Cancel",(d,w)->{}).setPositiveButton("Delete reminder",(d,w)->{
   if(submitted[0]||retired||reviewEpoch!=epoch||review!=own[0]||getContext().getSystemService(android.app.KeyguardManager.class).isDeviceLocked()||!getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED))return;
   submitted[0]=true;
   try{worker.execute(()->{
    // The tap queues one task. Pause and the worker compete for its admission lease;
    // once admitted, its exact durable receipt is returned even if the Activity has since left.
    JSONObject outcome;
    try{outcome=stageReminderReview(agentOwner,binding,identity,target,id,epoch,admission);}
    catch(Exception unavailable){finishFailure(call,admission,"Deletion result unavailable; inspect pending changes.");return;}
    finishResult(call,admission,outcome);
   });}catch(java.util.concurrent.RejectedExecutionException stopped){finishStatus(call,admission,"unavailable");}
  }).create();
  review=own[0];review.setOnDismissListener(d->{if(review==own[0])review=null;if(!submitted[0])finishStatus(call,admission,"cancelled");});review.show();
  }catch(RuntimeException unavailable){if(review==own[0])review=null;finishStatus(call,admission,"unavailable");if(own[0]!=null)try{own[0].dismiss();}catch(RuntimeException ignored){/* The review already settled. */}}
 }
 /** Runs on the worker: owner, provider and encrypted journal work never block the dialog. */
 private JSONObject stageReminderReview(JSONObject agentOwner,JSONObject binding,JSONObject identity,JSONObject target,String id,long epoch,DeletionReviewAdmission admission)throws Exception{
  DeferredDeletionCoordinator coordinator=NativeDeletionCoordinator.get(getContext());
  String operationId=binding==null?java.util.UUID.randomUUID().toString():binding.getString("operationId");
  try{
   if(retired||reviewEpoch!=epoch||!admission.queued())return new JSONObject().put("status","cancelled");
   JSONObject owner=agentOwner==null?coordinator.manualOwner():agentOwner;
   // Refusals precede the permanent claim. Recheck lifetime after these potentially slow reads.
   if(!coordinator.stageAdmissible(owner)||!DeferredDeletionJournal.same(AlphaReminders.engine(getContext()).selected(id),target))return new JSONObject().put("status","stale");
   if(retired||reviewEpoch!=epoch)admission.retire();
   // Pause and worker admission race on this CAS, never on a lock held across journal I/O.
   if(!admission.admit())return new JSONObject().put("status","cancelled");
   if(binding!=null){DeletionDispatchClaim.check(AlphaActionJournal.get(getContext()),identity,operationId,binding.getJSONObject("operation"),agentOwner,true);binding.put("journalBinding",DeletionDispatchClaim.binding(AlphaActionJournal.get(getContext()),identity));}
   return new JSONObject().put("status","queued").put("deletion",coordinator.stageReminder(target,owner,operationId,binding));
  }catch(Exception failure){return unstaged(coordinator,operationId);}
 }
 private void finishStatus(PluginCall call,DeletionReviewAdmission admission,String status){try{finishResult(call,admission,new JSONObject().put("status",status));}catch(JSONException impossible){finishFailure(call,admission,"Deletion result unavailable; inspect pending changes.");}}
 private void finishResult(PluginCall call,DeletionReviewAdmission admission,JSONObject outcome){
  final JSObject result;try{result=JSObject.fromJSONObject(outcome);}catch(JSONException unavailable){finishFailure(call,admission,"Deletion result unavailable; inspect pending changes.");return;}
  if(admission.settle()){reviews.remove(admission);call.resolve(result);}
 }
 private void finishFailure(PluginCall call,DeletionReviewAdmission admission,String message){if(admission.settle()){reviews.remove(admission);call.reject(message);}}
 /** After a failed stage: 'not-staged' only when no receipt exists for this exact operation; otherwise the outcome is unknown. */
 private static JSONObject unstaged(DeferredDeletionCoordinator coordinator,String operationId){
  try{JSONObject staged=coordinator.receipt("reminder",operationId);return staged==null?new JSONObject().put("status","not-staged"):new JSONObject().put("status","queued").put("deletion",staged);}
  catch(Exception unreadable){try{return new JSONObject().put("status","unknown");}catch(JSONException impossible){throw new IllegalStateException(impossible);}}
 }
 private boolean foreground(){android.app.KeyguardManager lock=getContext().getSystemService(android.app.KeyguardManager.class);return getActivity()!=null&&!getActivity().isFinishing()&&!getActivity().isDestroyed()&&getActivity().hasWindowFocus()&&lock!=null&&!lock.isDeviceLocked();}
 private void retireReviews(){++reviewEpoch;for(DeletionReviewAdmission admission:reviews)admission.retire();}
 @Override protected void handleOnPause(){retireReviews();if(review!=null)review.dismiss();super.handleOnPause();}
 @Override protected void handleOnDestroy(){retired=true;retireReviews();if(review!=null)review.dismiss();worker.shutdown();super.handleOnDestroy();}
}
