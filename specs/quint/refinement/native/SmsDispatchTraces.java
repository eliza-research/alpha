package ai.eliza.plugins.messages;

import ai.alphacompute.alphaphone.AlphaSmsSendReceiver;
import ai.alphacompute.alphaphone.AlphaTelephonyPlugin;
import ai.alphacompute.alphaphone.Trace;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.os.Looper;
import android.provider.Telephony.Sms;
import android.telephony.SmsManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.IOException;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

public final class SmsDispatchTraces {
 static final String OP="synthetic-send", OTHER="another-send", SLOT="sms-send-ledger:v1:device";
 static final int SUB=7;
 static final String[] TO={"+15555550100","+15555550101"};
 static final String[] BODY={"","Synthetic reviewed body A","Synthetic reviewed body B"};
 public static long now=1_760_000_000_000L;
 static final ArrayDeque<String> faults=new ArrayDeque<>();

 public static void write(Context context,String slot,String value)throws Exception{
  if(!slot.equals(SLOT))throw new AssertionError("Exact Alpha installed journal slot");
  String failure=faults.poll();
  if(failure==null||failure.equals("pass")||failure.equals("after"))context.slots.put(slot,value);
  if(failure!=null&&!failure.equals("pass"))throw new IOException("Synthetic durable "+failure+" refusal");
 }

 static void check(boolean condition,String reason){if(!condition)throw new AssertionError(reason);}
 static String wire(SmsSendJournal.Record record){return record==null?"none":record.status();}
 static void drain()throws Exception{SmsTelephony.WORK.submit(()->{}).get(5,TimeUnit.SECONDS);}

 static final class Fixture {
  final Context context=new Context();
  final TelephonyPlugin[] plugins=new TelephonyPlugin[3];
  final PluginCall[] reviewCalls=new PluginCall[3];
  final int[] reviewedBinding=new int[3], reviewedSim=new int[3];
  final AlphaSmsSendReceiver receiver=new AlphaSmsSendReceiver();
  final SmsTelephonyConfiguration config;
  final Trace trace;
  final int recipients, parts;
  final Map<String,Integer> bindings=new HashMap<>();
  int process=1,replyBinding;
  String reply="none",candidate="none",providerStatus="none";
  boolean old;

  Fixture(String name,int recipients,int parts,boolean role)throws Exception{
   this.recipients=recipients;this.parts=parts;
   context.role=role;context.radio.parts=parts;
   for(int id=1;id<=2;id++){
    bindings.put(SmsSendJournal.sha256(SmsSendJournal.bindingText(numbers(),BODY[id],SUB)),id);
    plugins[id]=new AlphaTelephonyPlugin();plugins[id].attach(context);plugins[id].load();drain();
   }
   config=plugins[1].telephonyConfiguration();
   context.radio.before=this::beforeSend;
   trace=new Trace(name,observe());trace.value.put("init",Trace.action("initWith",recipients,parts,role));
  }

  String[] numbers(){return Arrays.copyOf(TO,recipients);}

  String durableLedger(){
   String encrypted=context.slots.get(SLOT);
   return encrypted==null?"":new JSONObject(encrypted).getString("journal");
  }

  int tombstoneBinding(){
   String prefix="t1|"+OP+"|";
   return durableLedger().lines().filter(line->line.startsWith(prefix)).findFirst()
    .map(line->Objects.requireNonNull(bindings.get(line.substring(prefix.length())))).orElse(0);
  }

  SmsSendJournal.Record readDisk()throws Exception{
   String ledger=durableLedger();
   if(ledger.isEmpty())return null;
   check(!ledger.contains(BODY[1])&&!ledger.contains(BODY[2]),"Durable SMS journal contains only body hashes");
   SmsSendJournal fresh=new SmsSendJournal(new SmsSendJournal.Storage(){
    public String read(){return ledger;}
    public void write(String value){throw new AssertionError("Read-only disk observation");}
   },config.retiredNamespace);
   return fresh.get(OP);
  }

  SmsSendJournal.Record readMemory()throws Exception{
   var caches=(Map<?,?>)staticField("JOURNALS").get(null);
   SmsSendJournal journal=(SmsSendJournal)caches.get(config.journalKey());
   return journal==null?null:journal.get(OP);
  }

  static java.lang.reflect.Field staticField(String name)throws Exception{
   var field=SmsTelephony.class.getDeclaredField(name);field.setAccessible(true);return field;
  }

