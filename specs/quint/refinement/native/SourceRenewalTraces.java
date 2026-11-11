package ai.alphacompute.alphaphone;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.PluginCall;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public final class SourceRenewalTraces implements AutoCloseable {
 static final long EXPIRY=2000;
 public static long now=1000;
 static SourceRenewalTraces active;
 final Context context=new Context();
 final Trace trace;
 final Map<Integer,String> keys=new HashMap<>();
 final Map<String,Integer> tokens=new LinkedHashMap<>();
 AlphaHostedResultsPlugin bridge;
 SourceRenewalNotices notices;
 String raw,writeFault="none";
 int writes,failAt,owner=1,revision=1,process=1;
 boolean online=true,revoked;
 JSONObject reply=reply("none",0,0,false);

 SourceRenewalTraces(String name)throws Exception{
  active=this;
  for(int id=1;id<=4;id++){
   JSONObject chosen=selection(id);
   String key=HostedResultNotices.hash(new JSONArray().put(chosen.getString("ownerId")).put(chosen.getString("agentId"))
    .put(chosen.getString("installationId")).put(chosen.getString("enrollmentId")).put(chosen.getString("sourceId"))
    .put(chosen.getString("revision")).put(EXPIRY).toString());
   keys.put(id,key);
  }
  load();
  trace=new Trace(name,observe());
 }
 void load(){
  notices=SourceRenewalHost.get(context);bridge=new AlphaHostedResultsPlugin();bridge.attach(context);
  check(SourceRenewalHost.get(context)==notices,"One renewal host per process");
 }
 static void check(boolean valid,String label){if(!valid)throw new AssertionError(label);}
 static JSONObject selection(int id){
  int owner=id==4?2:1, revision=id==3?2:1, source=id==2?2:1;
  return new JSONObject().put("provider","native").put("ownerId","synthetic-owner-"+owner).put("agentId","synthetic-agent")
   .put("installationId","synthetic-install").put("enrollmentId","synthetic-enrollment-"+owner)
   .put("sourceId","synthetic-source-"+source).put("revision","synthetic-revision-"+revision);
 }
 static String read(Context c,String slot){check(c==active.context&&slot.equals("hosted-notices:renewals:v1"),"Exact credential slot");return active.raw;}
 static void write(Context c,String slot,String value)throws Exception{
  read(c,slot);
  var f=active;int attempt=++f.writes;
  if(attempt==f.failAt&&f.writeFault.equals("before"))throw new IOException("Synthetic write refused before replacement");
  f.raw=value;
  if(attempt==f.failAt){
   if(f.writeFault.equals("after"))throw new IOException("Synthetic write reported failure after replacement");
   if(f.writeFault.equals("stale"))f.revoked=true;
   if(f.writeFault.equals("offline"))f.online=false;
  }
 }
 static JSONObject describe(Context c,JSONObject input)throws Exception{
  check(c==active.context&&input.length()==8&&input.getString("action").equals("describe"),"Host uses the exact describe-only boundary");
  JSONObject chosen=new JSONObject(input.toString());chosen.remove("action");
  boolean exact=false;for(int id=1;id<=4;id++)if(chosen.similar(selection(id)))exact=true;
  check(exact,"Describe forwards only the exact reviewed tuple");
  if(!active.online)throw new IOException("Synthetic resident unavailable");
  if(!input.getString("ownerId").equals("synthetic-owner-"+active.owner))throw new NativeDigestSources.SourceChanged("Owner changed");
  int version=input.getString("sourceId").endsWith("-2")?1:active.revision;
  return new JSONObject().put("revoked",active.revoked).put("revision","synthetic-revision-"+version)
   .put("expiresAt",Instant.ofEpochMilli(EXPIRY).toString());
 }

 JSONObject disk(){return raw==null?new JSONObject():new JSONObject(raw);}
 int idOf(String key){
  for(var row:keys.entrySet())if(row.getValue().equals(key))return row.getKey();
  throw new AssertionError("Unknown synthetic route");
 }
 int token(String token){
  check(token.matches("[0-9a-f-]{36}"),"Opaque persisted UUID");
  return tokens.computeIfAbsent(token,key->tokens.size()+1);
 }
 String tokenText(int id){return tokens.entrySet().stream().filter(e->e.getValue()==id).map(Map.Entry::getKey).findFirst().orElse("foreign-token");}
 static JSONObject reply(String status,int id,int token,boolean question){
  return new JSONObject().put("status",status).put("id",id).put("token",token).put("question",question);
 }

public static void beforeNotify(String tag,Notification notice){
  var f=active;
  String prefix="alpha-source-renewal-";
  check(tag.startsWith(prefix),"Exact redacted renewal tag");
  String key=tag.substring(prefix.length());int id=f.idOf(key);
  check(f.disk().getJSONObject(key).getString("phase").equals("dispatching"),"Notification attempt follows durable dispatch reservation");
  check(notice.channel.equals("alpha-hosted-results")&&notice.title.equals("A brief source expires soon")&&
   notice.text.equals("Renew it to keep your brief updated.")&&notice.category.equals("reminder")&&
   notice.visibility==Notification.VISIBILITY_PRIVATE&&notice.icon==1&&notice.onlyOnce&&notice.autoCancel&&notice.timeout==EXPIRY-now&&
   notice.publicNotice.title.equals("Alpha Phone")&&notice.publicNotice.text.equals("Tap to open."),"Redacted notice, timeout and lifecycle flags");
  check(notice.actions.size()==2&&notice.actions.get(0).title().equals("Renew")&&notice.actions.get(0).tap()==notice.tap&&
   notice.actions.get(1).title().equals("Ask Alpha")&&notice.actions.get(1).authenticated(),"Exact two notice actions and question authentication");
  checkRoute(notice.tap,key,HostedNoticePoster.RENEW_ACTION);
  checkRoute(notice.actions.get(1).tap(),key,HostedNoticePoster.ASK_RENEW_ACTION);
  check(f.disk().getJSONObject(key).getJSONObject("selection").similar(selection(id)),"Notification tag matches exact durable tuple");
 }
 static void checkRoute(PendingIntent tap,String key,String action){
  Intent intent=tap.intent;
  check(tap.code==key.hashCode()&&intent.component==MainActivity.class&&intent.action.equals(action)&&
   intent.data.toString().equals(HostedNoticePoster.RENEW_PREFIX+key)&&intent.flags==(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP),
   "Exact opaque, immutable product tap target");
 }

 JSONObject observe(){
  JSONArray rows=new JSONArray(),visible=new JSONArray(),routes=new JSONArray();
  JSONObject disk=disk();
  for(int id=1;id<=4;id++){
   String key=keys.get(id);JSONObject row=disk.optJSONObject(key);
   if(row!=null)check(row.getLong("expiresAt")==EXPIRY&&row.getJSONObject("selection").similar(selection(id))&&
    row.keySet().equals(row.has("pending")?Set.of("selection","expiresAt","phase","pending"):Set.of("selection","expiresAt","phase")),
    "Only exact source consent identity, expiry and tap state persisted");
   JSONObject pending=row==null?null:row.optJSONObject("pending");
   rows.put(new JSONArray().put(id).put(new JSONObject().put("phase",row==null?"none":row.getString("phase"))
    .put("token",pending==null?0:token(pending.getString("token"))).put("question",pending!=null&&pending.getBoolean("question"))));
   if(context.manager.active.containsKey("alpha-source-renewal-"+key))visible.put(id);
   long live=context.manager.taps.values().stream().filter(tap->!tap.cancelled&&tap.intent.data.toString().endsWith(key)).count();
   check(live==0||live==2,"Renew and Ask routes share exact retirement");
   if(live==2)routes.put(id);
  }
  return Trace.fields("rows",rows,"visible",visible,"routes",routes,"serial",tokens.size(),"now",now,"owner",owner,
   "revision",revision,"online",online,"revoked",revoked,"gate",context.manager.gate,"posts",context.manager.posts,"cancels",context.manager.cancels,
   "wakeups",bridge.wakeups,"process",process,"locked",context.keyguard.locked,"reply",reply);
 }
 void point(String action,Object... args){trace.step(action,observe(),args);}
 interface Operation {void run()throws Exception;}
 void run(Operation op){
  try{op.run();reply=reply("ok",0,0,false);}
  catch(SourceRenewalNotices.RenewalStale stale){reply=reply("stale",0,0,false);}
  catch(SourceRenewalNotices.RenewalUnverifiable offline){reply=reply("unverifiable",0,0,false);}
  catch(Exception refused){reply=reply("failed",0,0,false);}
  finally{failAt=0;writeFault="none";context.manager.refusePost=false;}
 }
 void fault(String mode){
  writes=0;failAt=0;writeFault="none";context.manager.reads=0;
  switch(mode){
   case "none" -> {}
   case "before" -> {failAt=1;writeFault="before";}
   case "final-before" -> {failAt=2;writeFault="before";}
   case "final-after" -> {failAt=2;writeFault="after";}
   case "notify-fail" -> context.manager.refusePost=true;
   case "stale-after" -> {failAt=1;writeFault="stale";}
   case "offline-after" -> {failAt=1;writeFault="offline";}
   default -> throw new AssertionError(mode);
  }
 }
 void arm(int id,boolean fail){fault(fail?"before":"none");run(()->check(notices.arm(selection(id),EXPIRY,now).equals(keys.get(id)),"Exact opaque route hash"));point("arm",id,fail);}
 void post(int id,String mode){fault(mode);run(()->notices.post(keys.get(id),now));point("post",id,mode);}
 void clear(int id,boolean fail){fault(fail?"before":"none");run(()->notices.clear(selection(id)));point("clear",id,fail);}
 void withdraw(int kept,boolean fail){
  fault(fail?"before":"none");
  run(()->notices.withdrawOtherOwners(kept==0?null:new JSONObject().put("origin","https://device.alpha.invalid")
   .put("ownerId","synthetic-owner-"+kept).put("agentId","synthetic-agent")));
  point("withdraw",kept,fail);
 }
 ExecutorService worker()throws Exception{return (ExecutorService)Trace.read(bridge,"io");}
 void drain()throws Exception{worker().submit(()->{}).get(8,TimeUnit.SECONDS);}
 void capture(int id,String mode,boolean fail)throws Exception{
  String key=keys.get(id);
  String action=mode.equals("question")?HostedNoticePoster.ASK_RENEW_ACTION:mode.equals("foreign")?"foreign":HostedNoticePoster.RENEW_ACTION;
  String uri=(mode.equals("wrong-prefix")?"foreign:":HostedNoticePoster.RENEW_PREFIX)+key;
  Intent intent=context.manager.taps.values().stream().filter(tap->tap.intent.action.equals(action)&&tap.intent.data.toString().equals(uri))
   .findFirst().map(tap->new Intent(tap.intent)).orElseGet(()->new Intent(context,MainActivity.class).setAction(action).setData(Uri.parse(uri)));
  fault(fail?"before":"none");bridge.handleOnNewIntent(intent);drain();fault("none");
  reply=reply(intent.getData()==null?"consumed":"ignored",0,0,false);
  point("capture",id,mode,fail);
 }
 void pending()throws Exception{
  PluginCall call=new PluginCall(new JSONObject());bridge.pendingSourceRenewal(call);drain();check(call.answered,"Pending read settles");
  if(call.rejection!=null)reply=reply("rejected",0,0,false);
  else if(call.result.isEmpty())reply=reply("empty",0,0,false);
  else{
   check(call.result.keySet().equals(Set.of("token","question","selection","expiresAt"))&&call.result.getLong("expiresAt")==EXPIRY,
    "Only the exact durable renewal receipt crosses the unlocked bridge");
   int id=0;for(int candidate=1;candidate<=4;candidate++)if(call.result.getJSONObject("selection").similar(selection(candidate)))id=candidate;
   check(id!=0,"Exact pending selection");
   reply=reply("pending",id,token(call.result.getString("token")),call.result.getBoolean("question"));
  }
  point("pending");
 }
 void settle(int token,boolean discard)throws Exception{
  PluginCall call=new PluginCall(new JSONObject().put("token",tokenText(token)).put("discard",discard));
  bridge.settleSourceRenewal(call);drain();check(call.answered,"Settle answers exact pending call");
  reply=reply(call.rejection==null?"ok":"rejected",0,0,false);point("settle",token,discard);
 }
 void control(String field,boolean value){
  switch(field){
   case "online" -> online=value;
   case "revoked" -> revoked=value;
   case "locked" -> context.keyguard.locked=value;
   default -> throw new AssertionError(field);
  }
  point("control",field,value);
 }
 void owner(int id){owner=id;point("owner",id);}
 void revision(int version){revision=version;point("revision",version);}
 void gate(String mode){context.manager.gate=mode;point("gate",mode);}
 void time(long value){now=value;point("time",value);}
 void restart()throws Exception{
  close();
  var field=SourceRenewalHost.class.getDeclaredField("instance");field.setAccessible(true);field.set(null,null);
  process++;load();point("restart");
 }
 @Override public void close()throws Exception{
  bridge.handleOnDestroy();check(worker().awaitTermination(8,TimeUnit.SECONDS),"Synthetic bridge worker terminated");
 }

 public static void main(String[] args)throws Exception{
  String name=args[0];
  try(var f=new SourceRenewalTraces(name)){
   switch(name){
    case "two-taps-and-purpose" -> {
     f.arm(1,false);f.capture(1,"question",false);f.post(1,"none");
     f.capture(1,"foreign",false);f.capture(1,"wrong-prefix",false);
     f.capture(1,"question",false);f.pending();f.capture(1,"renew",false);f.pending();
     f.settle(1,false);f.settle(2,true);f.settle(2,false);f.pending();
    }
    case "cross-source-exact-token" -> {
     f.arm(1,false);f.arm(2,false);f.post(1,"none");f.post(2,"none");
     f.capture(1,"question",false);f.capture(2,"question",false);f.settle(1,true);
     f.control("locked",true);f.pending();f.settle(2,true);f.control("locked",false);f.pending();f.settle(2,true);
    }
    case "owner-switch" -> {
     f.arm(1,false);f.post(1,"none");f.capture(1,"question",false);f.pending();
     f.owner(2);f.settle(1,false);f.capture(1,"question",false);f.pending();
     f.arm(4,false);f.post(4,"none");f.withdraw(2,false);f.withdraw(0,false);
    }
    case "revision-exact-clear" -> {
     f.arm(1,false);f.post(1,"none");f.clear(3,false);f.revision(2);
     f.arm(3,false);f.post(3,"none");f.capture(1,"renew",false);f.capture(3,"question",false);
     f.pending();f.clear(3,false);f.pending();
    }
    case "unverifiable-retry" -> {
     f.arm(1,false);f.control("online",false);f.post(1,"none");f.control("online",true);
     f.post(1,"offline-after");f.control("online",true);f.post(1,"none");f.capture(1,"question",false);
     f.control("online",false);f.pending();f.control("online",true);f.pending();f.time(EXPIRY);f.pending();
    }
    case "revoked-after-reserve" -> {f.arm(1,false);f.post(1,"stale-after");f.capture(1,"question",false);f.pending();}
    case "post-write-refusal" -> {
     f.arm(1,false);f.post(1,"before");f.post(1,"final-before");f.restart();f.post(1,"none");f.post(1,"none");
    }
    case "post-final-write-report" -> {f.arm(1,false);f.post(1,"final-after");f.restart();f.post(1,"none");}
    case "post-admission-flip" -> {
     f.arm(1,false);f.gate("flip");f.post(1,"none");
     String skipped=f.disk().getJSONObject(f.keys.get(1)).getString("phase");
     check(f.context.manager.posts==0&&skipped.equals("armed")&&f.reply.getString("status").equals("failed"),
      "Skipped renewal must remain armed. Observed durable phase: "+skipped);
     f.gate("allowed");f.post(1,"none");
     check(f.context.manager.posts==1&&f.disk().getJSONObject(f.keys.get(1)).getString("phase").equals("posted"),
      "The exact armed row can post when admission returns");
     f.arm(2,false);f.gate("flip");f.post(2,"final-before");
     check(f.context.manager.posts==1&&f.disk().getJSONObject(f.keys.get(2)).getString("phase").equals("dispatching"),
      "A refused reset save leaves the durable dispatch reservation retryable");
     f.gate("allowed");f.post(2,"none");
     check(f.context.manager.posts==2&&f.disk().getJSONObject(f.keys.get(2)).getString("phase").equals("posted"),
      "The exact interrupted reservation can post when admission returns");
    }
    case "failed-clear-and-withdraw" -> {
     f.arm(1,false);f.post(1,"none");f.clear(1,true);f.post(1,"none");f.capture(1,"question",false);f.pending();
     f.withdraw(0,true);f.pending();f.withdraw(0,false);f.pending();
    }
    case "notification-refusal" -> {
     f.arm(1,false);f.gate("denied");f.post(1,"none");f.gate("allowed");f.post(1,"notify-fail");
     f.post(1,"none");f.capture(1,"question",true);f.pending();f.capture(1,"question",false);f.pending();
    }
    default -> throw new AssertionError(name);
   }
   java.lang.System.out.println(f.trace.value);
  }
 }
}
