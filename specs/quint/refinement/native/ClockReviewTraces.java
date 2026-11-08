package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.actionjournal.ActionJournal;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Handler;
import android.provider.AlarmClock;
import com.getcapacitor.PluginCall;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ClockReviewTraces {
 static final String SCOPE="a".repeat(64), HASH="b".repeat(64), ID="clock-proposal", OP="clock-operation";
 static final long EXPIRES=2_000;
 static long now=1_000;
 static final Map<String,String> slots=new ConcurrentHashMap<>();
 static String refusalPhase, refusalMode;
 static void check(boolean valid,String reason){if(!valid)throw new AssertionError(reason);}
 static void write(String key,String raw)throws Exception{
  JSONObject entry=key.endsWith(":entry:"+ID)?new JSONObject(raw):null;
  JSONObject clock=entry==null?null:entry.optJSONObject("clockReview");
  if(clock!=null&&clock.optString("phase").equals(refusalPhase)){
   if("after".equals(refusalMode))slots.put(key,raw);
   throw new IOException("Synthetic Clock journal refusal");
  }
  slots.put(key,raw);
 }

 static final class Fixture {
  final AlphaActionJournalPlugin first=new AlphaActionJournalPlugin(), second=new AlphaActionJournalPlugin();
  final ActionJournal journal=AlphaActionJournal.get(first.getContext());
  final Map<String,Integer> tokens=new LinkedHashMap<>();
  final Map<Integer,PluginCall> dialogs=new LinkedHashMap<>();
  final Trace trace;
  final String action;
  final JSONObject operation;
  PluginCall confirmation;
  Runnable queued;
  int confirming;
  String outcome="none";

  Fixture(String name,String action)throws Exception{
   this.action=action;
   java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
   operation=new JSONObject().put("type","clock_handoff").put("action",action);
   if(action.equals("set"))operation.put("hour",7).put("minute",30).put("label","Synthetic reviewed alarm")
    .put("timeZone","Etc/UTC").put("days",new JSONArray().put(7).put(2));
   if(action.equals("snooze"))operation.put("snoozeMinutes",12);
   JSONObject record=new JSONObject().put("operation",operation).put("expiresAt",EXPIRES)
    .put("context",new JSONObject().put("sensitive",false));
   for(String field:Set.of("ownerId","sessionId","agentId","origin","installationId","enrollmentId"))record.put(field,"synthetic-"+field);
   journal.reserve(SCOPE,ID,OP,HASH,record);
   journal.markApplying(SCOPE,ID,"clock-attempt");
   for(int bridge=1;bridge<=2;bridge++)plugin(bridge).activity.beforeStart=this::beforeStart;
   trace=new Trace(name,observe());
   trace.value.put("init",Trace.action("initWith",action));
  }

  AlphaActionJournalPlugin plugin(int actor){return actor==1?first:second;}

  JSONObject entry(){
   String raw=slots.get(journal.entrySlot(SCOPE,ID));
   return new JSONObject(raw);
  }

  JSONObject clock(){
   JSONObject value=entry().optJSONObject("clockReview");
   return value==null?new JSONObject():value;
  }

  void beforeStart(Intent intent){
   check(clock().optString("phase").equals("dispatching")&&!clock().has("reviewToken"),
    "Exact token is durably consumed before Android effect");
   check(intent.component!=null&&intent.component.packageName().equals("com.synthetic.clock"),
    "Handoff resolves and binds an external component");
   if(action.equals("set")){
    check(AlarmClock.ACTION_SET_ALARM.equals(intent.action) &&
     intent.extras.get(AlarmClock.EXTRA_HOUR).equals(7) && intent.extras.get(AlarmClock.EXTRA_MINUTES).equals(30) &&
     intent.extras.get(AlarmClock.EXTRA_MESSAGE).equals("Synthetic reviewed alarm") &&
     Boolean.FALSE.equals(intent.extras.get(AlarmClock.EXTRA_SKIP_UI)) &&
     intent.extras.get(AlarmClock.EXTRA_DAYS).equals(java.util.List.of(2,7)), "Exact reviewed set tuple, no skip UI");
   }else check(AlarmClock.ACTION_SHOW_ALARMS.equals(intent.action)&&intent.extras.isEmpty(),
    "Agent show/dismiss/snooze only opens Clock with no alarm mutation options");
  }

  int tokenClass(String token){
   if(token==null)return 0;
   check(java.util.UUID.fromString(token).version()==4,"Opaque review token");
   return tokens.computeIfAbsent(token,value->tokens.size()+1);
  }

  String tokenValue(int token){
   return tokens.entrySet().stream().filter(entry->entry.getValue()==token).map(Map.Entry::getKey).findFirst()
    .orElse("foreign-token");
  }

  int openOwner()throws Exception{
   var field=ClockAgentReview.class.getDeclaredField("open");field.setAccessible(true);
   Object row=((Map<?,?>)field.get(null)).get(SCOPE+":"+ID);
   if(row==null)return 0;
   Object owner=Trace.read(row,"owner");
   check(owner==first||owner==second,"Claim belongs to an exact plugin object");
   return owner==first?1:2;
  }

  AlertDialog dialog(int actor){return plugin(actor).activity.dialogs.getLast();}

  JSONObject observe()throws Exception{
   JSONObject outer=entry(),clock=clock();
   int token=tokenClass(clock.optString("reviewToken",null));
   JSONArray visible=new JSONArray(),retired=new JSONArray(),dialogReplies=new JSONArray();
   for(int actor=1;actor<=2;actor++){
    var plugin=plugin(actor);
    dialogReplies.put(new JSONArray().put(actor).put(dialogs.containsKey(actor)?reply(dialogs.get(actor)):"none"));
    if(plugin.activity.dialogs.stream().anyMatch(d->d.visible))visible.put(actor);
    if(plugin.activity.destroyed)retired.put(actor);
   }
   JSONObject result=clock.optJSONObject("result"), outerResult=outer.optJSONObject("result");
   String claim=outerResult==null?"none":outerResult.has("clockResult")?outerResult.getJSONObject("clockResult").getString("status"):"bare-unknown";
   return Trace.fields("operation",action,"outerPhase",outer.getString("phase"),"outerStatus",outer.optString("status","none"),"outerClaim",claim,
    "phase",clock.optString("phase","none"),"token",token,"issued",tokens.size(),"openOwner",openOwner(),
    "visible",visible,"retired",retired,"dialogReplies",dialogReplies,"expired",now>=EXPIRES,
    "confirming",confirming,"attempts",first.activity.attempted+second.activity.attempted,
    "deliveries",first.activity.delivered.size()+second.activity.delivered.size(),
    "receipt",result==null?"none":result.getString("status"),"outcome",outcome);
  }

  void point(String action,Object... args)throws Exception{trace.step(action,observe(),args);}
  void stutter(String label)throws Exception{trace.stutter(label,observe());}

  JSONObject callData(){
   return new JSONObject().put("scope",SCOPE).put("proposalId",ID).put("operationId",OP);
  }

  String reply(PluginCall call){
   if(!call.done())return "pending";
   if(call.rejection!=null)return "rejected";
   if(call.result.has("reviewToken")){tokenClass(call.result.getString("reviewToken"));return "approved";}
   return call.result.getJSONObject("result").getString("status");
  }

  void drain(int actor)throws Exception{
   ExecutorService worker=(ExecutorService)Trace.read(plugin(actor),"worker");
   if(worker.isShutdown())check(worker.awaitTermination(4,TimeUnit.SECONDS),"Destroyed bridge worker retired");
   else worker.submit(()->{}).get(4,TimeUnit.SECONDS);
  }

  void refuse(String phase,String mode){
   refusalPhase=mode.equals("complete")?null:phase;
   refusalMode=mode;
  }

  void review(int actor,String admission,String saved)throws Exception{
   var plugin=plugin(actor);
   var copy=new JSONObject(operation.toString());
   if(admission.equals("changed"))copy.put("unreviewedOption",true);
   plugin.activity.focused=!admission.equals("background");
   plugin.activity.keyguard.locked=admission.equals("locked");
   refuse(action.equals("show")?"approved":"reviewing",saved);
   var call=new PluginCall(callData().put("operation",copy));
   int count=plugin.activity.dialogs.size();
   plugin.reviewClock(call);
   drain(actor);
   refusalPhase=null;
   if(plugin.activity.dialogs.size()>count)dialogs.put(actor,call);
   outcome=reply(call);
   plugin.activity.focused=true;plugin.activity.keyguard.locked=false;
   point("review",actor,admission,saved);
  }

  void answer(int actor,String choice,String saved)throws Exception{
   refuse(choice.equals("positive")?"approved":"cancelled",saved);
   Handler.run(()->dialog(actor).deliver(choice));
   drain(actor);
   refusalPhase=null;
   outcome=reply(dialogs.get(actor));
   point("answer",actor,choice,saved);
  }

  void retire(int actor)throws Exception{
   plugin(actor).handleOnDestroy();
   if(confirming!=actor)drain(actor);
   point("retire",actor);
  }

  void expire()throws Exception{now=EXPIRES;point("expire");}

  void cancel(int actor,String saved)throws Exception{
   refuse("cancelled",saved);
   var call=new PluginCall(callData());
   plugin(actor).cancelClock(call);
   call.await();drain(actor);
   if(actor==1&&confirming!=2)drain(2);if(actor==2&&confirming!=1)drain(1);
   refusalPhase=null;
   outcome=reply(call);
   point("cancel",actor,saved);
  }

  void confirm(int actor,int token,String admission,String saved,boolean hold)throws Exception{
   var plugin=plugin(actor);
   plugin.activity.keyguard.locked=admission.equals("locked");
   plugin.activity.focused=!admission.equals("background");
   if(admission.equals("zone"))java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("America/Los_Angeles"));
   refuse("dispatching",saved);
   if(hold)Handler.holdAt=2;
   confirmation=new PluginCall(callData().put("reviewToken",tokenValue(token)));
   plugin.confirmClock(confirmation);
   if(hold){queued=Handler.take();confirming=actor;}
   else {confirmation.await();drain(actor);}
   refusalPhase=null;
   outcome=reply(confirmation);
   plugin.activity.keyguard.locked=false;plugin.activity.focused=true;
   java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("UTC"));
   point("confirm",actor,token,admission,saved);
  }

  void dispatch(String port,String saved)throws Exception{
   var plugin=plugin(confirming);
   switch(port){
    case "locked":plugin.activity.keyguard.locked=true;break;
    case "none":plugin.activity.receiver=null;break;
    case "self":plugin.activity.receiver=plugin.activity.getPackageName();break;
    case "zone":java.util.TimeZone.setDefault(java.util.TimeZone.getTimeZone("America/Los_Angeles"));break;
    default:plugin.activity.effect=port;
   }
   refuse("finished",saved);
   Handler.run(queued);
   confirmation.await();drain(confirming);
   refusalPhase=null;
   outcome=reply(confirmation);
   confirming=0;
   point("dispatch",port,saved);
  }

  void finish(int actor,String claimed)throws Exception{
   String status=claimed.equals("opened")?"succeeded":claimed.equals("unknown")?"unknown":"failed";
   JSONObject result=new JSONObject().put("operationId",OP);
   if(!claimed.equals("bare-unknown"))result.put("clockResult",new JSONObject().put("kind","clock-handoff").put("action",action).put("status",claimed));
   var call=new PluginCall(callData().put("status",claimed.equals("bare-unknown")?"unknown":status).put("summary","Synthetic receipt").put("result",result));
   plugin(actor).finish(call);call.await();drain(actor);
   outcome=call.rejection!=null?"rejected":call.result.getJSONObject("entry").getString("status");
   point("finish",actor,claimed);
  }
 }

 static void approved(Fixture f,int actor)throws Exception{
  f.review(actor,"complete","complete");
  if(!f.action.equals("show"))f.answer(actor,"positive","complete");
 }

 public static void main(String[] args)throws Exception{
  String mode=args[0];
  String action=switch(mode){
   case "show-lost-mark","show-self","show-missing","show-denied","show-unknown-before" -> "show";
   case "snooze-manual" -> "snooze";
   case "dismiss-manual","cancel-current-review" -> "dismiss";
   default -> "set";
  };
  Fixture f=new Fixture(mode,action);
  switch(mode){
   case "late-dialog":
    f.review(1,"complete","complete");f.retire(1);f.review(2,"complete","complete");
    check(f.openOwner()==2 && f.dialog(2).visible,"Successor holds visible review");
    f.answer(1,"positive","complete");
    check(f.openOwner()==0 && f.dialog(2).visible && f.clock().optString("phase").equals("reviewing"),
     "As built, late old callback removes the successor without a receipt");
    f.answer(2,"positive","complete");
    check(!f.dialogs.get(2).done(),"Successor callback no longer has a claim");
    break;
   case "fabricated-outer":
    f.finish(1,"ringing");f.finish(1,"opened");
    check(f.entry().getString("status").equals("succeeded") && f.clock().isEmpty() && f.first.activity.attempted==0,
     "As built, structurally valid opened can finish without native dispatch");
    break;
   case "approved-once":
    f.confirm(1,0,"complete","complete",false);
    f.review(1,"changed","complete");f.review(1,"complete","complete");f.review(2,"complete","complete");
    f.answer(1,"positive","complete");
    f.confirm(1,0,"complete","complete",false);f.confirm(1,1,"locked","complete",false);
    f.confirm(1,1,"zone","complete",false);f.confirm(2,1,"complete","complete",true);
    f.dispatch("opened","complete");f.confirm(1,1,"complete","complete",false);
    f.finish(1,"ringing");f.finish(1,"opened");f.finish(1,"opened");f.finish(1,"denied");
    break;
   case "review-storage-and-foreground-retry":
    f.review(1,"complete","before");f.review(1,"complete","after");
    f.review(1,"background","complete");f.review(1,"complete","complete");
    f.answer(1,"positive","before");f.review(2,"complete","complete");f.answer(2,"negative","complete");
    f.finish(2,"failed");
    break;
   case "approval-committed-before-failure-report":
    f.review(1,"complete","complete");f.answer(1,"positive","after");
    f.review(2,"complete","complete");f.cancel(2,"complete");
    f.confirm(2,1,"complete","complete",false);f.finish(2,"failed");
    break;
   case "cancel-current-review":
    f.review(1,"complete","complete");f.cancel(2,"before");
    f.cancel(2,"after");f.cancel(2,"complete");
    f.confirm(1,0,"complete","complete",false);f.finish(2,"failed");
    break;
   case "show-lost-mark":
    approved(f,1);f.confirm(1,1,"complete","before",false);
    f.confirm(1,1,"complete","after",false);
    f.confirm(2,1,"complete","complete",false);f.finish(2,"unknown");
    break;
   case "show-self":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("self","complete");
    f.finish(1,"unavailable");
    break;
   case "show-missing":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("missing","complete");
    f.finish(1,"unavailable");
    break;
   case "show-denied":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("denied","complete");
    f.finish(1,"denied");
    break;
   case "show-unknown-before":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("unknown-before","complete");
    f.finish(1,"unknown");
    break;
   case "snooze-manual":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("opened","complete");
    f.finish(1,"opened");
    break;
   case "dismiss-manual":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("opened","complete");
    f.finish(1,"opened");
    break;
   case "effect-before-refused-receipt":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("unknown-after","before");
    f.confirm(2,1,"complete","complete",false);f.finish(2,"bare-unknown");
    break;
   case "terminal-receipt-before-refusal":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("opened","after");
    f.confirm(2,1,"complete","complete",false);f.finish(2,"opened");
    break;
   case "expire-after-consume":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.expire();f.dispatch("opened","complete");
    f.finish(1,"failed");
    break;
   case "retire-after-consume":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.retire(1);f.dispatch("opened","complete");
    f.confirm(2,1,"complete","complete",false);f.finish(2,"bare-unknown");
    break;
   case "bare-unknown-can-retire-approved-token":
    approved(f,1);f.finish(2,"bare-unknown");f.cancel(2,"complete");f.confirm(1,1,"complete","complete",false);
    break;
   case "lock-after-consume":
    approved(f,1);f.confirm(1,1,"complete","complete",true);f.dispatch("locked","complete");
    f.finish(1,"failed");
    break;
   default:throw new AssertionError("Unknown scenario "+mode);
  }
  f.first.handleOnDestroy();f.second.handleOnDestroy();
  java.lang.System.out.println(f.trace.value);
 }
}
