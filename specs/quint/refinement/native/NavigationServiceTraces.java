package ai.elizaresearch.alphaphone;

import android.app.PendingIntent;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;

/** Complete native bridge and service, with controlled Android command delivery. */
public final class NavigationServiceTraces {
 final AlphaMapsTransportPlugin a=new AlphaMapsTransportPlugin(),b=new AlphaMapsTransportPlugin();
 final AlphaNavigationService service=new AlphaNavigationService();
 final Trace trace;
 PendingIntent savedStop;
 String lastCall="none";
 NavigationServiceTraces(String name)throws Exception{
  a.fixtureOwner=1;b.fixtureOwner=2;a.load();b.load();
  trace=new Trace("native-navigation-"+name,observe());
 }
 AlphaMapsTransportPlugin plugin(int owner){return owner==1?a:b;}
 static String id(int value){return switch(value){case 1->"route_A_1234";case 2->"route_B_5678";default->"invalid";};}
 static int id(String value){return "route_A_1234".equals(value)?1:"route_B_5678".equals(value)?2:0;}
 static String data(int value){return "synthetic-"+value;}
 static int data(String value){return value!=null&&value.startsWith("synthetic-")?Integer.parseInt(value.substring(10)):0;}
 static PluginCall call(int id,int title,int text){
  return new PluginCall(new JSObject().put("sessionId",id(id)).put("title",data(title)).put("text",data(text)));
 }
 static Object active()throws Exception{
  Field field=AlphaNavigationService.class.getDeclaredField("active");field.setAccessible(true);return field.get(null);
 }
 static int authority(Object session)throws Exception{
  return session==null?0:NavigationServicePorts.authority((String)Trace.read(session,"authority"));
 }
 static int authority(PendingIntent notification){
  return notification==null?0:NavigationServicePorts.authority(notification.intent.getStringExtra(AlphaNavigationService.EXTRA_AUTHORITY));
 }
 static JSONObject qset(JSONArray array){return new JSONObject().put("quintCollection","set").put("values",array);}
 JSONObject observe()throws Exception{
  String[] snapshot=AlphaNavigationService.snapshot();Object active=active();
  JSONArray commands=new JSONArray(),events=new JSONArray(),destroyed=new JSONArray();
  for(Intent intent:NavigationServicePorts.commands){
   String kind=intent.getAction().endsWith(".START")?"start":intent.getAction().endsWith(".UPDATE")?"update":"stop";
   commands.put(new JSONObject().put("kind",kind).put("id",id(intent.getStringExtra(AlphaNavigationService.EXTRA_SESSION)))
    .put("authority",NavigationServicePorts.authority(intent.getStringExtra(AlphaNavigationService.EXTRA_AUTHORITY))));
  }
  for(int i=0;i<NavigationServicePorts.events.length();i++){
   JSONObject event=NavigationServicePorts.events.getJSONObject(i);
   events.put(new JSONObject().put("owner",event.getInt("owner")).put("id",id(event.getString("id"))).put("reason",event.getString("reason")));
  }
  for(int i=1;i<=2;i++)if((boolean)Trace.read(plugin(i),"destroyed"))destroyed.put(i);
  Object listener=active==null?null:Trace.read(active,"owner");
  int owner=listener==null?0:listener==Trace.read(a,"navigationStops")?1:listener==Trace.read(b,"navigationStops")?2:-1;
  int activeEpoch=authority(active),ownedEpoch=authority(Trace.read(service,"owned"));
  return Trace.fields("destroyed",qset(destroyed),"permission",NavigationServicePorts.permission,"declared",NavigationServicePorts.declared,
   "issued",NavigationServicePorts.authorities.size(),"active",activeEpoch,"activeId",id(snapshot[0]),"owner",owner,
   "title",data(snapshot[3]),"text",data(snapshot[4]),"terminalStops",Integer.parseInt(snapshot[1]),
   "lastReason",snapshot[2].isEmpty()?"none":snapshot[2],"events",events,"commands",commands,
   "fallbackStops",NavigationServicePorts.fallbackStops,"lastCall",lastCall,"owned",ownedEpoch,"shown",service.foreground,
   "notification",service.notification==null?0:authority(service.notification.stop),
   "notificationTitle",service.notification==null?0:data(service.notification.title),
   "notificationText",service.notification==null?0:data(service.notification.text),"savedStop",authority(savedStop),
   "foregroundCalls",service.foregroundCalls,"removeCalls",service.stopForegroundCalls,"stopSelfCalls",service.stopSelfCalls);
 }
 static String outcome(PluginCall call,String field){
  if(call.settles!=1)throw new AssertionError("Native call must settle exactly once");
  if(call.error!=null){
   if(call.code==null&&call.error.equals("Invalid navigation session"))return "invalid";
   if("permission-denied".equals(call.code))return "permission";
   if("unavailable".equals(call.code))return "unavailable";
   throw new AssertionError(call.error);
  }
  return switch(field){
   case "start"->"done";
   case "stop"->call.result.getBoolean("stopped")?"stopped":"not-stopped";
   case "update"->call.result.getBoolean("active")?"active":"inactive";
   default->throw new AssertionError(field);
  };
 }
 PluginCall invokeStart(int owner,int id,int title,int text){
  PluginCall call=call(id,title,text);plugin(owner).startNavigation(call);return call;
 }
 void start(int owner,int id,int title,int text,boolean dispatches)throws Exception{
  NavigationServicePorts.failStart=!dispatches;
  lastCall=outcome(invokeStart(owner,id,title,text),"start");
  trace.step("start",observe(),owner,id,title,text,dispatches);
 }
 void capabilities(boolean declared,boolean permission)throws Exception{
  NavigationServicePorts.declared=declared;NavigationServicePorts.permission=permission;
  trace.step("capabilities",observe(),declared,permission);
 }
 void update(int owner,int id,int title,int text)throws Exception{
  PluginCall call=call(id,title,text);plugin(owner).updateNavigation(call);lastCall=outcome(call,"update");
  trace.step("update",observe(),owner,id,title,text);
 }
 void stop(int owner,int id)throws Exception{
  PluginCall call=call(id,1,1);plugin(owner).stopNavigation(call);lastCall=outcome(call,"stop");
  trace.step("stop",observe(),owner,id);
 }
 void destroy(int owner)throws Exception{
  plugin(owner).handleOnDestroy();trace.step("destroy",observe(),owner);
 }
 void fallback(int owner,int id,int successor)throws Exception{
  NavigationServicePorts.beforeStopRefusal=()->{
   if(successor!=0&&!outcome(invokeStart(successor,2,2,2),"start").equals("done"))
    throw new AssertionError("Successor refused");
  };
  PluginCall call=call(id,1,1);plugin(owner).stopNavigation(call);lastCall=outcome(call,"stop");
  trace.step("fallback",observe(),owner,id,successor);
 }
 void deliver(int index,boolean foreground)throws Exception{
  NavigationServicePorts.failForeground=!foreground;
  Intent command=NavigationServicePorts.commands.remove(index);
  service.onStartCommand(command,0,++service.latestStartId);
  NavigationServicePorts.failForeground=false;
  trace.step("deliver",observe(),index,foreground);
 }
 void saveNotification()throws Exception{
  savedStop=service.notification.stop;trace.step("saveNotification",observe());
 }
 void press(boolean saved)throws Exception{
  service.onStartCommand((saved?savedStop:service.notification.stop).intent,0,++service.latestStartId);
  trace.step("press",observe(),saved);
 }
 void malformedStop()throws Exception{
  Intent forged=new Intent(NavigationServicePorts.context,AlphaNavigationService.class)
   .setAction(AlphaNavigationService.ACTION_STOP).putExtra(AlphaNavigationService.EXTRA_SESSION,id(1));
  service.onStartCommand(forged,0,++service.latestStartId);trace.step("malformedStop",observe());
 }
 void taskRemoved()throws Exception{service.onTaskRemoved(null);trace.step("taskRemoved",observe());}
 void serviceDestroyed()throws Exception{service.onDestroy();trace.step("serviceDestroyed",observe());}
 void supersededStart()throws Exception{
  NavigationServicePorts.afterStartDispatch=()->{
   if(!outcome(invokeStart(2,1,2,2),"start").equals("done"))throw new AssertionError("Successor refused");
   throw new IllegalStateException("first OS start returned after replacement");
  };
  lastCall=outcome(invokeStart(1,1,1,1),"start");
  trace.step("supersededStart",observe());
 }
 void admissionAfterDestroy()throws Exception{
  Field field=AlphaNavigationService.class.getDeclaredField("lock");field.setAccessible(true);
  Object lock=field.get(null);
  CountDownLatch entered=new CountDownLatch(1);
  AtomicReference<PluginCall> attempt=new AtomicReference<>();
  AtomicReference<Throwable> problem=new AtomicReference<>();
  Thread late=new Thread(()->{
   entered.countDown();
   try{attempt.set(invokeStart(1,1,1,1));}catch(Throwable failure){problem.set(failure);}
  },"held renderer admission");
  late.setDaemon(true);
  synchronized(lock){
   late.start();if(!entered.await(5,TimeUnit.SECONDS))throw new AssertionError("No native start attempt");
   long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
   while(late.getState()!=Thread.State.BLOCKED&&System.nanoTime()<deadline)Thread.yield();
   if(late.getState()!=Thread.State.BLOCKED)throw new AssertionError("Start did not reach admission lock");
   a.handleOnDestroy();
   if(!outcome(invokeStart(2,2,2,2),"start").equals("done"))throw new AssertionError("Successor refused");
  }
  late.join(5000);
  if(late.isAlive()||problem.get()!=null)throw new AssertionError("Held start did not settle",problem.get());
  lastCall=outcome(attempt.get(),"start");
  trace.macro("old renderer reaches admission after destruction",observe(),
   Trace.action("destroy",1),Trace.action("start",2,2,2,2,true),Trace.action("start",1,1,1,1,true));
 }
 void scenario(String name)throws Exception{
  switch(name){
   case "old-plugin-destroy" -> {start(1,1,1,1,true);start(2,2,2,2,true);destroy(1);deliver(2,true);}
   case "notification-owner" -> {start(1,1,1,1,true);deliver(0,true);press(false);press(false);}
   case "stale-start-command" -> {start(1,1,1,1,true);start(2,2,2,2,true);deliver(2,true);deliver(0,true);deliver(0,true);}
   case "old-notification" -> {start(1,1,1,1,true);deliver(0,true);saveNotification();start(2,2,2,2,true);deliver(1,true);press(true);}
   case "same-public-id" -> {start(1,1,1,1,true);deliver(0,true);saveNotification();start(2,1,2,2,true);deliver(1,true);press(true);press(false);}
   case "fallback-successor" -> {start(1,1,1,1,true);fallback(1,1,2);deliver(1,true);}
   case "fallback-idle" -> {start(1,1,1,1,true);fallback(1,1,0);deliver(0,true);}
   case "foreign-stop-update" -> {start(1,1,1,1,true);start(2,2,2,2,true);stop(1,2);update(1,2,3,4);deliver(2,true);}
   case "duplicate-app-stop" -> {start(1,1,1,1,true);deliver(0,true);stop(1,1);stop(1,1);deliver(0,true);}
   case "malformed-notification" -> {start(1,1,1,1,true);deliver(0,true);malformedStop();}
   case "stale-update" -> {start(1,1,1,1,true);deliver(0,true);update(1,1,3,4);update(1,1,4,3);deliver(1,true);deliver(0,true);}
   case "old-task-removal" -> {start(1,1,1,1,true);deliver(0,true);start(2,2,2,2,true);taskRemoved();deliver(1,true);}
   case "task-removal" -> {start(1,1,1,1,true);deliver(0,true);taskRemoved();}
   case "old-service-destroy" -> {start(1,1,1,1,true);deliver(0,true);start(2,2,2,2,true);serviceDestroyed();}
   case "service-destroy" -> {start(1,1,1,1,true);deliver(0,true);serviceDestroyed();}
   case "foreground-refused" -> {start(1,1,1,1,true);deliver(0,false);}
   case "old-foreground-refused" -> {start(1,1,1,1,true);start(2,2,2,2,true);deliver(2,true);deliver(0,false);}
   case "dispatch-refused" -> {start(1,1,1,1,false);deliver(0,true);}
   case "dispatch-failure-after-replacement" -> {supersededStart();deliver(2,true);deliver(0,true);}
   case "retired-before-admission" -> admissionAfterDestroy();
   case "refusals" -> {start(1,0,1,1,true);capabilities(false,true);start(1,1,1,1,true);
    capabilities(true,false);start(1,1,1,1,true);capabilities(true,true);destroy(1);start(1,1,1,1,true);}
   default -> throw new AssertionError(name);
  }
 }
 public static void main(String[] args)throws Exception{
  NavigationServiceTraces traces=new NavigationServiceTraces(args[0]);traces.scenario(args[0]);
  System.out.println(traces.trace.value);
 }
}