  int binding(SmsSendJournal.Record record){
   if(record==null)return 0;
   Integer id=bindings.get(record.bindingHash);
   check(id!=null&&record.subscriptionId==SUB&&Arrays.equals(record.recipients,numbers()),"Exact journal binding and subscription");
   return id;
  }

  void beforeSend(SmsManager.Call call){
   try{
    var disk=readDisk();
    check(disk!=null&&disk.dispatching&&disk.bindingHash.equals(SmsSendJournal.sha256(
     SmsSendJournal.bindingText(numbers(),String.join("",call.parts()),SUB))),"Exact durable dispatch precedes radio");
    int index=context.radio.attempts;
    check(call.sim()==SUB&&call.address().equals(TO[index])&&call.parts().size()==parts,"Separate exact recipient and part count");
    for(int p=0;p<parts;p++){
     callbackShape(call.sent().get(p),config.sentAction,index*parts+p);
     callbackShape(call.delivery().get(p),config.deliveredAction,index*parts+p);
    }
    if(context.role&&!context.provider.refuseInsert)
     check(disk.providerRow[index]>0&&context.provider.rows.get(disk.providerRow[index]).get(Sms.TYPE).equals(4),
      "Default app's exact outbox row precedes radio");
   }catch(Exception failure){throw new AssertionError(failure);}
  }

  void callbackShape(PendingIntent pending,String action,int index){
   Intent intent=pending.intent;
   check((pending.flags&(PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_ONE_SHOT))==
     (PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_ONE_SHOT)&&intent.component==AlphaSmsSendReceiver.class&&
     context.getPackageName().equals(intent.pkg)&&action.equals(intent.getAction())&&OP.equals(intent.getStringExtra(config.operationExtra))&&
     intent.getIntExtra(config.indexExtra,-1)==index&&intent.getData().toString().equals(config.callbackScheme+":"+OP+"/"+index),
    "Exact immutable one-shot package/component/action/operation/part callback");
  }

  void classify(PluginCall call){
   replyBinding=0;
   if(call==null||!call.answered){reply="pending";return;}
   if(call.rejection!=null){reply=call.rejection;return;}
   if(!call.result.has("status")){reply="ok";return;}
   check(call.result.keySet().equals(Set.of("kind","operationId","subscriptionId","bindingHash","status","parts","createdAt"))&&
    call.result.getString("kind").equals("sms-send")&&call.result.getString("operationId").equals(OP)&&call.result.getInt("subscriptionId")==SUB,
    "Result is the redacted exact wire receipt");
   reply=call.result.getString("status");replyBinding=bindings.get(call.result.getString("bindingHash"));
  }

  JSONObject input(String id,int binding){
   JSArray to=new JSArray();for(String number:numbers())to.put(number);
   return new JSObject().put("operationId",id).put("subscriptionId",SUB).put("recipients",to).put("body",BODY[binding]);
  }

  PluginCall message(int binding){
   JSObject data=new JSObject();JSONObject input=input(OP,binding);input.keys().forEachRemaining(key->data.put(key,input.get(key)));
   return new PluginCall(data);
  }

  AlertDialog dialog(int bridge){return plugins[bridge].activity.dialogs.getLast();}

  void request(int bridge,int binding,String mode)throws Exception{
   PluginCall call=message(binding);
   int before=plugins[bridge].activity.dialogs.size();
   if(mode.equals("long-number"))call.getData().put("subscriptionId",7L);
   if(mode.equals("divide-refused"))context.radio.parts=-1;
   if(mode.equals("empty-parts"))context.radio.parts=0;
   plugins[bridge].sendSms(call);drain();
   context.radio.parts=parts;
   if(plugins[bridge].activity.dialogs.size()>before){
    reviewCalls[bridge]=call;reviewedBinding[bridge]=binding;reviewedSim[bridge]=context.subscriptions.revision;
    check(dialog(bridge).message.contains(BODY[binding])&&dialog(bridge).message.contains(TO[0])&&
     dialog(bridge).message.contains("Synthetic SIM")&&dialog(bridge).getButton(-1).filtered&&
     (dialog(bridge).getWindow().flags&android.view.WindowManager.LayoutParams.FLAG_SECURE)!=0,"Exact private review and obscured-tap filter");
   }
   classify(call);point("request",bridge,binding,mode);
  }

