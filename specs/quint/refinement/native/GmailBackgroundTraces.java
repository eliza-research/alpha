package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.notifications.MailBackgroundDelivery;
import ai.eliza.plugins.notifications.MailHistoryReconciliation;
import ai.eliza.plugins.notifications.MailNoticePoster;
import android.content.Context;
import androidx.work.*;
import com.getcapacitor.PluginCall;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.json.*;

public final class GmailBackgroundTraces {
 private static final String[] OWNER={"","11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222"};
 private static final String ORG="33333333-3333-4333-8333-333333333333";
 private static final String[] HISTORY={"","10000000000000000000","10000000000000000005","10000000000000000009"};
 private static final Context context=new Context();
 private static final Map<String,Integer> generations=new HashMap<>();
 private static final Set<String> shown=new HashSet<>();
 private static AlphaGmailPlugin primary=new AlphaGmailPlugin(),secondary=new AlphaGmailPlugin();
 private static Trace trace;
 private static String state,fault="none",script="none",workReply="none",bridgeReply="none";
 private static int credential=1,owner=1,grants=3,periodic,catchup,schedules,cancels,posts,historyReads,process=1;
 private static int configuring,configOwner,configCredential,configAttempt,workGeneration,workEpoch;
 private static boolean configGrantVerified;
 private static PluginCall configuringCall;
 private static Thread worker;
 private static WorkerParameters parameters;
 private static String workerOutput;
 private static Throwable workerError;
 private static boolean observable=true;
 static boolean reset;
 public static boolean allowed=true;
 private static Hold hold;
 private record Hold(String route,CountDownLatch entered,CountDownLatch released) {
  Hold(String route){this(route,new CountDownLatch(1),new CountDownLatch(1));}
  void waitAtPort()throws IOException {
   entered.countDown();
   try {if(!released.await(10,TimeUnit.SECONDS))throw new IOException("Synthetic port wait exceeded");}
   catch(InterruptedException e){Thread.currentThread().interrupt();throw new IOException(e);}
  }
  void await()throws Exception {
   if(!entered.await(7,TimeUnit.SECONDS))throw new AssertionError("Operation missed its controlled transport boundary");
  }
 }

 static String read(String key) {
  return switch(key) {
   case "gmail-background:v1" -> state;
   case "cloud:production" -> credential==0?null:new JSONObject().put("credentialId","fixture-credential")
    .put("token","fixture-token-"+credential).toString();
   default -> throw new AssertionError("Unexpected credential slot "+key);
  };
 }
 static void write(String key,String value)throws Exception {
  if(!key.equals("gmail-background:v1"))throw new AssertionError("Unexpected write");
  String outcome=fault;
  fault="none";
  if(outcome.equals("before"))throw new IOException("Synthetic precommit refusal");
  state=value;
  JSONObject binding=new JSONObject(value).getJSONObject("binding");
  generations.computeIfAbsent(binding.getString("generation"),ignored->generations.size()+1);
  if(outcome.equals("after"))throw new IOException("Synthetic postcommit refusal");
 }
 static void remove(String key) {
  if(!key.equals("gmail-background:v1"))throw new AssertionError("Unexpected removal");
  state=null;
 }

