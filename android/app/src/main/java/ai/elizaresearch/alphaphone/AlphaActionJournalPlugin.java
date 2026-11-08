package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.actionjournal.deletion.DeletionReceiptRecovery;

import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import ai.eliza.plugins.actionjournal.ActionJournal;
import ai.eliza.plugins.actionjournal.ActionJournalPlugin;
import ai.eliza.plugins.notifications.NoticeRecovery;
import java.util.Set;
import org.json.JSONObject;
import static ai.eliza.plugins.actionjournal.ActionJournal.field;
import static ai.eliza.plugins.actionjournal.ActionJournal.sameJson;

/** Product receipt recovery and Clock approval over the shared encrypted journal. */
@CapacitorPlugin(name="AlphaActionJournal")
public final class AlphaActionJournalPlugin extends ActionJournalPlugin {
 @Override protected ActionJournal createJournal(){return AlphaActionJournal.get(getContext());}
 private static JSONObject read(ActionJournal journal,String scope,String id)throws Exception{return journal.get(scope,id);}
 private static JSObject response(JSONObject entry)throws Exception{return entryResponse(entry);}
 @PluginMethod public void recoverNotification(PluginCall call){work(call,true,(store,scope,id)->{synchronized(store.lock()){
  JSONObject entry=read(store,scope,id);
  AlphaCredentialStore noticeStore=new AlphaCredentialStore(getContext());
  WorkflowNoticeDelivery delivery=new WorkflowNoticeDelivery(new WorkflowNoticeDelivery.Storage(){public String read(String slot)throws Exception{return noticeStore.readCredentialSlot(slot);}public void write(String slot,String value)throws Exception{noticeStore.writeCredentialSlot(slot,value);}},new WorkflowNoticePoster(getContext()));
  JSONObject recovered=NoticeRecovery.recover(entry,scope,id,call.getString("bindingHash"),delivery::receipt);
  if(recovered!=entry)store.update(scope,id,previous->recovered);return response(recovered);
 }});}
 @PluginMethod public void recoverDeletion(PluginCall call){work(call,true,(store,scope,id)->{synchronized(store.lock()){
  JSONObject entry=read(store,scope,id);if(entry==null)return response(null);
  JSONObject operation=entry.getJSONObject("record").getJSONObject("operation");String type=operation.optString("type");
  if(!Set.of("calendar_delete","reminder_cancel").contains(type))return response(entry);
  JSONObject receipt=NativeDeletionCoordinator.get(getContext()).receipt("calendar_delete".equals(type)?"calendar":"reminder",entry.getString("operationId")),reminderResult=null;
  if(receipt!=null&&"reminder_cancel".equals(type)&&receipt.has("operationBinding")){
   JSONObject binding=receipt.getJSONObject("operationBinding"),saved=AlphaReminders.engine(getContext()).operationReceipt(entry.getString("operationId"),binding.getString("bindingHash"),operation);
   if("succeeded".equals(saved.optString("status")))reminderResult=saved.optJSONObject("result");
  }
  JSONObject recovered=DeletionReceiptRecovery.recover(entry,receipt,reminderResult);
  if(recovered!=entry){AlphaActionJournal.checkResult(recovered,recovered.getString("status"),recovered.getJSONObject("result"));store.update(scope,id,previous->recovered);}return response(recovered);
 }});}
 @PluginMethod public void recoverReminder(PluginCall call){work(call,true,(store,scope,id)->{synchronized(store.lock()){
  JSONObject entry=read(store,scope,id);if(entry==null)throw new IllegalStateException();
  JSONObject operation=entry.getJSONObject("record").getJSONObject("operation");
  if(!Set.of("reminder_create","reminder_read_selected","reminder_update","reminder_complete","reminder_snooze","reminder_cancel").contains(operation.optString("type")))throw new IllegalArgumentException();
  if("terminal".equals(entry.optString("phase"))&&!"unknown".equals(entry.optString("status")))return response(entry);
  if(!"applying".equals(entry.optString("phase"))&&!"unknown".equals(entry.optString("status")))throw new IllegalStateException();
  JSONObject receipt=AlphaReminders.engine(getContext()).operationReceipt(entry.getString("operationId"),call.getString("bindingHash"),operation);
  if(!"succeeded".equals(receipt.optString("status")))return response(entry);
  entry.put("phase","terminal").put("status","succeeded").put("summary","Recovered the original saved reminder receipt. No action was repeated.").put("finishedAt",System.currentTimeMillis())
   .put("result",new JSONObject().put("operationId",entry.getString("operationId")).put("reminderResult",receipt.getJSONObject("result")));
  store.update(scope,id,previous->entry);return response(entry);
 }});}
 private final android.os.Handler clockMain = new android.os.Handler(android.os.Looper.getMainLooper());
 private <T> T clockUi(java.util.concurrent.Callable<T> action) throws Exception {
  if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) throw new IllegalStateException("Clock storage must run off main thread");
  java.util.concurrent.FutureTask<T> task = new java.util.concurrent.FutureTask<>(() -> { if (destroyed()) throw new IllegalStateException(); return action.call(); });
  if (!clockMain.post(task)) throw new IllegalStateException("Activity unavailable");
  try { return task.get(5, java.util.concurrent.TimeUnit.SECONDS); }
  catch (InterruptedException interrupted) { task.cancel(false); clockMain.removeCallbacks(task); Thread.currentThread().interrupt(); throw interrupted; }
  catch (Exception unavailable) { task.cancel(false); clockMain.removeCallbacks(task); throw unavailable; }
 }
 private JSONObject clockEntry(ActionJournal store,String scope,String id,String operationId)throws Exception{
  if(destroyed())throw new IllegalStateException();
  JSONObject entry=read(store,scope,id);
  if(entry==null||!"applying".equals(entry.getString("phase"))||!operationId.equals(entry.getString("operationId")))throw new IllegalStateException();
  JSONObject record=entry.getJSONObject("record"),operation=record.getJSONObject("operation");ClockAgentReview.validate(operation);
  for(String name:new String[]{"ownerId","sessionId","agentId","origin","installationId","enrollmentId"})if(record.getString(name).isEmpty())throw new IllegalStateException();
  if(record.getLong("expiresAt")<=System.currentTimeMillis()||record.getJSONObject("context").optBoolean("sensitive",false))throw new IllegalStateException();
  JSONObject clock=entry.optJSONObject("clockReview");
  if(clock!=null&&(!entry.getString("attemptId").equals(clock.getString("attemptId"))||!entry.getString("operationHash").equals(clock.getString("operationHash"))))throw new IllegalStateException();
  return entry;
 }
 private JSObject clockReply(JSONObject clock,String action)throws Exception{
  JSObject out=new JSObject();out.put("result",clock!=null&&clock.has("result")?clock.getJSONObject("result"):ClockAgentReview.result(action,"unknown"));return out;
 }
 private JSONObject clockMarker(JSONObject entry,String phase)throws Exception{return new JSONObject().put("phase",phase).put("attemptId",entry.getString("attemptId")).put("operationHash",entry.getString("operationHash"));}
 /**
  * The shared plugin stops its worker in handleOnDestroy. A Clock call the page made just before
  * that can arrive afterwards; the stopped executor then throws on the bridge thread, which ends
  * the process. Such a call is rejected: nothing was reviewed, approved or handed to Clock.
  */
 private void clockWork(PluginCall call,Runnable task){
  PluginWorkers.submit(worker(),task,()->call.reject("Clock review closed before this step started; nothing was sent to Clock"));
 }
 @PluginMethod public void reviewClock(PluginCall call){
  clockWork(call,()->{try{
   String scope=field(call.getString("scope"),"[a-f0-9]{64}"),id=field(call.getString("proposalId"),"[A-Za-z0-9_-]{1,128}"),operationId=field(call.getString("operationId"),"[A-Za-z0-9_-]{1,128}");
   ActionJournal store=journal();JSONObject approved;
   synchronized(store.lock()){JSONObject entry=clockEntry(store,scope,id,operationId);approved=entry.getJSONObject("record").getJSONObject("operation");if(!sameJson(approved,call.getObject("operation")))throw new IllegalStateException();
    if(entry.has("clockReview")){call.resolve(clockReply(entry.getJSONObject("clockReview"),approved.getString("action")));return;}
    entry.put("clockReview",clockMarker(entry,"reviewing"));store.update(scope,id,previous->entry);
   }
   clockUi(()->{
    ClockAgentReview.show(getActivity(),scope+":"+id,approved,accepted->{if(destroyed())return;PluginWorkers.submit(worker(),()->{if(destroyed())return;try{synchronized(store.lock()){JSONObject entry=clockEntry(store,scope,id,operationId),clock=entry.getJSONObject("clockReview");
      if(!"reviewing".equals(clock.getString("phase"))){call.resolve(clockReply(clock,approved.getString("action")));return;}
      JSObject reply=new JSObject();if(accepted){String token=java.util.UUID.randomUUID().toString();clock.put("phase","approved").put("reviewToken",token);reply.put("reviewToken",token);}else{clock.put("phase","cancelled").put("result",ClockAgentReview.result(approved.getString("action"),"failed"));reply=clockReply(clock,approved.getString("action"));}
      store.update(scope,id,previous->entry);call.resolve(reply);
     }}catch(Exception refusal){if(!destroyed())call.reject("Clock review expired or was retired");}},()->call.reject("Clock review retired"));});
    return null;
   });
  }catch(Exception refusal){call.reject("Exact approved Clock review unavailable");}});
 }
 @PluginMethod public void cancelClock(PluginCall call){work(call,true,(store,scope,id)->{synchronized(store.lock()){
  String operationId=field(call.getString("operationId"),"[A-Za-z0-9_-]{1,128}");JSONObject entry=read(store,scope,id);
  if(entry==null||!operationId.equals(entry.getString("operationId")))throw new IllegalStateException();
  JSONObject operation=entry.getJSONObject("record").getJSONObject("operation");ClockAgentReview.validate(operation);
  JSONObject clock=entry.optJSONObject("clockReview");if(clock==null)clock=clockMarker(entry,"reviewing");
  if(Set.of("reviewing","approved").contains(clock.getString("phase"))){clock.put("phase","cancelled").put("result",ClockAgentReview.result(operation.getString("action"),"failed"));entry.put("clockReview",clock);store.update(scope,id,previous->entry);}
  getActivity().runOnUiThread(()->ClockAgentReview.dismiss(scope+":"+id));return clockReply(clock,operation.getString("action"));
 }});}
 @PluginMethod public void confirmClock(PluginCall call){
  // Serialize exact approval and durable dispatch intent on the journal worker.
  // Only the foreground check and Android handoff run on the Activity thread.
  clockWork(call,()->{try{ActionJournal store=journal();synchronized(store.lock()){
   if(destroyed())throw new IllegalStateException();
   String scope=field(call.getString("scope"),"[a-f0-9]{64}"),id=field(call.getString("proposalId"),"[A-Za-z0-9_-]{1,128}"),operationId=field(call.getString("operationId"),"[A-Za-z0-9_-]{1,128}");
   JSONObject entry=clockEntry(store,scope,id,operationId),clock=entry.getJSONObject("clockReview"),operation=entry.getJSONObject("record").getJSONObject("operation");
   if(!"approved".equals(clock.getString("phase"))){call.resolve(clockReply(clock,operation.getString("action")));return;}
   if(!clock.getString("reviewToken").equals(call.getString("reviewToken")))throw new IllegalStateException();
   clockUi(()->{ClockAgentReview.foreground(getActivity());ClockAgentReview.zone(operation);return null;});
   clock.put("phase","dispatching").remove("reviewToken");store.update(scope,id,previous->entry);
   long expiresAt=entry.getJSONObject("record").getLong("expiresAt");
   JSObject result=clockUi(()->{if(expiresAt<=System.currentTimeMillis())return ClockAgentReview.result(operation.getString("action"),"failed");return ClockAgentReview.dispatch(getActivity(),operation);});clock.put("phase","finished").put("result",result);store.update(scope,id,previous->entry);call.resolve(clockReply(clock,operation.getString("action")));
  }}catch(Exception uncertain){call.reject("Clock handoff result is unconfirmed; do not repeat it");}});
 }
 @Override protected void handleOnDestroy(){super.handleOnDestroy();ClockAgentReview.abandon();}
}