  void approve(int bridge,String mode)throws Exception{
   context.radio.mode=mode;
   if(mode.equals("begin-before"))faults.add("before");
   if(mode.equals("begin-after-and-deny-before")){faults.add("after");faults.add("before");}
   if(mode.equals("end-before")){faults.add("pass");faults.add("before");}
   if(mode.equals("end-after")){faults.add("pass");faults.add("after");}
   Looper.runMain(()->dialog(bridge).clickSend());
   drain();context.radio.mode="complete";
   check(faults.isEmpty(),"Every injected write refusal reached its expected boundary");
   classify(reviewCalls[bridge]);point("approve",bridge,mode);
  }

  JSONObject record(SmsSendJournal.Record value){
   JSONArray sent=new JSONArray(),failed=new JSONArray(),reported=new JSONArray(),delivered=new JSONArray(),deliveryFailed=new JSONArray(),rows=new JSONArray();
   if(value!=null){
    for(int i=0;i<value.parts();i++){
     if(value.sent[i]==SmsSendJournal.SUCCESS)sent.put(i+1);
     if(value.sent[i]==SmsSendJournal.FAILED)failed.put(i+1);
     if(value.reported[i])reported.put(i+1);
     if(value.delivery[i]==SmsSendJournal.SUCCESS)delivered.put(i+1);
     if(value.delivery[i]==SmsSendJournal.FAILED)deliveryFailed.put(i+1);
    }
    for(int i=0;i<value.providerRow.length;i++)if(value.providerRow[i]>0)rows.put(i+1);
   }
   return new JSONObject().put("binding",binding(value)).put("status",wire(value))
    .put("decision",value==null||value.decision==null?"none":value.decision)
    .put("dispatching",value!=null&&value.dispatching).put("submitted",value!=null&&value.submitted)
    .put("unknown",value!=null&&value.unknown).put("boot",value==null?0:value.boot)
    .put("sent",sent).put("failed",failed).put("reported",reported).put("delivered",delivered)
    .put("deliveryFailed",deliveryFailed).put("rows",rows);
  }

  JSONObject observe()throws Exception{
   JSONArray reviews=new JSONArray(),foreground=new JSONArray(),closed=new JSONArray(),outbox=new JSONArray(),
    sentRows=new JSONArray(),failedRows=new JSONArray();
   int listener=0,events=0;
   for(int bridge=1;bridge<=2;bridge++){
    var plugin=plugins[bridge];boolean held=Trace.read(plugin,"reviewCall")!=null;
    reviews.put(new JSONArray().put(bridge).put(new JSONObject()
     .put("binding",held?reviewedBinding[bridge]:0).put("sim",held?reviewedSim[bridge]:0)));
    if((boolean)Trace.read(plugin,"foreground"))foreground.put(bridge);
    if((boolean)Trace.read(plugin,"closed"))closed.put(bridge);
    if(Trace.read(plugin,"sendListener")==staticField("listener").get(null))listener=bridge;
    events+=plugin.notices.size();
   }
   for(var entry:context.provider.rows.entrySet()){
    if(entry.getKey()>=900)continue;
    var row=entry.getValue();
    int recipient=row.get(Sms.ADDRESS).equals(TO[0])?1:2;
    switch((int)row.get(Sms.TYPE)){case 4 -> outbox.put(recipient);case 2 -> sentRows.put(recipient);case 5 -> failedRows.put(recipient);default -> throw new AssertionError();}
   }
   return Trace.fields("recipients",recipients,"parts",parts,"reply",reply,"replyBinding",replyBinding,
    "memory",record(readMemory()),"disk",record(readDisk()),"tombstoneBinding",tombstoneBinding(),
    "attempts",context.radio.attempts,"accepted",context.radio.accepted.size(),
    "reviews",reviews,"foreground",foreground,"closed",closed,"listener",listener,"events",events,
    "image",context.admitted,"send",context.send,"phone",context.phone,"read",context.read,"locked",context.lock.locked,
    "role",context.role,"sim",context.subscriptions.revision,"process",process,"boot",context.boot,"old",old,
    "candidate",candidate,"providerStatus",providerStatus,"refuseOutbox",context.provider.refuseInsert,"outbox",outbox,"sentRows",sentRows,"failedRows",failedRows);
  }

  void access(String kind,boolean enabled)throws Exception{
   switch(kind){
    case "image" -> context.admitted=enabled;
    case "send" -> context.send=enabled;
    case "phone" -> context.phone=enabled;
    case "read" -> context.read=enabled;
    case "locked" -> context.lock.locked=enabled;
    case "role" -> context.role=enabled;
    default -> throw new AssertionError("Unknown access port");
   }
   point("access",kind,enabled);
  }

