package ai.elizaresearch.alphaphone;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;
import com.getcapacitor.PluginCall;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Locale;

/** Controlled platform ports. Actual shared notification classes own all admission and ledger rules. */
final class WorkflowPorts {
 interface Work {void run()throws Exception;}
 interface Write {void write(String slot,String raw)throws Exception;}
 static final ArrayDeque<Runnable> worker=new ArrayDeque<>();
 static Context context;
 static boolean visible;
 static Work foregroundHook;
 static Write write;
 static HashMap<String,String> bytes;
 static void requireForeground()throws Exception{
  if(foregroundHook!=null)foregroundHook.run();
  if(!visible)throw new SecurityException("Synthetic foreground unavailable");
 }
}
final class AlphaCredentialStore {
 AlphaCredentialStore(Context context){}
 String readCredentialSlot(String key){return WorkflowPorts.bytes.get(key);}
 void writeCredentialSlot(String key,String value)throws Exception{WorkflowPorts.write.write(key,value);}
}
final class R {static final class drawable {static final int notification_icon=1;}}

public final class WorkflowNoticeTraces {
 static final String ID="reviewed-step";
 static final String ORIGIN="https://fixture.invalid";
 static final String SCOPE="c".repeat(64);
 static final String TITLE="Synthetic workflow notice";
 static final String BODY="Synthetic reviewed body";
 static String binding(int binding){return (binding==1?"a":"b").repeat(64);}
 static int bindingClass(String binding){if(binding(1).equals(binding))return 1;if(binding(2).equals(binding))return 2;throw new AssertionError("Unbound receipt");}
 static String title(int content){return content==2?"Changed synthetic title":TITLE;}
 static String body(int content){return content==3?"Changed synthetic body":BODY;}
 static int suffix(String value){return Integer.parseInt(value.substring(value.lastIndexOf('-')+1));}
 static JSONObject owner(int id){return new JSONObject().put("origin",ORIGIN).put("ownerId","owner-"+id).put("agentId","agent-"+id);}
 static JSONObject route(int id,int run){return owner(id).put("scope",SCOPE).put("workflowId","workflow-1").put("runId","run-"+run).put("versionId","version-1");}
 static String hash(int content)throws Exception{
  var raw=new JSONArray().put(title(content)).put(body(content)).toString();
  byte[] bytes=MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
  var result=new StringBuilder();for(byte b:bytes)result.append(String.format(Locale.ROOT,"%02x",b&255));return result.toString();
 }
 static void check(boolean ok,String detail){if(!ok)throw new AssertionError(detail);}
 static JSONObject row(String slot){
  String bytes=WorkflowPorts.bytes.get(slot);
  return bytes==null?null:new JSONObject(bytes).optJSONObject(ID);
 }

 static final class Fixture {
  AlphaNotificationsPlugin bridge;
  final NotificationManager manager;
  final Trace trace;
  String token,kind="none",phase="idle",terminal="none";
  int callOwner,callBinding,callRun,content,generation=1;
  PluginCall request;
  boolean hadReceipt;
  String routeFault="ok",claimFault="ok",finishFault="ok",retainFault="ok",postMode="visible";
  WorkflowPorts.Work afterRoute,afterClaim;
  final HashMap<String,Integer> hashes=new HashMap<>();

