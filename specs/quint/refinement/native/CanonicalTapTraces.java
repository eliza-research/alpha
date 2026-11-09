package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.Intent;
import com.getcapacitor.PluginCall;
import java.io.IOException;
import java.lang.reflect.Field;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import org.json.JSONArray;
import org.json.JSONObject;

/** Synthetic Android/owner ports. The compiled actor and bridge own the slot and gates. */
final class TapPorts {
 interface Work {void run()throws Exception;}
 static final Context context=new Context();
 static final ArrayDeque<Runnable> serial=new ArrayDeque<>(),worker=new ArrayDeque<>();
 static boolean authorized,visible;
 static int actor,events;
 static long now;
 static Work duringForeground,duringSession;
 static Projector projector;
 static ReadAck readAck;
 interface Projector {boolean open(Intent intent,String owner)throws Exception;}
 interface ReadAck {JSONObject post(String id)throws Exception;}
 static void requireForeground()throws Exception {
  if(duringForeground!=null)duringForeground.run();
  if(!visible)throw new SecurityException("Synthetic foreground unavailable");
 }
}

// The product actor resolves the package-local clock in this JVM fixture.
final class System {static long currentTimeMillis(){return TapPorts.now;}}
final class ElizaAgentService {static final class LocalStreamHandle {void cancel(){}}}
final class NativeOwnerReminderHost {
 NativeOwnerReminderHost(Context context){}
 String reviewFence(JSONObject identity){return "fixture-owner-fence";}
}
final class NativeNotificationProjector {
 static boolean onOpened(Context context,Intent intent,String owner)throws Exception{return TapPorts.projector.open(intent,owner);}
 static void retireOwner(Context context,String owner){}
}
final class AlphaLocalAgentPlugin {
 static void checkNotificationSession(JSONObject expected)throws Exception{
  if(!TapPorts.authorized||expected.getInt("generation")!=TapPorts.actor)throw new SecurityException("Synthetic session retired");
  if(TapPorts.duringSession!=null){var hook=TapPorts.duringSession;TapPorts.duringSession=null;hook.run();}
 }
 static JSONObject markNotificationRead(JSONObject session,String id)throws Exception{return TapPorts.readAck.post(id);}
}

public final class CanonicalTapTraces {
 public static long elapsedRealtime(){return TapPorts.now;}
 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 static Field field(String name)throws Exception{
  var value=AlphaCanonicalNotifications.class.getDeclaredField(name);value.setAccessible(true);return value;
 }
 static AlphaCanonicalNotifications actor()throws Exception{return (AlphaCanonicalNotifications)field("active").get(null);}
 static JSONObject pending()throws Exception{return (JSONObject)field("pendingTap").get(null);}
 static JSONObject idleTap(){return new JSONObject().put("sequence",0).put("id",0).put("owner",0).put("route","none").put("verified",false);}
 static int number(String value){return Integer.parseInt(value.substring(value.lastIndexOf('-')+1));}
 static JSONObject tap(Intent value){
  if(value==null)return idleTap();
  return new JSONObject().put("sequence",number(value.getStringExtra("fixtureSequence")))
   .put("id",number(value.getStringExtra("notificationId"))).put("owner",number(value.getStringExtra("elizaNativeNotificationOwner")))
   .put("route",value.getStringExtra("deepLink")).put("verified","ok".equals(value.getStringExtra("fixtureVerification")));
 }
 static JSONObject empty(){return new JSONObject().put("token",0).put("id",0).put("owner",0).put("agent",0)
  .put("view","none").put("expires",0).put("conversation",false).put("message",false);}

 static final class Fixture {
  final AlphaNotificationsPlugin bridge=new AlphaNotificationsPlugin();
  final LinkedHashMap<String,Integer> tokens=new LinkedHashMap<>();
  final LinkedHashMap<Integer,String> noticeIds=new LinkedHashMap<>();
  final LinkedHashSet<Integer> sent=new LinkedHashSet<>();
  final Trace trace;
  int captures,lastActor,opener,requestToken,checkedActor;
  boolean bridgeAlive=true,dispatchReached;
  String kind="none";
  Intent opening;
  PluginCall request;