  void sim(int value)throws Exception{context.subscriptions.revision=value;point("simAt",value);}

  void lifecycle(int bridge,String mode)throws Exception{
   var plugin=plugins[bridge];
   PluginCall pending=(PluginCall)Trace.read(plugin,"reviewCall");
   var off=(android.content.BroadcastReceiver)Trace.read(plugin,"screenOff");
   Looper.runMain(()->{
    switch(mode){
     case "pause" -> plugin.handleOnPause();
     case "resume" -> plugin.handleOnResume();
     case "destroy" -> plugin.handleOnDestroy();
     case "screen" -> off.onReceive(context,new Intent(Intent.ACTION_SCREEN_OFF));
     default -> throw new AssertionError();
    }
   });
   drain();if(pending!=null)classify(pending);
   point("lifecycle",bridge,mode);
  }

  void cancel(int bridge,boolean exact)throws Exception{
   var call=new PluginCall((JSObject)new JSObject().put("operationId",exact?OP:OTHER));
   plugins[bridge].cancelSmsReview(call);drain();classify(call);
   point("cancel",bridge,exact);
  }

  void readback(int bridge)throws Exception{
   var call=new PluginCall((JSObject)new JSObject().put("operationId",OP));
   plugins[bridge].smsSendResult(call);drain();classify(call);
   point("readback",bridge);
  }

  void history(int bridge)throws Exception{
   var call=new PluginCall(new JSObject());plugins[bridge].smsSendHistory(call);drain();
   check(call.answered&&call.rejection==null&&call.result.keySet().equals(Set.of("receipts")),"Exact bounded history");
   String raw=call.result.toString();
   check(!raw.contains(BODY[1])&&!raw.contains(BODY[2])&&!raw.contains(TO[0]),"History has no plaintext content or recipients");
   trace.stutter("native history exposes only redacted receipts",observe());
  }

  void restart(boolean reboot)throws Exception{
   // A process kill does not execute the plugin's graceful review cancellation.
   for(int bridge=1;bridge<=2;bridge++){
    var executor=(java.util.concurrent.ExecutorService)Trace.read(plugins[bridge],"reader");
    executor.shutdownNow();reviewCalls[bridge]=null;reviewedBinding[bridge]=0;reviewedSim[bridge]=0;
   }
   context.dynamicReceivers.clear();
   ((Map<?,?>)staticField("JOURNALS").get(null)).clear();staticField("listener").set(null,null);
   if(reboot)context.boot++;
   for(int bridge=1;bridge<=2;bridge++){plugins[bridge]=new AlphaTelephonyPlugin();plugins[bridge].attach(context);plugins[bridge].load();drain();}
   process++;reply="none";replyBinding=0;
   point("restart",reboot);
  }

  void callback(int index,String kind,boolean ok,String mode)throws Exception{
   int recipient=(index-1)/parts, part=(index-1)%parts;
   SmsManager.Call send=context.radio.accepted.get(recipient);
   PendingIntent pending=(kind.equals("sent")?send.sent():send.delivery()).get(part);
   if(mode.equals("before")||mode.equals("after"))faults.add(mode);
   Intent intent=new Intent(pending.intent);
   if(mode.equals("wrong-action"))intent=new Intent("foreign-action").putExtra(config.operationExtra,OP).putExtra(config.indexExtra,index-1);
   receiver.code=ok?Activity.RESULT_OK:0;
   receiver.onReceive(context,intent);drain();
   check(faults.isEmpty()&&receiver.accepted==receiver.finished,"Receiver retires its async result after the exact worker");
   point("callback",index,kind,ok,mode);
  }

  void provider(String kind,String status)throws Exception{
   candidate=kind;providerStatus=status;
   context.provider.rows.keySet().removeIf(id->id>=900);
   if(!kind.equals("none")){
    var record=readMemory();
    for(int i=0;i<(kind.equals("ambiguous")?2:1);i++){
     long id=900+i;
     ContentValues row=new ContentValues();
     row.put(Sms._ID,id);row.put(Sms.CREATOR,context.getPackageName());row.put(Sms.ADDRESS,TO[0]);row.put(Sms.TYPE,2);
     row.put(Sms.BODY,kind.equals("wrong")?"Other synthetic body":BODY[binding(record)]);
     row.put(Sms.DATE,record.createdAt+1000);row.put(Sms.SUBSCRIPTION_ID,SUB);
     row.put(Sms.STATUS,switch(status){case "complete"->0;case "pending"->32;case "failed"->64;default->-1;});
     context.provider.rows.put(id,row);
    }
   }
   point("provider",kind,status);
  }