  Fixture(String name)throws Exception{
   WorkflowPorts.context=new Context();WorkflowPorts.bytes=new HashMap<>();WorkflowPorts.visible=true;
   WorkflowPorts.worker.clear();WorkflowPorts.foregroundHook=null;WorkflowPorts.write=WorkflowPorts.bytes::put;
   manager=WorkflowPorts.context.getSystemService(NotificationManager.class);
   for(int i=1;i<=3;i++)hashes.put(hash(i),i);
   bridge=new AlphaNotificationsPlugin();
   trace=new Trace(name,state());
  }
  private JSONObject routeState(){
   JSONObject row=row(WorkflowNoticeTaps.SLOT);
   if(row==null)return new JSONObject().put("owner",0).put("binding",0).put("runId",0).put("token",0);
   String stored=row.getString("token");
   if(token==null)token=stored;
   check(stored.equals(token)&&stored.matches("[a-f0-9-]{36}"),"exact retained route token");
   JSONObject route=row.getJSONObject("route");
   check(owner(suffix(route.getString("ownerId"))).getString("agentId").equals(route.getString("agentId")),"route owner tuple");
   return new JSONObject().put("owner",suffix(route.getString("ownerId"))).put("binding",bindingClass(row.getString("binding")))
    .put("runId",suffix(route.getString("runId"))).put("token",1);
  }
  private JSONObject receiptState(){
   JSONObject row=row(WorkflowNoticeDelivery.SLOT);
   if(row==null)return new JSONObject().put("binding",0).put("content",0).put("status","absent");
   Integer contentClass=hashes.get(row.getString("digest"));
   check(contentClass!=null&&row.length()==3,"durable receipt has exact digest without content");
   return new JSONObject().put("binding",bindingClass(row.getString("binding"))).put("content",contentClass).put("status",row.getString("status"));
  }
  private int currentOwner(){
   String raw=WorkflowPorts.bytes.get(WorkflowNoticeTaps.OWNER_SLOT);
   if(raw==null)return -1;
   JSONObject current=new JSONObject(raw).optJSONObject("owner");
   return current==null?0:suffix(current.getString("ownerId"));
  }
  private String managerState(){
   if(manager.active==null)return manager.delayed==null?"none":"hidden";
   var notice=manager.active.getNotification();
   var receipt=receiptState();
   int bound=receipt.getInt("content");
   if(bound==0)return "different";
   return manager.active.getId()==0&&manager.active.getTag().equals("alpha-workflow-"+ID)
    &&notice.getChannelId().equals(WorkflowNoticePoster.CHANNEL)
    &&notice.extras.getCharSequence(Notification.EXTRA_TITLE,"").toString().equals(title(bound))
    &&notice.extras.getCharSequence(Notification.EXTRA_BIG_TEXT,"").toString().equals(body(bound))?"exact":"different";
  }
  private JSONObject state(){
   String status=request==null||request.result==null?"none":request.result.optString("status");
   if(request!=null&&request.rejected)status="rejected";
   String currentPhase="none".equals(status)?phase:"done";
   var call=new JSONObject().put("kind",kind).put("phase",currentPhase).put("owner",callOwner)
    .put("binding",callBinding).put("runId",callRun).put("content",content).put("reply",status).put("terminal",terminal);
   return Trace.fields("owner",currentOwner(),"route",routeState(),"receipt",receiptState(),"call",call,
    "visible",WorkflowPorts.visible,"bridge",!bridge.noticeGate.destroyed(),"allowed",manager.enabled,"generation",generation,
    "manager",managerState(),"posts",manager.posts,"cancels",manager.cancels)
    .put("ReplyAcknowledged","succeeded".equals(status));
  }
  void record(String action,Object... args){trace.step(action,state(),args);}
  void current(int id)throws Exception{bridge.routes().owner(id==0?null:owner(id));record("owner",id);}
  void visible(boolean visible){WorkflowPorts.visible=visible;record("foreground",visible);}
  void allowed(boolean enabled){manager.enabled=enabled;record("permission",enabled);}
  void destroy(){bridge.destroy();record("destroy");}
  void reopen(){
   bridge.destroy();bridge=new AlphaNotificationsPlugin();generation++;WorkflowPorts.visible=true;
   kind="none";phase="idle";terminal="none";request=null;callOwner=callBinding=callRun=content=0;
   record("reopen");
  }
  void expose(){check(manager.active==null&&manager.delayed!=null,"one delayed synthetic notice");manager.active=manager.delayed;manager.delayed=null;record("reveal");}
  void different(){check(manager.active!=null,"replace visible synthetic content");manager.active.getNotification().extras.put(Notification.EXTRA_BIG_TEXT,"Different active body");record("replaceVisible");}
  void dismiss(){manager.active=null;manager.delayed=null;record("dismiss");}
  void withdraw(int owner,String mode)throws Exception{
   boolean failed=false;
   WorkflowPorts.write=(slot,value)->{
    boolean receipt=WorkflowNoticeDelivery.SLOT.equals(slot);
    if(receipt&&"before".equals(mode))throw new IOException("Synthetic withdrawal write refusal");
    WorkflowPorts.bytes.put(slot,value);
    if(receipt&&"after".equals(mode))throw new IOException("Synthetic withdrawal write committed before lost reply");
   };
   try{WorkflowNoticeTapsFactory.delivery(WorkflowPorts.context).withdrawOtherOwners(WorkflowNoticeTapsFactory.create(WorkflowPorts.context),owner==0?null:owner(owner),0);}
   catch(IOException refused){failed=true;}
   finally{WorkflowPorts.write=WorkflowPorts.bytes::put;}
   check(failed==!"ok".equals(mode),"withdrawal only returns after the configured successful write");
   record("withdrawTo",owner,mode);
  }