 public static void configurePoster(MailNoticePoster.Config config) {
  if(!config.channel.equals("alpha-gmail")||!config.action.equals("ai.elizaresearch.alphaphone.OPEN_GMAIL_NOTICE")
      ||!config.open.equals("alpha-gmail:")||!config.ask.equals("alpha-gmail-ask:")||!config.tag.equals("alpha-gmail-")
      ||!config.title.equals("New mail in Gmail")||!config.text.equals("Tap to open Inbox.")
      ||!config.publicTitle.equals("Alpha Phone")||!config.publicText.equals("Tap to open.")
      ||config.activity!=MainActivity.class)throw new AssertionError("Unexpected installed notice identity");
 }
 public static boolean active(String key){return shown.contains(key);}
 public static void post(String key) {
  JSONObject durable=new JSONObject(state),notice=durable.getJSONObject("notices").getJSONObject(key);
  if(!key.matches("[a-f0-9]{64}")||!"dispatching".equals(notice.getString("phase"))||!allowed)
   throw new AssertionError("Unreserved synthetic post");
  posts++;
  if(observable)shown.add(key);
 }
 public static void cancel(String key){shown.remove(key);}
 public static void cancelAll(){shown.clear();}
 public static void schedule(String name,String policy,WorkFields work,long interval) {
  if(work.worker!=GmailDeliveryWorker.class||work.constraints.network()!=NetworkType.CONNECTED
      ||work.backoff!=BackoffPolicy.EXPONENTIAL||work.delay!=30||!work.data.values().keySet().equals(Set.of("generation")))
   throw new AssertionError("Unexpected WorkManager request");
  int generation=generations.get(work.data.getString("generation"));
  switch(name) {
   case "alpha-gmail-periodic" -> {
    if(!policy.equals("UPDATE")||interval!=900)throw new AssertionError("Wrong periodic work policy");
    periodic=generation;schedules++;
   }
   case "alpha-gmail-catchup" -> {
    if(!policy.equals("KEEP")||interval!=0)throw new AssertionError("Wrong catch-up work policy");
    if(catchup==0)catchup=generation;
   }
   default -> throw new AssertionError("Unexpected WorkManager identity");
  }
 }
 public static void cancelWork(String name) {
  switch(name) {
   case "alpha-gmail-periodic" -> {periodic=0;cancels++;}
   case "alpha-gmail-catchup" -> catchup=0;
   default -> throw new AssertionError("Unexpected WorkManager cancellation");
  }
 }

 private static String grant(int grant){return "fixture-grant-"+grant;}
 private static int grantClass(String value){
  for(int i=1;i<=2;i++)if(grant(i).equals(value))return i;
  throw new AssertionError("Unknown grant class");
 }
 private static int ownerClass(String value){
  for(int i=1;i<OWNER.length;i++)if(OWNER[i].equals(value))return i;
  throw new AssertionError("Unknown owner class");
 }
 private static int cursor(JSONObject value,String key) {
  if(value==null||value.isNull(key))return 0;
  return switch(value.getString(key)){
   case "10000000000000000000" -> 1;
   case "10000000000000000005" -> 2;
   case "10000000000000000009" -> 3;
   default -> throw new AssertionError("Unexpected history ID: "+key);
  };
 }

 private static JSONObject page(String grant,String start,String token) {
  JSONArray events=new JSONArray();
  String status="page",history=HISTORY[2],next=null,checkpoint=HISTORY[2];
  if(script.equals("baseline")) {status="baseline-required";history=HISTORY[1];checkpoint=null;}
  if(script.equals("reset") && start!=null) {status="reset-required";history=null;checkpoint=null;}
  if(script.equals("reset") && start==null) {status="baseline-required";history=HISTORY[3];checkpoint=null;}
  if(script.equals("continued")) {
   int index=token==null?0:Integer.parseInt(token.substring("fixture-page-".length()));
   next="fixture-page-"+(index+1);checkpoint=null;
  }
  if(script.equals("malformed"))checkpoint=HISTORY[3];
  if(script.equals("notify")||script.equals("continued")&&token==null) {
   String event="10000000000000000001";
   events.put(new JSONObject().put("id",event+":message-added:fixture-mail").put("type","message-added")
    .put("historyId",event).put("messageId","fixture-mail").put("threadId","fixture-thread")
    .put("messageAvailable",true).put("labelIds",new JSONArray().put("INBOX").put("UNREAD")));
  }
  return new JSONObject().put("version",1).put("grantId",grant).put("startHistoryId",start==null?JSONObject.NULL:start)
   .put("status",status).put("historyId",history==null?JSONObject.NULL:history)
   .put("checkpoint",checkpoint==null?JSONObject.NULL:checkpoint).put("nextPageToken",next==null?JSONObject.NULL:next)
   .put("events",events).put("backfillRequired",!status.equals("page"));
 }

 private static Map<String,String> parameters(URL url) {
  Map<String,String> values=new HashMap<>();
  for(String field:url.getQuery().split("&")) {
   String[] item=field.split("=",2);
   if(item.length!=2||values.put(item[0],URLDecoder.decode(item[1],StandardCharsets.UTF_8))!=null)
    throw new AssertionError("Malformed fixture route");
  }
  return values;
 }

