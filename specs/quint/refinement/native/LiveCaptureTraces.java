package ai.alphacompute.alphaphone;

import ai.eliza.voice.*;
import android.media.AudioManager;
import android.media.AudioRecord;
import com.getcapacitor.*;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import org.json.*;

/** Actual shared parent/controller/capture lifecycle with controlled physical media ports. */
public final class LiveCaptureTraces {
 static final class Bridge extends LocalSpeechBridgePlugin {
  Bridge(){super("alpha-cloud-voice-","alpha-cloud-tts-");}
  void pauseHost(){handleOnPause();}void resumeHost(){handleOnResume();}void closeHost(){handleOnDestroy();}
 }
 static Bridge bridge;static LiveCaptureController controller;static Trace trace;
 static final Map<Integer,PluginCall> calls=new HashMap<>();
 static final Map<Integer,LiveCaptureAdmission.Ticket> tickets=new HashMap<>();
 static final Map<Integer,LiveVoiceCapture> captures=new HashMap<>();
 static final Map<Integer,AudioRecord> records=new HashMap<>();
 static final Set<Integer> stopping=new HashSet<>();
 static CountDownLatch held;static int opening,seenEvents;
 static boolean cleanup,admitted,admittedCall,admittedForeground,admittedDestroyed;
 static long admittedEpoch,admissionEpoch;
 static String identity(int id){return String.format("00000000-0000-0000-0000-%012d",id);}
 static int idOf(String id){return id==null?0:Integer.parseInt(id.substring(id.length()-1));}
 static Object captured(Object lambda,Class<?> type)throws Exception {for(Field field:lambda.getClass().getDeclaredFields())if(field.getType()==type){field.setAccessible(true);return field.get(lambda);}return null;}
 static ExecutorService worker()throws Exception{return (ExecutorService)Trace.read(controller,"worker");}
 static void hold()throws Exception {
  if(held!=null)return;held=new CountDownLatch(1);CountDownLatch started=new CountDownLatch(1);CountDownLatch release=held;
  worker().execute(()->{started.countDown();try{release.await();}catch(InterruptedException stopped){Thread.currentThread().interrupt();}});
  if(!started.await(5,TimeUnit.SECONDS))throw new AssertionError("Worker did not hold");
 }
 static void release(){if(held!=null){held.countDown();held=null;}}
 static void workers()throws Exception {
  ExecutorService stopWorker=(ExecutorService)Trace.read(controller,"stopWorker");
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
  while(!stopWorker.isShutdown()){
   try{stopWorker.submit(()->{}).get(5,TimeUnit.SECONDS);break;}
   catch(RejectedExecutionException busy){
    // The production stop worker has one queue slot. Wait for accepted work
    // instead of treating rejection of the observer barrier as a source failure.
    if(System.nanoTime()>=deadline)throw busy;
    Thread.sleep(1);
   }
  }
  if(stopWorker.isShutdown())stopWorker.awaitTermination(5,TimeUnit.SECONDS);
  for(LiveVoiceCapture capture:captures.values()){
   Thread thread=(Thread)Trace.read(capture,"thread");
   if(thread!=null&&!(boolean)Trace.read(capture,"running"))thread.join(3000);
  }
 }
 static long epoch()throws Exception{return ((AtomicLong)Trace.read(bridge,"epoch")).get();}
 static int ticketNumber(Object ticket){for(var entry:tickets.entrySet())if(entry.getValue()==ticket)return entry.getKey();return 0;}
 static int captureNumber(Object capture){for(var entry:captures.entrySet())if(entry.getValue()==capture)return entry.getKey();return 0;}
 @SuppressWarnings("unchecked") static Map<String,LiveCaptureAdmission.Ticket> permissions()throws Exception{return (Map<String,LiveCaptureAdmission.Ticket>)Trace.read(bridge,"livePermissionEpochs");}
 static Object active()throws Exception{return Trace.read(Trace.read(controller,"admission"),"active");}
 static String outcome(PluginCall call){
  if(call==null)return "none";if(call.settled==0)return "pending";if(call.rejected==null)return "recording";
  if("call-active".equals(call.code))return "call";if("permission-denied".equals(call.code))return "permission";
  if("capture".equals(call.code))return "capture";return "cancelled";
 }
 static String reason(JSONObject value){String error=value.optString("error");return error.equals("call-active")?"call":error.equals("capture")?"capture":"none";}
 static JSONObject map(JSONArray pairs){return new JSONObject().put("quintCollection","map").put("entries",pairs);}
 static JSONObject set(Collection<Integer> values){return new JSONObject().put("quintCollection","set").put("values",new JSONArray(new TreeSet<>(values)));}
 static void capture(int ticket)throws Exception {
  LiveCaptureAdmission.Ticket value=tickets.get(ticket);if(value==null)return;
  Object callback=Trace.read(value,"cancel");if(callback==null)return;
  LiveVoiceCapture resource=(LiveVoiceCapture)captured(callback,LiveVoiceCapture.class);if(resource!=null)captures.put(ticket,resource);
 }
 static JSONObject observe()throws Exception {
  Set<Integer> cancelled=new HashSet<>(),discarded=new HashSet<>(),attached=new HashSet<>(),pending=new HashSet<>(),queued=new HashSet<>();
  JSONArray epochs=new JSONArray(),ids=new JSONArray(),outcomes=new JSONArray(),sources=new JSONArray();
  for(Runnable task:((ThreadPoolExecutor)Trace.read(worker(),"e")).getQueue()){
   Object ticket=captured(task,LiveCaptureAdmission.Ticket.class);int number=ticketNumber(ticket);if(number!=0)queued.add(number);
  }
  for(int number=1;number<=2;number++){
   var ticket=tickets.get(number);var call=calls.get(number);capture(number);
   if(ticket!=null){if((boolean)Trace.read(ticket,"cancelled"))cancelled.add(number);if((boolean)Trace.read(ticket,"discard"))discarded.add(number);if(Trace.read(ticket,"cancel")!=null)attached.add(number);}
   if(call!=null&&permissions().containsKey(call.getCallbackId()))pending.add(number);
   epochs.put(new JSONArray().put(number).put(ticket==null?-1:ticket.epoch));
   ids.put(new JSONArray().put(number).put(call==null?0:idOf(call.getString("captureId"))));outcomes.put(new JSONArray().put(number).put(outcome(call)));
   var record=records.get(number);var object=captures.get(number);
   boolean stopped=object!=null&&(boolean)Trace.read(Trace.read(object,"resource"),"stopped");
   boolean releaseFailed=object!=null&&(boolean)Trace.read(Trace.read(object,"resource"),"releaseFailed");
   sources.put(new JSONArray().put(number).put(new JSONObject().put("allocated",record!=null).put("running",record!=null&&record.recording)
    .put("released",record!=null&&record.released).put("stopped",stopped).put("releaseFailed",releaseFailed)));
  }
  int frames=0,ended=0;String endReason="none";
  for(int index=0;index<NoteBridgePorts.events.length();index++){
   JSONObject event=NoteBridgePorts.events.getJSONObject(index);if(event.getString("event").equals("liveCaptureFrames"))frames++;
   if(event.getString("event").equals("liveCaptureEnded")){ended++;endReason=reason(event.getJSONObject("value"));}
  }
  String interrupted=(String)Trace.read(controller,"interrupted");
  return Trace.fields("epoch",epoch(),"foreground",Trace.read(bridge,"speechForeground"),"destroyed",Trace.read(bridge,"destroyed"),
   "inCall",NoteBridgePorts.audio.mode!=AudioManager.MODE_NORMAL,"permission",NoteBridgePorts.permission==PermissionState.GRANTED,
   "active",ticketNumber(active()),"ticketEpoch",map(epochs),"ids",map(ids),"cancelled",set(cancelled),"discarded",set(discarded),
   "attached",set(attached),"permissions",set(pending),"queued",set(queued),"opening",opening,
   "live",captureNumber(Trace.read(controller,"live")),"current",captureNumber(Trace.read(controller,"current")),"cleanup",cleanup,"stopQueued",set(stopping),
   "interrupted",interrupted==null?"none":interrupted.equals("call-active")?"call":"cancelled","outcomes",map(outcomes),"sources",map(sources),
   "startsDuringCall",LiveCapturePorts.startsDuringCall,"frames",frames,"ended",ended,"endReason",endReason,
   "admitted",admitted,"admittedEpoch",admittedEpoch,"admissionEpoch",admissionEpoch,"admittedCall",admittedCall,
   "admittedForeground",admittedForeground,"admittedDestroyed",admittedDestroyed);
 }
 static void step(String action,Object...args)throws Exception {trace.step(action,observe(),args);seenEvents=NoteBridgePorts.events.length();}
 static void complete(String action,Object...args)throws Exception {
  ArrayList<JSONObject> actions=new ArrayList<>();actions.add(Trace.action(action,args));
  for(int index=seenEvents;index<NoteBridgePorts.events.length();index++){
   JSONObject event=NoteBridgePorts.events.getJSONObject(index);JSONObject data=event.getJSONObject("value");
   int ticket=0;for(var entry:tickets.entrySet())if(entry.getValue().id.equals(data.optString("captureId")))ticket=entry.getKey();
   if(event.getString("event").equals("liveCaptureEnded"))actions.add(Trace.action("emitEnded",ticket,reason(data)));
   else if(event.getString("event").equals("liveCaptureFrames"))actions.add(Trace.action("emitFrames",ticket));
  }
  trace.macro(action,observe(),actions.toArray(new JSONObject[0]));seenEvents=NoteBridgePorts.events.length();
 }
 static void permission(boolean granted)throws Exception {NoteBridgePorts.permission=granted?PermissionState.GRANTED:PermissionState.PROMPT;step("setPermission",granted);}
 static void phone(boolean active)throws Exception {NoteBridgePorts.audio.mode=active?AudioManager.MODE_IN_CALL:AudioManager.MODE_NORMAL;step("setCall",active);}
 static void request(int ticket,int id)throws Exception {
  if(opening==0)hold();PluginCall call=new PluginCall(new JSObject().put("captureId",identity(id)));calls.put(ticket,call);bridge.startLiveCapture(call);
  Object active=active();if(active!=null&&ticketNumber(active)==0)tickets.put(ticket,(LiveCaptureAdmission.Ticket)active);
  workers();complete("request",ticket,id);
 }
 static void reply(int ticket,boolean granted)throws Exception {
  if(opening==0&&!worker().isShutdown())hold();
  NoteBridgePorts.permission=granted?PermissionState.GRANTED:PermissionState.DENIED;
  Method callback=LocalSpeechBridgePlugin.class.getDeclaredMethod("liveMicrophonePermission",PluginCall.class);callback.setAccessible(true);callback.invoke(bridge,calls.get(ticket));step("permissionReply",ticket,granted);
 }
 static void begin(int ticket)throws Exception {
  LiveCapturePorts.holdOpen=true;LiveCapturePorts.opening=new CountDownLatch(1);LiveCapturePorts.allowOpen=new CountDownLatch(1);
  int prior=LiveCapturePorts.records.size();release();
  long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
  while(LiveCapturePorts.opening.getCount()!=0&&calls.get(ticket).settled==0&&System.nanoTime()<deadline)Thread.sleep(1);
  if(LiveCapturePorts.records.size()>prior){opening=ticket;records.put(ticket,LiveCapturePorts.records.get(prior));capture(ticket);}
  else worker().submit(()->{}).get(5,TimeUnit.SECONDS);
  workers();complete("beginOpen",ticket);
 }
 static void finish(boolean opens,boolean releases)throws Exception {
  int ticket=opening;admittedEpoch=tickets.get(ticket).epoch;admissionEpoch=epoch();admittedCall=NoteBridgePorts.audio.mode!=AudioManager.MODE_NORMAL;
  admittedForeground=(boolean)Trace.read(bridge,"speechForeground");admittedDestroyed=(boolean)Trace.read(bridge,"destroyed");
  LiveCapturePorts.failStart=!opens;LiveCapturePorts.failRelease=!releases;LiveCapturePorts.allowOpen.countDown();LiveCapturePorts.holdOpen=false;
  worker().submit(()->{}).get(5,TimeUnit.SECONDS);workers();opening=0;admitted=outcome(calls.get(ticket)).equals("recording");
  complete("finishOpen",opens,releases);
 }
 static void stop(int id,boolean discard)throws Exception {
  if(opening==0)hold();bridge.stopLiveCapture(new PluginCall(new JSObject().put("captureId",identity(id)).put("discard",discard)));
  stopping.add(id);workers();complete("stop",id,discard);
 }
 static void finishStop(int id)throws Exception {release();worker().submit(()->{}).get(5,TimeUnit.SECONDS);workers();stopping.remove(id);complete("finishStop",id);}
 static void host(String action)throws Exception {
  if(action.equals("pauseHost")){if(opening==0)hold();bridge.pauseHost();cleanup=true;}
  else if(action.equals("resumeHost"))bridge.resumeHost();
  else {if(opening==0)hold();bridge.closeHost();cleanup=true;}
  workers();complete(action);
 }
 static void cleanup()throws Exception {release();if(!worker().isShutdown())worker().submit(()->{}).get(5,TimeUnit.SECONDS);else worker().awaitTermination(5,TimeUnit.SECONDS);workers();cleanup=false;complete("cleanup");}
 static void interrupt()throws Exception {Method method=LocalSpeechBridgePlugin.class.getDeclaredMethod("callStarted");method.setAccessible(true);method.invoke(bridge);workers();complete("interruptForCall");}
 static void frames(int ticket)throws Exception {LiveVoiceCapture.Sink sink=(LiveVoiceCapture.Sink)Trace.read(captures.get(ticket),"sink");sink.frames(tickets.get(ticket).id,new JSONArray(),new JSONArray(),0);step("emitFrames",ticket);}
 static void run(String path,String mode)throws Exception {
  NoteRecordingPorts.root=new File(path,mode);NoteRecordingPorts.root.mkdirs();bridge=new Bridge();bridge.load();controller=(LiveCaptureController)Trace.read(bridge,"live");
  try{
   hold();trace=new Trace("live-capture-"+mode,observe());
   if(mode.startsWith("permission")){
    permission(false);request(1,1);
    if(mode.equals("permission-call"))phone(true);
    if(mode.equals("permission-replaced"))request(2,2);
    if(mode.equals("permission-pause")||mode.equals("permission-resume"))host("pauseHost");
    if(mode.equals("permission-resume"))host("resumeHost");
    if(mode.equals("permission-destroy"))host("closeHost");
    reply(1,!mode.equals("permission-denied"));
    if(mode.equals("permission-call")){begin(1);}
    else if(mode.equals("permission")){begin(1);finish(true,true);}
   }else{
    request(1,1);begin(1);
    if(mode.startsWith("opening-call")){phone(true);interrupt();}
    if(mode.equals("opening-stop"))stop(1,true);
    if(mode.equals("opening-replace")){permission(false);request(2,2);}
    if(mode.equals("opening-pause"))host("pauseHost");
    finish(!mode.equals("open-failure"),!mode.equals("opening-call-release-failure"));
    if(mode.equals("active-call")){phone(true);interrupt();}
    if(mode.equals("active-pause")){host("pauseHost");cleanup();}
    if(mode.equals("active-destroy")){host("closeHost");cleanup();}
    if(mode.equals("stop-tail")||mode.equals("stop-discard")){stop(1,mode.equals("stop-discard"));frames(1);finishStop(1);}
    if(mode.equals("opening-stop"))finishStop(1);
    if(mode.equals("opening-pause"))cleanup();
    if(mode.equals("opening-replace")){reply(2,true);begin(2);finish(true,true);}
    if(mode.equals("replace-active")){request(2,2);begin(2);finish(true,true);frames(1);}
   }
   System.out.println(trace.value);
  }finally{
   LiveCapturePorts.allowOpen.countDown();release();LiveCapturePorts.failRelease=false;
   if(!(boolean)Trace.read(bridge,"destroyed"))bridge.closeHost();
   for(String field:new String[]{"worker","stopWorker","pipeWorker"})((ExecutorService)Trace.read(controller,field)).awaitTermination(5,TimeUnit.SECONDS);
   ((ExecutorService)Trace.read(bridge,"workers")).awaitTermination(5,TimeUnit.SECONDS);
  }
 }
 public static void main(String[]args)throws Exception {
  if(!args[1].equals("campaign")){run(args[0],args[1]);return;}
  JSONArray traces=new JSONArray();for(int index=2;index<args.length;index++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","--add-opens=java.base/java.util.concurrent=ALL-UNNAMED","-cp",System.getProperty("java.class.path"),LiveCaptureTraces.class.getName(),args[0],args[index]).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String output=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new AssertionError("Live capture scenario failed: "+args[index]);traces.put(new JSONObject(output));
  }System.out.println(traces);
 }
}