  void queuePublish(int owner,int binding,int run,int content){
   queue("publish",owner,binding,run,content);
   bridge.postWorkflow(request);
   record("queuePublish",owner,binding,run,content);
  }
  void queueReceipt(int binding,int content){
   queue("receipt",0,binding,0,content);
   bridge.workflowReceipt(request);
   record("queueReceipt",binding,content);
  }
  private void queue(String type,int owner,int binding,int run,int content){
   this.kind=type;this.phase="queued";this.terminal="none";this.callOwner=owner;this.callBinding=binding;this.callRun=run;this.content=content;
   var input=new JSONObject().put("operationId",ID).put("bindingHash",binding(binding)).put("title",title(content)).put("body",body(content));
   if("publish".equals(type))input.put("route",route(owner,run));
   request=new PluginCall(input);
  }
  private void write(String slot,String value)throws Exception{
   String mode;
   if(slot.equals(WorkflowNoticeTaps.SLOT))mode=routeFault;
   else{
    check(slot.equals(WorkflowNoticeDelivery.SLOT),"only reviewed workflow slots can be written");
    String status=new JSONObject(value).getJSONObject(ID).getString("status");
    if("claimed".equals(phase)){
     terminal=status;phase="posted";
     record("notify",postMode);
     mode=finishFault;
    }else if("routed".equals(phase)&&!hadReceipt)mode=claimFault;
    else mode=retainFault;
    if("before".equals(mode))throw new IOException("Synthetic failure before write");
    WorkflowPorts.bytes.put(slot,value);
    if("after".equals(mode))throw new IOException("Synthetic lost write reply");
    if("routed".equals(phase)&&!hadReceipt&&"applying".equals(status)){
     phase="claimed";record("claimDelivery",claimFault);
     if(afterClaim!=null)afterClaim.run();
    }
    return;
   }
   if("before".equals(mode))throw new IOException("Synthetic route write refusal");
   WorkflowPorts.bytes.put(slot,value);
   if("after".equals(mode))throw new IOException("Synthetic route write committed before lost reply");
  }
  void run()throws Exception{
   check(WorkflowPorts.worker.size()==1,"one synthetic queued bridge job");
   hadReceipt=row(WorkflowNoticeDelivery.SLOT)!=null;
   int[] foregroundChecks={0};
   manager.mode=postMode;
   manager.onNotify=()->{
    check("claimed".equals(phase)&&"applying".equals(row(WorkflowNoticeDelivery.SLOT).getString("status")),"durable claim before Android notification port");
    var active=manager.active==null?manager.delayed:manager.active;
    var notice=active.getNotification();
    check(notice.visibility==Notification.VISIBILITY_PRIVATE&&notice.timeout==WorkflowNoticeDelivery.STEP_NOTICE_TIMEOUT_MS,"installed step notification settings");
    check(notice.tap.intent.action.equals(WorkflowNoticeTaps.ACTION)&&notice.tap.intent.data.toString().equals(WorkflowNoticeTaps.PREFIX+token),"tap uses the exact prepared route token");
   };
   WorkflowPorts.foregroundHook=()->{
    if(++foregroundChecks[0]==2){
     phase="routed";record("claimRoute",routeFault);
     if(afterRoute!=null)afterRoute.run();
    }
   };
   WorkflowPorts.write=this::write;
   try{WorkflowPorts.worker.remove().run();}
   finally{WorkflowPorts.write=WorkflowPorts.bytes::put;WorkflowPorts.foregroundHook=null;}
   check(request.result!=null||request.rejected,"bridge call settles exactly once");
   if("receipt".equals(kind))record("retained",retainFault);
   else if("queued".equals(phase))record("claimRoute",routeFault);
   else if(!WorkflowPorts.visible)record("refuseRouted");
   else if(hadReceipt)record("retained",retainFault);
   else if("posted".equals(phase))record("finish",finishFault);
   else record("claimDelivery",claimFault);
   routeFault=claimFault=finishFault=retainFault="ok";postMode="visible";afterRoute=afterClaim=null;
  }
  void post()throws Exception{queuePublish(1,1,1,1);run();}
  void receipt()throws Exception{queueReceipt(1,1);run();}
 }