 private static final class ClosedConnection extends HttpURLConnection {
  private final String route;
  ClosedConnection(URL url) {
   super(url);
   if(!url.getProtocol().equals("https")||!url.getAuthority().equals(CloudDeployment.PRODUCTION_API_HOST)
       ||url.getRef()!=null||url.getUserInfo()!=null)throw new AssertionError("Non-fixture mail authority");
   route=url.getPath().endsWith("/user")?"user":url.getPath().endsWith("/accounts")?"accounts":"history";
   switch(route){
    case "user" -> {if(!url.getFile().equals(MailBackgroundDelivery.USER_ROUTE))throw new AssertionError("Unexpected user route");}
    case "accounts" -> {if(!url.getFile().equals(MailBackgroundDelivery.ACCOUNTS_ROUTE))throw new AssertionError("Unexpected accounts route");}
    default -> {
     if(!url.getFile().startsWith(MailBackgroundDelivery.HISTORY_ROUTE))throw new AssertionError("Non-fixture path");
     Map<String,String> params=parameters(url);
     if(!Set.of("grantId","maxResults","startHistoryId","pageToken").containsAll(params.keySet())
         ||!"50".equals(params.get("maxResults")))throw new AssertionError("Unexpected history query");
     JSONObject durable=new JSONObject(state);
     if(!durable.getJSONObject("binding").getString("grantId").equals(params.get("grantId"))
         ||!Objects.equals(durable.isNull("historyId")?null:durable.getString("historyId"),params.get("startHistoryId"))
         ||!Objects.equals(durable.isNull("pageToken")?null:durable.getString("pageToken"),params.get("pageToken")))
      throw new AssertionError("Worker query does not match exact durable cursor");
    }
   }
  }
  @Override public void connect(){throw new AssertionError("Real transport is disabled");}
  @Override public boolean usingProxy(){return false;}
  @Override public void disconnect(){}
  @Override public int getResponseCode(){
   if(!"GET".equals(getRequestMethod())||getInstanceFollowRedirects()
       ||!("Bearer fixture-token-"+credential).equals(getRequestProperty("Authorization")))
    throw new AssertionError("Unexpected mail request");
   if(!route.equals("history"))return 200;
   historyReads++;
   return switch(script){case "retry" -> 503;case "unsupported" -> 404;case "forbidden" -> 403;default -> 200;};
  }
  @Override public InputStream getInputStream()throws IOException {
   Object body;
   if(route.equals("user"))body=new JSONObject().put("success",true)
     .put("data",new JSONObject().put("id",OWNER[owner]).put("organization_id",ORG));
   else if(route.equals("accounts")) {
    JSONArray accounts=new JSONArray();
    for(int g=1;g<=2;g++)accounts.put(new JSONObject().put("connectionId",grant(g))
      .put("connected",(grants&g)!=0).put("grantedCapabilities",new JSONArray().put("google.gmail.triage")));
    body=accounts;
   } else {
    Map<String,String> query=parameters(url);
    if(!Set.of("baseline","continued","final","notify","reset","malformed").contains(script))
     throw new AssertionError("Unexpected fixture page script "+script);
    body=page(query.get("grantId"),query.get("startHistoryId"),query.get("pageToken"));
   }
   Hold waiting=hold;
   if(waiting!=null&&waiting.route.equals(route))waiting.waitAtPort();
   return new ByteArrayInputStream(body.toString().getBytes(StandardCharsets.UTF_8));
  }
 }