  Fixture(String name)throws Exception{
   AlphaCanonicalNotifications.stop();
   field("waitingTap").set(null,null);
   TapPorts.serial.clear();TapPorts.worker.clear();
   TapPorts.actor=0;TapPorts.authorized=false;TapPorts.visible=true;TapPorts.events=0;TapPorts.now=0;
   TapPorts.duringForeground=null;TapPorts.duringSession=null;
   bridge.load();
   trace=new Trace(name,state());
  }
  JSONObject delivery(JSONObject data){
   if(data==null||data.length()==0)return empty();
   String token=data.getString("token"), id=data.getString("notificationId");
   int value=tokens.computeIfAbsent(token,_token->tokens.size()+1);
   noticeIds.putIfAbsent(value,id);
   if(data.has("conversationId"))check(data.getString("conversationId").equals("synthetic-conversation"),"chat conversation preserved");
   if(data.has("messageId"))check(data.getString("messageId").equals("synthetic-message"),"chat message preserved");
   return new JSONObject().put("token",value).put("id",number(id)).put("owner",number(data.getString("ownerId")))
    .put("agent",number(data.getString("agentId"))).put("view",data.getString("view")).put("expires",data.getLong("expiresAt"))
    .put("conversation",data.has("conversationId")).put("message",data.has("messageId"));
  }
  JSONObject state()throws Exception{
   var active=actor();
   JSONObject identity=active==null?null:(JSONObject)field("identity").get(active);
   var pending=delivery(pending());
   var reply="read".equals(kind)&&request.result!=null?delivery(request.result.data):empty();
   String phase=request==null?"idle":request.rejected?"rejected":request.result!=null?"ok":
    dispatchReached?"posted":checkedActor!=0?"checked":"queued";
   var call=new JSONObject().put("kind",kind).put("phase",phase).put("token",requestToken).put("actor",checkedActor);
   return Trace.fields("waiting",tap((Intent)field("waitingTap").get(null)),"opening",tap(opening),"opener",opener,
    "pending",pending,"readback",reply,"captures",captures,"issued",tokens.size(),"active",active==null?0:TapPorts.actor,
    "lastActor",lastActor,"owner",identity==null?0:number(identity.getString("subjectUserId")),
    "agent",identity==null?0:number(identity.getString("agentId")),"authorized",active!=null&&TapPorts.authorized,
    "now",TapPorts.now,"bridge",bridgeAlive,"visible",TapPorts.visible,"readyEvents",TapPorts.events,
    "call",call,"posted",new JSONArray(sent));
  }
  void record(String action,Object... args)throws Exception{trace.step(action,state(),args);}
  void attach(int owner,int agent)throws Exception{
   var ctor=AlphaCanonicalNotifications.class.getDeclaredConstructor(Context.class);ctor.setAccessible(true);
   var current=ctor.newInstance(TapPorts.context);
   TapPorts.actor=++lastActor;TapPorts.authorized=true;
   field("identity").set(current,new JSONObject().put("subjectUserId","owner-"+owner).put("agentId","agent-"+agent));
   field("session").set(current,new JSONObject().put("generation",lastActor));
   field("owner").set(current,"owner-"+owner);field("fence").set(current,"fixture-owner-fence");
   field("active").set(null,current);
   record("attach",lastActor,owner,agent);
  }
  void detach(boolean retire)throws Exception{
   if(retire)AlphaCanonicalNotifications.stop();else AlphaCanonicalNotifications.suspendForRestart();
   record("detach",retire);
  }
  void authorized(boolean allowed)throws Exception{TapPorts.authorized=allowed;record("authorize",allowed);}
  void visible(boolean allowed)throws Exception{TapPorts.visible=allowed;record("foreground",allowed);}
  void time(int now)throws Exception{TapPorts.now=now;record("time",now);}
  void destroy()throws Exception{bridge.handleOnDestroy();bridgeAlive=!bridge.noticeGate.destroyed();record("destroyBridge");}
  void capture(int id,int owner,String route,boolean verified)throws Exception{
   int serial=TapPorts.serial.size();
   Intent input=new Intent("fixture-notification","synthetic-private-route")
    .putExtra("elizaNativeNotificationOwner","owner-"+owner).putExtra("notificationId","notice-"+id)
    .putExtra("deepLink",route).putExtra("fixtureSequence","sequence-"+(++captures))
    .putExtra("fixtureVerification",verified?"ok":"reject");
   if("/chat".equals(route))input.putExtra("conversationId","synthetic-conversation").putExtra("messageId","synthetic-message");
   AlphaCanonicalNotifications.captureTap(TapPorts.context,input);
   check(input.getData()==null&&Intent.ACTION_MAIN.equals(input.getAction()),"source strips original route");
   check(!input.hasExtra("deepLink")&&!input.hasExtra("conversationId")&&!input.hasExtra("messageId"),"source strips original route extras");
   check(TapPorts.serial.size()==serial+(actor()==null?0:1),"source queues verification only with active actor");
   record("capture",id,owner,route,verified);
  }
  void rejectIngress()throws Exception{
   Intent external=new Intent("ordinary","ordinary");
   var waiting=field("waitingTap").get(null);
   AlphaCanonicalNotifications.captureTap(TapPorts.context,external);
   check("ordinary".equals(external.getData())&&field("waitingTap").get(null)==waiting,"noncanonical ingress left to existing routing");
   record("rejectIngress");
  }
  void open(TapPorts.Work overlap)throws Exception{
   var current=actor();
   TapPorts.projector=(intent,owner)->{
    opener=TapPorts.actor;opening=intent;record("beginOpen");
    if(overlap!=null)overlap.run();
    return owner.equals(intent.getStringExtra("elizaNativeNotificationOwner"))&&"ok".equals(intent.getStringExtra("fixtureVerification"));
   };
   // The exact verifier is also called by hydration/rechecks. Hold unrelated queued work.
   var consume=AlphaCanonicalNotifications.class.getDeclaredMethod("consumeWaitingTap");
   consume.setAccessible(true);consume.invoke(current);
   if(opening!=null){opening=null;opener=0;record("finishOpen");}
   else trace.stutter("authority check refuses before projector; waiting slot stays",state());
  }
  void open()throws Exception{open(null);}
  void create(int id,String route)throws Exception{capture(id,1,route,true);open();}
  private void drain() {
   check(TapPorts.worker.size()==1,"one actual bridge call is queued");
   TapPorts.worker.remove().run();
   check(request.rejected||request.result!=null,"actual bridge call settles");
  }
  private String rawToken(int value){
   if(value==0)return "absent";
   return tokens.entrySet().stream().filter(entry->entry.getValue()==value).findFirst().orElseThrow().getKey();
  }
  void queueRead()throws Exception{
   kind="read";requestToken=checkedActor=0;dispatchReached=false;request=new PluginCall(null);
   bridge.canonicalPending(request);record("queueRead");
  }
  void read(TapPorts.Work beforeExposure)throws Exception{
   queueRead();TapPorts.duringSession=beforeExposure;drain();TapPorts.duringSession=null;record("readResult");
  }
  void read()throws Exception{read(null);}
  void checkReadCopy()throws Exception{
   check(request.result!=null&&request.result.data.has("token"),"fixture has an exposed readback");
   request.result.data.put("notificationId","mutated-copy");
   read();
  }
  void queueAck(int token)throws Exception{
   kind="ack";requestToken=token;checkedActor=0;dispatchReached=false;request=new PluginCall(rawToken(token));
   bridge.acknowledgeCanonical(request);record("queueAck",token);
  }
  void settleAck(String portReply,TapPorts.Work beforeCompare,TapPorts.Work afterPost)throws Exception{
   int[] foregroundChecks={0};
   TapPorts.duringForeground=()->{
    if(++foregroundChecks[0]==2){
     checkedActor=TapPorts.actor;record("beginAck");
     if(beforeCompare!=null)beforeCompare.run();
    }
   };
   TapPorts.readAck=id->{
    check(pending()==null,"exact slot cleared before synthetic read acknowledgement");
    check(noticeIds.get(requestToken).equals(id),"post owns the captured notice");
    check(sent.add(requestToken),"token cannot dispatch again");
    dispatchReached=true;record("compareClear");
    if(afterPost!=null)afterPost.run();
    if("lost".equals(portReply))throw new IOException("Synthetic lost reply");
    return new JSONObject().put("status","ok".equals(portReply)?200:409);
   };
   drain();TapPorts.duringForeground=null;
   if(dispatchReached){
    if(request.result!=null)check(request.result.data.optBoolean("ok"),"source positive acknowledgment");
    record("finishAck","ok".equals(portReply));
   }else if(checkedActor!=0)record("compareClear");
   else record("refuseQueuedAck");
  }
  void ack(int token,String portReply)throws Exception{queueAck(token);settleAck(portReply,null,null);}
 }

