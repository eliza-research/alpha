package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.calendar.ScopedCalendarReviewProvider;
import android.os.SystemClock;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

public final class ScopedCalendarReviewTraces {
 private final ScopedCalendarReviewProvider provider = new ScopedCalendarReviewProvider();
 private final AlphaCalendarPlugin plugin = new AlphaCalendarPlugin(provider);
 private final CalendarScopedDeletionReview review = new CalendarScopedDeletionReview(plugin);
 private PluginCall inspecting, reviewing;
 private JSONObject selected, canonical;
 private Runnable queuedUi;
 private String competing = "none", providerState = "exact";
 private boolean held;
 private long inspectEpoch=-1, ticketEpoch=-1, reviewEpoch=-1;
 private final CountDownLatch entered = new CountDownLatch(1);
 private final CountDownLatch release = new CountDownLatch(1);
 private final Trace trace;

 private ScopedCalendarReviewTraces(String name)throws Exception {
  SystemClock.now=0;
  trace=new Trace(name,observe());
 }

 private JSONObject ticket()throws Exception {
  Map<?,?> tickets=(Map<?,?>)Trace.read(review,"tickets");
  if(tickets.isEmpty())return null;
  if(tickets.size()!=1)throw new AssertionError("One synthetic selected tuple");
  return (JSONObject)Trace.read(tickets.values().iterator().next(),"target");
 }

 private JSONObject observe()throws Exception {
  Map<?,?> tickets=(Map<?,?>)Trace.read(review,"tickets");
  long ticketExpiry=tickets.isEmpty()?0L:(Long)Trace.read(tickets.values().iterator().next(),"expires");
  boolean busy=((AtomicBoolean)Trace.read(review,"reviewing")).get();
  boolean dialog=plugin.activity.shown!=null&&plugin.activity.shown.isShowing();
  String staged=plugin.stages.isEmpty()?"none":canonical.similar(plugin.stages.get(plugin.stages.size()-1))?"canonical":"changed";
  return Trace.fields("epoch",Trace.read(review,"epoch"),"retired",Trace.read(review,"retired"),
   "ticket",!tickets.isEmpty(),"ticketEpoch",tickets.isEmpty()?-1:ticketEpoch,
   "expires",ticketExpiry,"now",SystemClock.now,"inspectHeld",held,"inspectEpoch",held?inspectEpoch:-1,
   "inspectResult",inspecting==null?"none":inspecting.status(),
   "reviewPhase",dialog?"dialog":busy?"queued":"idle","reviewEpoch",busy?reviewEpoch:-1,
   "reviewResult",reviewing==null?"none":reviewing.status(),
   "competing",competing,"provider",providerState,"granted",plugin.context.granted,
   "locked",plugin.context.lock.locked,"focused",plugin.activity.focused,"dialogFocused",plugin.activity.dialogFocused,
   "resumed",plugin.activity.lifecycle.state==Lifecycle.State.RESUMED,
   "stageRefused",plugin.refuseStage,"stageCount",plugin.stages.size(),"staged",staged);
 }

 private void step(String action,Object... args)throws Exception{trace.step(action,observe(),args);}

 private PluginCall inspectCall(boolean visibleMatches) {
  JSONObject expected=new JSONObject().put("title",visibleMatches?ScopedCalendarReviewProvider.TITLE:"Unrelated")
   .put("body",ScopedCalendarReviewProvider.BODY).put("location",ScopedCalendarReviewProvider.LOCATION)
   .put("begin",ScopedCalendarReviewProvider.BEGIN).put("end",ScopedCalendarReviewProvider.END);
  JSObject data=new JSObject();data.put("id","42").put("calendarId","7").put("scope","occurrence").put("expected",expected);
  return new PluginCall(data);
 }

 private void acceptInspection()throws Exception {
  JSONObject response=inspecting.result();
  if("ready".equals(response.getString("status"))) {
   if(!response.keySet().equals(java.util.Set.of("status","eventId","revision","sourceRevision","sourceId","scope")))
    throw new AssertionError("Unexpected inspection projection "+response.keySet());
   selected=response;
   ticketEpoch=inspectEpoch;
   canonical=new JSONObject(ticket().toString());
  }
 }

 private void inspect(boolean visibleMatches)throws Exception {
  inspectEpoch=(Long)Trace.read(review,"epoch");
  inspecting=inspectCall(visibleMatches);review.inspect(inspecting);acceptInspection();
  step("inspect",visibleMatches);
 }

 private void holdInspect()throws Exception {
  // The last permission read is after the worker's generation comparison and before remember().
  plugin.context.afterPermissionRead=count->{
   if(count!=4)return;
   entered.countDown();
   try{if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("Inspection was not released");}
   catch(InterruptedException interrupted){throw new AssertionError(interrupted);}
  };
  inspectEpoch=(Long)Trace.read(review,"epoch");
  inspecting=inspectCall(true);review.inspect(inspecting);
  if(!entered.await(5,TimeUnit.SECONDS))throw new AssertionError("Inspection did not reach final permission read");
  held=true;step("holdInspect");
 }