 private static JSONObject observe()throws Exception {
  MailBackgroundDelivery delivery=GmailBackground.get(context);
  JSONObject saved=state==null?null:new JSONObject(state);
  JSONObject binding=saved==null?null:saved.getJSONObject("binding");
  JSONObject notices=saved==null?new JSONObject():saved.getJSONObject("notices");
  if(notices.length()>1)throw new AssertionError("Bounded fixture retained more than one notice");
  JSONObject notice=notices.length()==0?null:notices.getJSONObject(notices.keys().next());
  JSONObject tap=saved==null?null:saved.optJSONObject("tap");
  String page=saved==null||saved.isNull("pageToken")?null:saved.getString("pageToken");
  int boundCredential=0;
  if(binding!=null) {
   for(int value=1;value<=3;value++){
    String raw=new JSONObject().put("credentialId","fixture-credential").put("token","fixture-token-"+value).toString();
    if(MailHistoryReconciliation.hash(raw).equals(binding.getString("credentialDigest")))boundCredential=value;
   }
   if(boundCredential==0||!new JSONArray().put("cloud").put("production").put(binding.getString("userId")).put(ORG).toString()
       .equals(binding.getString("accountRef")))throw new AssertionError("Unexpected durable owner binding");
  }
  return Trace.fields("latestGeneration",generations.size(),"credential",credential,"remoteOwner",owner,"grants",grants,"reset",reset,"allowed",allowed,
   "observable",observable,"locked",primary.activity.keyguard.locked,"phase",saved==null?"disabled":saved.getString("status"),
   "generation",binding==null?0:generations.get(binding.getString("generation")),"grant",binding==null?0:grantClass(binding.getString("grantId")),
   "owner",binding==null?0:ownerClass(binding.getString("userId")),"boundCredential",boundCredential,
   "cursor",cursor(saved,"historyId"),"continuation",page==null?0:Integer.parseInt(page.substring("fixture-page-".length())),
   "incomplete",saved!=null&&saved.getBoolean("incompleteCatchup"),"checked",saved!=null&&saved.getLong("lastSyncAt")>0,
   "notice",notice==null?"none":notice.getString("phase"),"tap",tap==null?"none":tap.optBoolean("question")?"question":"open",
   "visible",!shown.isEmpty(),"posts",posts,"periodic",periodic,"catchup",catchup,"schedules",schedules,"cancels",cancels,
   "attempt",((AtomicLong)Trace.read(delivery,"attempts")).get(),"admitted",Trace.read(delivery,"admittedAttempt"),
   "configuring",configuring,"configOwner",configOwner,"configCredential",configCredential,"configAttempt",configAttempt,
   "configGrantVerified",configGrantVerified,"workGeneration",workGeneration,"workEpoch",workEpoch,"workReply",workReply,
   "bridgeReply",bridgeReply,"historyReads",historyReads,"process",process);
 }

 private static void env(int remoteOwner,int activeGrants,boolean resetPending,boolean notificationAllowed,boolean active,boolean locked)throws Exception {
  owner=remoteOwner;grants=activeGrants;reset=resetPending;allowed=notificationAllowed;observable=active;
  primary.activity.keyguard.locked=locked;
  trace.step("environment",observe(),remoteOwner,activeGrants,resetPending,notificationAllowed,active,locked);
 }

 private static void beginConfigure(int g,int selectedOwner)throws Exception {
  configuring=g;configOwner=selectedOwner;configCredential=credential;
  hold=new Hold("accounts");
  configuringCall=new PluginCall(new JSONObject().put("grantId",grant(g)).put("credentialId","fixture-credential")
    .put("userId",OWNER[selectedOwner]).put("organizationId",ORG));
  primary.configure(configuringCall);
  hold.await();
  configGrantVerified=(grants&g)!=0;
  configAttempt=(int)((AtomicLong)Trace.read(GmailBackground.get(context),"attempts")).get();
  trace.step("beginConfigure",observe(),g,selectedOwner);
 }

 private static void finishConfigure()throws Exception {
  hold.released.countDown();configuringCall.await();
  bridgeReply=configuringCall.rejection==null?"configured":"refused";
  hold=null;configuring=0;configOwner=0;configuringCall=null;
  configCredential=0;configAttempt=0;configGrantVerified=false;
  trace.step("finishConfigure",observe());
 }

 private static void configure(int grant)throws Exception {beginConfigure(grant,owner);finishConfigure();}

 private static void withdraw(int g)throws Exception {
  PluginCall call=new PluginCall(g==0?new JSONObject():new JSONObject().put("grantId",grant(g)));
  secondary.withdraw(call);call.await();
  bridgeReply=call.rejection==null?"withdrawn":"refused";
  trace.step("withdraw",observe(),g);
 }