 public static void main(String[] args)throws Exception{
  JSONArray result=new JSONArray();
  {
   Fixture f=new Fixture("route-claim-and-confirmed-notify");f.current(1);f.receipt();f.post();
   f.dismiss();f.reopen();f.post();f.receipt();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("route-claim-foreground-and-owner-fences");f.current(1);f.queuePublish(1,1,1,1);
   f.visible(false);f.run();f.visible(true);f.queuePublish(1,1,1,1);f.current(2);f.run();
   f.current(1);f.queuePublish(1,1,1,1);f.afterRoute=()->f.visible(false);f.run();f.visible(true);
   f.queuePublish(1,2,1,1);f.run();f.queuePublish(1,1,2,1);f.run();
   f.post();f.queueReceipt(1,2);f.run();f.queueReceipt(2,1);f.run();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("route-persistence-before-and-after-lost-reply");f.routeFault="before";f.post();
   f.routeFault="after";f.post();f.reopen();f.post();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("claim-refusal-before-commit-can-be-retried");f.claimFault="before";f.post();
   f.reopen();f.post();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("claim-committed-with-lost-reply-never-notifies");f.claimFault="after";f.post();
   f.reopen();f.receipt();f.post();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("terminal-write-faults-separate-notify-and-confirmed-reply");f.finishFault="before";f.post();
   f.reopen();f.retainFault="before";f.receipt();f.retainFault="after";f.receipt();f.receipt();f.post();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("lost-terminal-reply-keeps-succeeded-receipt");f.finishFault="after";f.post();
   f.reopen();f.receipt();f.dismiss();f.post();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("late-and-mismatched-active-notices");f.postMode="late";f.post();f.receipt();f.expose();f.receipt();
   f.different();f.receipt();f.withdraw(2,"ok");f.receipt();f.queuePublish(1,1,1,1);f.run();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("lost-manager-reply-and-exact-match");f.postMode="lost";f.post();
   f.different();f.receipt();f.dismiss();f.post();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("permission-denial-is-retained");f.allowed(false);f.post();f.allowed(true);f.post();f.receipt();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("permission-rechecked-after-durable-claim");f.postMode="blocked";f.afterClaim=()->f.allowed(false);
   f.post();f.allowed(true);f.post();f.queueReceipt(1,1);f.destroy();f.run();f.reopen();f.receipt();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("manager-refusal-before-post-never-retries-effect");f.postMode="refused";f.post();
   f.reopen();f.post();f.receipt();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("owner-fence-survives-interrupted-withdrawal");f.current(1);f.post();
   f.withdraw(2,"before");f.post();f.withdraw(2,"after");f.receipt();f.withdraw(2,"ok");f.receipt();result.put(f.trace.value);
  }
  {
   Fixture f=new Fixture("route-only-withdrawal-does-not-create-receipt");f.routeFault="after";f.post();
   f.withdraw(0,"ok");f.receipt();f.post();f.current(1);f.post();result.put(f.trace.value);
  }
  java.lang.System.out.println(result);
 }
}