  void reconcile()throws Exception{SmsTelephony.reconcileLater(context,config);drain();point("reconcile");}

  void age()throws Exception{now+=SmsSendJournal.MAX_OPEN_MS+1;old=true;point("age");}

  void prune()throws Exception{
   SmsSendJournal journal=SmsTelephony.journal(context,config);
   for(int i=0;i<SmsSendJournal.MAX_RECORDS;i++)
    journal.decide("synthetic-filler-"+i,numbers(),BODY[1],SUB,"cancelled",now,context.boot);
   check(readMemory()==null&&readDisk()==null&&tombstoneBinding()==1,"Actual capacity pruning retains exact durable binding");
   point("prune");
  }

  void refuseProviderInsert(boolean refuse)throws Exception{
   context.provider.refuseInsert=refuse;
   point("refuseOutbox",refuse);
  }

  void point(String name,Object... args)throws Exception{trace.step(name,observe(),args);}

  void close()throws Exception{
   Looper.runMain(()->{for(int bridge=1;bridge<=2;bridge++)if(!plugins[bridge].activity.destroyed)plugins[bridge].handleOnDestroy();});
   SmsTelephony.WORK.shutdown();SmsTelephony.WORK.awaitTermination(5,TimeUnit.SECONDS);
   Files.delete(context.noBackup.toPath());
  }
 }