 private static void replaceCredential(int value,boolean notify)throws Exception {
  synchronized(AlphaLocalAgentPlugin.LIFECYCLE){
   if(notify)AlphaCredentialStore.observer.changed();
   credential=value;
  }
  trace.step("replaceCredential",observe(),value,notify);
 }

 private static String generation(int id) {
  if(id==0)return null;
  return generations.entrySet().stream().filter(row->row.getValue()==id).map(Map.Entry::getKey).findFirst().orElse("fixture-stale");
 }

 private static WorkerParameters input(int id,boolean stopped) {
  Data.Builder data=new Data.Builder();
  if(id!=0)data.putString("generation",generation(id));
  WorkerParameters args=new WorkerParameters(data.build());args.stopped=stopped;return args;
 }

 private static void work(int id,String response,boolean stopped,String writeFault)throws Exception {
  historyReads=0;script=response;fault=writeFault;
  workReply=new GmailDeliveryWorker(context,input(id,stopped)).doWork().status();
  fault="none";
  trace.step("work",observe(),id,response,stopped,writeFault);
 }

 private static void work(int id,String response)throws Exception {work(id,response,false,"none");}

 private static void beginWorker(int id)throws Exception {
  historyReads=0;script="notify";hold=new Hold("history");workGeneration=id;workReply="running";
  parameters=input(id,false);
  worker=new Thread(()->{try{workerOutput=new GmailDeliveryWorker(context,parameters).doWork().status();}catch(Throwable error){workerError=error;}});
  worker.start();hold.await();
  workEpoch=(int)((AtomicLong)Trace.read(GmailBackground.get(context),"attempts")).get();
  trace.step("beginWorker",observe(),id);
 }

 private static void finishWorker(boolean stopped)throws Exception {
  parameters.stopped=stopped;hold.released.countDown();
  worker.join(8000);
  if(worker.isAlive()||workerError!=null)throw new AssertionError("Worker did not settle",workerError);
  hold=null;workGeneration=0;workEpoch=0;workReply=workerOutput;
  trace.step("finishWorker",observe(),stopped);
 }

 private static void status()throws Exception {
  PluginCall call=new PluginCall(new JSONObject());
  primary.status(call);call.await();
  if(call.rejection!=null)bridgeReply="refused";
  else {
   bridgeReply=call.result.getString("status");
   if(!bridgeReply.equals("disabled")) {
    JSONObject row=new JSONObject(state);
    if(call.result.getBoolean("notificationsAllowed")!=allowed
        ||call.result.getBoolean("incompleteCatchup")!=row.getBoolean("incompleteCatchup")
        ||call.result.getLong("lastSyncAt")!=row.getLong("lastSyncAt")
        ||!call.result.getString("grantId").equals(row.getJSONObject("binding").getString("grantId")))
     throw new AssertionError("Status lost its selected durable snapshot");
   }
  }
  trace.step("status",observe());
 }

 private static void resume()throws Exception {
  primary.handleOnResume();
  ((ExecutorService)Trace.read(primary,"io")).submit(()->{}).get(5,TimeUnit.SECONDS);
  trace.step("resume",observe());
 }

 private static void recreate()throws Exception {
  primary.handleOnDestroy();secondary.handleOnDestroy();
  for(String field:new String[]{"delivery","poster"}) {
   var saved=GmailBackground.class.getDeclaredField(field);saved.setAccessible(true);saved.set(null,null);
  }
  primary=new AlphaGmailPlugin();secondary=new AlphaGmailPlugin();process++;
  trace.step("recreate",observe());
 }

 private static void capture(boolean question)throws Exception {
  JSONObject notices=new JSONObject(state).getJSONObject("notices");
  String key=notices.length()==0?"a".repeat(64):notices.keys().next();
  GmailBackground.get(context).capture(key,question);
  trace.step("capture",observe(),question);
 }