 public static void main(String[] args)throws Exception{
  JSONArray traces=new JSONArray();
  {
   Fixture f=new Fixture("cold-latest-and-non-consuming-copy");
   f.rejectIngress();f.capture(1,1,"/chat",true);f.capture(2,1,"/notes",true);
   f.read();f.attach(1,1);f.open();f.read();f.checkReadCopy();f.ack(1,"ok");traces.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("older-verification-preserves-a-newer-waiting-clone");
   f.attach(1,1);f.capture(1,1,"/chat",true);f.open(()->f.capture(1,1,"/notes",true));
   f.read();f.open();f.read();traces.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("projector-refusal-route-refusal-and-authority-retention");
   f.attach(1,1);f.create(1,"/chat");f.capture(2,2,"/notes",true);f.open();
   f.capture(2,1,"/unsupported",true);f.open();f.capture(3,1,"/notes",true);
   f.authorized(false);f.open();f.read();f.authorized(true);f.open();f.read();traces.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("exact-expiry-boundary-for-read-and-compare");
   f.attach(1,1);f.create(1,"/chat");f.time(300000);f.read();f.time(300001);f.read();f.ack(1,"ok");
   f.create(2,"/notes");f.time(600001);f.read();f.ack(2,"ok");traces.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("new-pending-token-arrives-before-old-compare");
   f.attach(1,1);f.create(1,"/chat");f.queueAck(1);
   f.settleAck("ok",()->f.create(2,"/notes"),null);f.read();f.ack(2,"ok");traces.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("lost-or-unconfirmed-reply-never-replays-or-clears-newer-tap");
   f.attach(1,1);f.create(1,"/chat");f.queueAck(1);
   f.settleAck("lost",null,()->f.create(2,"/notes"));f.ack(1,"ok");f.read();f.ack(2,"status");f.ack(2,"ok");
   traces.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("suspend-preserves-both-slots-and-owner-agent-readback");
   f.attach(1,1);f.create(1,"/chat");f.capture(2,1,"/notes",true);
   f.detach(false);f.read();f.attach(1,2);f.read();f.detach(false);f.attach(1,1);f.read();
   f.detach(true);f.read();traces.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("foreground-refusal-before-compare-and-after-post");
   f.attach(1,1);f.create(1,"/chat");f.read(()->f.visible(false));f.queueAck(1);f.settleAck("ok",null,null);
   f.visible(true);f.queueAck(1);f.settleAck("ok",()->f.visible(false),null);
   f.visible(true);f.queueAck(1);f.settleAck("ok",null,()->f.visible(false));traces.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("actor-replacement-before-compare-and-destroyed-bridge");
   f.attach(1,1);f.create(1,"/chat");f.queueAck(1);
   f.settleAck("ok",()->{f.detach(false);f.attach(2,1);},null);f.read();
   f.queueRead();f.destroy();f.drain();f.record("readResult");f.capture(2,2,"/notes",true);f.open();traces.put(f.trace.value);
  }
  java.lang.System.out.println(traces);
 }
}