 private void finishInspect()throws Exception {
  release.countDown();acceptInspection();held=false;step("finishInspect");
 }

 private PluginCall reviewCall(String key) {
  JSObject data=new JSObject();
  JSONObject request=selected==null?new JSONObject():selected;
  for(String field:request.keySet())data.put(field,request.get(field));
  if(!key.equals("exact")&&!key.equals("forged"))data.put(key,"synthetic-mismatch");
  if(key.equals("forged")) {
   data.put("scope","series").put("providerEventId",99).put("begin",1).put("account","Unreviewed account");
   data.put("fields",new JSONObject().put("title","Unreviewed title"));
  }
  return new PluginCall(data);
 }

 private void request(String key)throws Exception {
  reviewEpoch=(Long)Trace.read(review,"epoch");
  reviewing=reviewCall(key);review.review(reviewing,null);
  // A refusal resolves directly. A successful review posts its exact UI runnable.
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
  while("pending".equals(reviewing.status())&&queuedUi==null&&System.nanoTime()<deadline)
   queuedUi=plugin.activity.ui.poll(10,TimeUnit.MILLISECONDS);
  if("pending".equals(reviewing.status())&&queuedUi==null)throw new AssertionError("No review result or UI work");
  step("request",key);
 }

 private void probeBusy()throws Exception {
  PluginCall call=reviewCall("exact");review.review(call,null);competing=call.result().getString("status");step("probeBusy");
 }

 private void show()throws Exception {
  if(queuedUi==null)throw new AssertionError("No queued review work");
  queuedUi.run();queuedUi=null;
  if(plugin.activity.shown!=null&&plugin.activity.shown.isShowing()) {
   String message=plugin.activity.shown.message;
   if(!message.contains("Series")||!message.contains("This occurrence only")||message.contains("Unreviewed"))
    throw new AssertionError("Review does not display the canonical selected occurrence");
  }
  step("show");
 }

 private void answer(boolean confirm)throws Exception {
  plugin.activity.shown.choose(confirm);reviewing.result();step("answer",confirm);
 }

 private void pause()throws Exception {review.pause();step("pause");}
 private void destroy()throws Exception {review.destroy();step("destroy");}
 private void grant(boolean value)throws Exception {plugin.context.granted=value;step("grant",value);}
 private void lock()throws Exception {plugin.context.lock.locked=true;step("lock");}
 private void stop()throws Exception {plugin.activity.lifecycle.state=Lifecycle.State.STARTED;step("stop");}
 private void focusDialog()throws Exception {plugin.activity.focused=false;plugin.activity.dialogFocused=true;step("focusDialog");}
 private void clock(long now)throws Exception {SystemClock.now=now;step("clock",now);}
 private void change(String kind)throws Exception {
  if(kind.equals("event"))provider.changeEvent();else provider.changeSource();
  providerState=kind;step("change",kind);
 }
 private void refuseStage()throws Exception {plugin.refuseStage=true;step("refuseStage");}

 private void run(String name)throws Exception {
  switch(name) {
   case "exact-target" -> {inspect(true);request("forged");show();focusDialog();answer(true);}
   case "wrong-keys" -> {inspect(true);for(String key:java.util.List.of("eventId","revision","sourceId","sourceRevision"))request(key);}
   case "visible-mismatch" -> {inspect(false);request("exact");}
   case "at-expiry" -> {inspect(true);clock(60000);request("exact");show();answer(false);}
   case "after-expiry" -> {inspect(true);clock(60001);request("exact");}
   case "provider-event" -> {inspect(true);change("event");request("exact");}
   case "provider-source" -> {inspect(true);change("source");request("exact");}
   case "competing" -> {inspect(true);request("exact");probeBusy();show();answer(false);}
   case "pause-queued" -> {inspect(true);request("exact");pause();show();request("exact");}
   case "pause-open" -> {inspect(true);request("exact");show();pause();}
   case "retired-queued" -> {inspect(true);request("exact");destroy();show();inspect(true);}
   case "revoked-before-open" -> {inspect(true);request("exact");grant(false);show();}
   case "revoked-at-answer" -> {inspect(true);request("exact");show();grant(false);answer(true);}
   case "locked-at-answer" -> {inspect(true);request("exact");show();lock();answer(true);}
   case "stopped-at-answer" -> {inspect(true);request("exact");show();stop();answer(true);}
   case "uncertain-enqueue" -> {inspect(true);request("exact");show();refuseStage();answer(true);}
   case "inspect-held-current" -> {holdInspect();finishInspect();request("exact");show();answer(false);}
   case "inspect-pause-commit" -> {holdInspect();pause();finishInspect();request("exact");
    inspect(true);request("exact");show();answer(false);}
   case "inspect-destroy-commit" -> {holdInspect();destroy();finishInspect();request("exact");}
   default -> throw new IllegalArgumentException(name);
  }
 }

 public static void main(String[] args)throws Exception {
  var driver=new ScopedCalendarReviewTraces(args[0]);
  try{driver.run(args[0]);System.out.println(driver.trace.value);}
  finally{driver.release.countDown();driver.review.destroy();}
 }
}