 private static void tap(String method,boolean exact)throws Exception {
  JSONObject saved=state==null?null:new JSONObject(state);
  JSONObject captured=saved==null?null:saved.optJSONObject("tap");
  String token=exact&&captured!=null?captured.getString("token"):"fixture-wrong-token";
  PluginCall call=new PluginCall(new JSONObject().put("token",token));
  switch(method){case "pending" -> primary.pending(call);case "consume" -> primary.consume(call);
   case "release" -> primary.releaseQuestion(call);default -> throw new AssertionError(method);}
  call.await();
  bridgeReply=call.rejection!=null?"refused":method.equals("pending")?
   call.result.has("token")?"pending":"empty":"settled";
  if(bridgeReply.equals("pending")) {
   JSONObject bound=saved.getJSONObject("binding");
   if(!token.equals(call.result.getString("token"))||!bound.getString("generation").equals(call.result.getString("generation"))
       ||!bound.getString("userId").equals(call.result.getString("userId"))||!bound.getString("grantId").equals(call.result.getString("grantId"))
       ||!"fixture-mail".equals(call.result.getString("messageId"))||!"fixture-thread".equals(call.result.getString("threadId"))
       ||call.result.has("body")||call.result.has("subject"))throw new AssertionError("Wrong opaque tap readback");
  }
  trace.step("tapCall",observe(),method,exact);
 }

 public static void main(String[] args)throws Exception {
  URL.setURLStreamHandlerFactory(protocol->new URLStreamHandler(){
   @Override protected URLConnection openConnection(URL url){return new ClosedConnection(url);}
  });
  trace=new Trace(args[0],observe());
  try {
   switch(args[0]){
    case "continuation" -> {status();configure(1);work(1,"baseline");work(1,"continued");status();recreate();resume();
     configure(1);work(1,"final");status();}
    case "retry" -> {configure(1);work(0,"none");work(4,"none");work(1,"none",true,"none");
     work(1,"retry");status();work(1,"unsupported");status();work(1,"forbidden");status();
     work(1,"baseline");work(1,"malformed");status();}
    case "storage" -> {configure(1);work(1,"baseline",false,"before");status();
     work(1,"baseline",false,"after");status();work(1,"final");status();}
    case "resume-stale" -> {configure(1);work(1,"baseline");replaceCredential(2,false);
     work(1,"none");status();resume();status();}
    case "rotation" -> {configure(1);work(1,"baseline");beginWorker(1);replaceCredential(2,true);
     finishWorker(false);configure(2);work(1,"none");status();}
    case "stopped" -> {configure(1);work(1,"baseline");beginWorker(1);finishWorker(true);status();}
    case "reset" -> {configure(1);work(1,"baseline");work(1,"reset");status();beginWorker(1);
     env(1,3,true,true,true,false);finishWorker(false);resume();status();}
    case "withdraw-during-configure" -> {configure(1);work(1,"baseline");beginConfigure(2,1);withdraw(2);
     finishConfigure();status();withdraw(1);status();withdraw(2);status();}
    case "withdraw-current" -> {configure(1);beginConfigure(2,1);withdraw(1);finishConfigure();status();}
    case "old-owner" -> {configure(1);work(1,"baseline");env(2,3,false,true,true,false);
     work(1,"none");status();configure(2);status();}
    case "remote-revoked-consume","remote-revoked-release" -> {
     configure(1);work(1,"baseline");work(1,"notify");capture(args[0].endsWith("release"));
     tap("pending",true);env(1,2,false,true,true,false);tap("pending",true);
     tap(args[0].endsWith("release")?"release":"consume",true);tap("pending",true);
    }
    case "uncertain" -> {configure(1);work(1,"baseline");env(1,3,false,true,false,false);work(1,"notify");
     status();recreate();resume();work(1,"final");status();capture(true);tap("pending",true);
     capture(false);tap("pending",true);tap("consume",false);tap("consume",true);}
    case "denied" -> {configure(1);work(1,"baseline");env(1,3,false,false,true,false);work(1,"notify");
     status();env(1,3,false,true,true,false);work(1,"final");status();}
    default -> throw new AssertionError(args[0]);
   }
   System.out.println(trace.value);
  } finally {
   if(hold!=null)hold.released.countDown();
   primary.handleOnDestroy();secondary.handleOnDestroy();
  }
 }
}