 public static void main(String[] args)throws Exception{
  String mode=args[0];
  int recipients=mode.equals("per-recipient-sim-change")||mode.equals("partial-radio-throw")?2:1;
  int parts=mode.equals("multipart-provider-cannot-prove-delivery")||mode.equals("default-role-outbox")?2:1;
  boolean role=Set.of("default-role-outbox","provider-insert-refused","retired-role-outbox").contains(mode);
  Fixture f=new Fixture(mode,recipients,parts,role);
  try{
   switch(mode){
    case "cross-dialog-binding":
     f.request(1,1,"complete");f.request(2,2,"complete");
     f.approve(1,"complete");f.approve(2,"complete");
     check(f.reply.equals("invalid")&&f.replyBinding==0&&f.binding(f.readDisk())==1&&f.context.radio.attempts==1,
      "Conflicting reviewed tuple cannot receive the retained receipt or repeat radio dispatch");
     f.request(2,2,"complete");
     break;
    case "pruned-exact-dialog":
    case "pruned-conflicting-dialog":
     int lateBinding=mode.equals("pruned-exact-dialog")?1:2;
     String refusal=lateBinding==1?"expired":"invalid";
     f.request(1,1,"complete");f.request(2,lateBinding,"complete");
     f.approve(1,"complete");f.age();f.prune();f.approve(2,"complete");
     check(f.reply.equals(refusal)&&f.replyBinding==0&&f.context.radio.attempts==1,
      "Retired Send reports the same binding-specific refusal as fresh admission");
     f.restart(false);f.request(2,lateBinding,"complete");f.readback(1);
     break;
    case "exact-dialog-replay":
     f.request(1,1,"complete");f.request(1,1,"complete");f.request(2,1,"complete");
     f.approve(1,"complete");f.approve(2,"complete");f.request(1,1,"complete");f.history(1);
     break;
    case "exact-cancel-and-retired-button":
     f.request(1,1,"long-number");f.request(1,1,"empty-parts");f.request(1,1,"complete");
     f.cancel(1,false);f.cancel(1,true);
     Looper.runMain(()->f.dialog(1).clickSend());drain();
     check(f.context.radio.attempts==0,"Captured old positive callback cannot revive retired review");
     f.trace.stutter("late Send click from the cancelled exact call is ignored",f.observe());
     f.request(2,1,"complete");
     break;
    case "background-cancellation":
     f.request(1,1,"complete");f.lifecycle(1,"pause");f.request(1,1,"complete");
     f.lifecycle(1,"resume");f.readback(1);
     break;
    case "screen-off-cancellation":
     f.request(1,1,"complete");f.access("locked",true);f.lifecycle(1,"screen");
     f.readback(1);f.access("locked",false);f.readback(1);
     break;
    case "initial-permission-denied":
     f.access("send",false);f.request(1,1,"complete");f.access("send",true);f.request(2,1,"complete");
     break;
    case "carrier-replaced-before-approval":
     f.request(1,1,"complete");f.sim(2);f.approve(1,"complete");f.sim(1);f.request(2,1,"complete");
     break;
    case "per-recipient-sim-change":
     f.request(1,1,"complete");f.approve(1,"guard-change");
     f.callback(1,"sent",true,"complete");f.readback(2);f.request(1,1,"complete");
     break;
    case "partial-radio-throw":
     f.request(1,1,"complete");f.approve(1,"throw-after");
     f.callback(1,"sent",true,"complete");f.request(1,1,"complete");
     break;
    case "radio-refused-before-acceptance":
     f.request(1,1,"complete");f.approve(1,"throw-before");f.readback(2);
     break;
    case "begin-save-before-refusal":
     f.request(1,1,"complete");f.approve(1,"begin-before");f.request(2,1,"complete");
     break;
    case "begin-commit-then-failed-report":
     f.request(1,1,"complete");f.approve(1,"begin-after-and-deny-before");
     f.restart(false);f.request(2,1,"complete");
     break;
    case "end-write-failure-and-process-recovery":
     f.request(1,1,"complete");f.approve(1,"end-before");f.readback(2);f.restart(false);
     f.readback(2);f.callback(1,"sent",true,"complete");f.request(1,1,"complete");
     break;
    case "end-committed-before-failure-report":
     f.request(1,1,"complete");f.approve(1,"end-after");f.restart(false);f.readback(2);
     break;
    case "callback-evidence-is-volatile-before-save":
     f.request(1,1,"complete");f.approve(1,"complete");
     f.callback(1,"sent",true,"before");f.readback(2);f.restart(false);f.readback(2);
     break;
    case "callback-evidence-durable-before-failure-report":
     f.request(1,1,"complete");f.approve(1,"complete");
     f.callback(1,"sent",true,"after");f.restart(false);f.readback(2);
     break;
    case "immutable-receiver-and-newest-listener":
     f.request(1,1,"complete");f.approve(1,"complete");
     f.callback(1,"sent",true,"wrong-action");f.access("image",false);f.callback(1,"sent",true,"complete");f.access("image",true);
     f.lifecycle(2,"pause");f.callback(1,"sent",true,"complete");f.lifecycle(2,"resume");
     f.callback(1,"sent",false,"complete");f.lifecycle(2,"destroy");f.callback(1,"delivery",true,"complete");f.readback(1);
     break;
    case "boot-retirement-of-missing-receipts":
     f.request(1,1,"complete");f.approve(1,"complete");f.restart(true);f.request(2,1,"complete");
     break;
    case "provider-readback-requires-unique-row-and-report":
     f.request(1,1,"complete");f.approve(1,"complete");f.provider("wrong","complete");
     f.callback(1,"sent",true,"complete");f.provider("ambiguous","complete");f.callback(1,"delivery",false,"complete");
     f.provider("exact","pending");f.access("read",false);f.reconcile();f.access("read",true);f.reconcile();
     f.provider("exact","complete");f.reconcile();f.readback(2);f.history(2);
     break;
    case "multipart-provider-cannot-prove-delivery":
     f.request(1,1,"complete");f.approve(1,"complete");f.provider("exact","complete");
     f.callback(1,"delivery",true,"complete");f.callback(2,"delivery",true,"complete");
     f.callback(1,"sent",true,"complete");f.callback(2,"sent",true,"complete");f.readback(2);
     break;
    case "expired-provider-attribution":
     f.request(1,1,"complete");f.approve(1,"complete");f.callback(1,"sent",true,"complete");f.age();
     f.provider("exact","complete");f.callback(1,"delivery",true,"complete");f.readback(2);
     break;
    case "default-role-outbox":
     f.request(1,1,"complete");f.approve(1,"complete");
     f.callback(1,"sent",true,"complete");f.callback(2,"sent",false,"complete");f.readback(2);
     break;
    case "provider-insert-refused":
     f.refuseProviderInsert(true);f.request(1,1,"complete");f.approve(1,"complete");
     f.callback(1,"sent",true,"complete");f.readback(2);
     break;
    case "retired-role-outbox":
     f.request(1,1,"complete");f.approve(1,"complete");f.access("role",false);
     f.callback(1,"sent",true,"complete");f.readback(2);
     break;
    default:throw new AssertionError("Unknown schedule "+mode);
   }
   java.lang.System.out.println(f.trace.value);
  }finally{f.close();}
 }
}
