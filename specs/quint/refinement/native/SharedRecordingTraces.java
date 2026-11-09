package ai.elizaresearch.alphaphone;

import ai.eliza.voice.LocalSpeechBridgePlugin;
import ai.eliza.voice.LocalVoiceRecording;
import ai.eliza.voice.SpeechRequestGate;
import android.media.AudioManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONArray;
import org.json.JSONObject;

/** Full shared recording entry points, callback epochs and actual cancellation worker barriers. */
public final class SharedRecordingTraces {
 public static final class Bridge extends LocalSpeechBridgePlugin {
  Bridge(){super("alpha-cloud-voice-","alpha-cloud-tts-");}
  void pauseHost(){handleOnPause();}
  void resumeHost(){handleOnResume();}
  void closeHost(){handleOnDestroy();}
 }
 static Bridge bridge;
 static Trace trace;
 static final Map<Integer,PluginCall> calls=new HashMap<>();
 static final Map<String,Integer> recordingOwners=new HashMap<>();
 static Runnable cancelTask,barrierTask;
 static CountDownLatch workerRelease;
 static boolean lastAccepted,lastForeground,lastDestroyed,lastCall,lastDraining;
 static long lastEpoch,lastCurrent;
 static SpeechRequestGate gate()throws Exception{return (SpeechRequestGate)Trace.read(bridge,"gate");}
 static LocalVoiceRecording capture()throws Exception{return (LocalVoiceRecording)Trace.read(bridge,"capture");}
 static long epoch()throws Exception{return ((AtomicLong)Trace.read(bridge,"epoch")).get();}
 static ExecutorService workers()throws Exception{return (ExecutorService)Trace.read(bridge,"workers");}
 @SuppressWarnings("unchecked") static Map<Object,Runnable> waiters()throws Exception{return (Map<Object,Runnable>)Trace.read(gate(),"waiters");}
 @SuppressWarnings("unchecked") static Map<String,Long> pending()throws Exception{return (Map<String,Long>)Trace.read(bridge,"permissionEpochs");}
 static Object captured(Object lambda,Class<?> type)throws Exception {
  for(Field field:lambda.getClass().getDeclaredFields())if(field.getType()==type){field.setAccessible(true);return field.get(lambda);}
  return null;
 }
 static Runnable queued(PluginCall call)throws Exception {
  for(Runnable task:NoteBridgePorts.queue)if(captured(task,PluginCall.class)==call&&captured(task,long.class)!=null)return task;
  return null;
 }
 static String outcome(PluginCall call){
  if(call==null)return "none";if(call.settled==0)return "pending";
  if(call.rejected==null)return call.result==null?"done":call.result.getString("status");
  if("call-active".equals(call.code))return "call";
  if("permission-denied".equals(call.code))return "permission";
  if(call.rejected.equals("Recording cancelled"))return "cancelled";
  if(call.rejected.equals("Voice cancellation is still draining"))return "draining";
  if(call.rejected.equals("Microphone could not start"))return "capture";
  return "unavailable";
 }
 static JSONObject qmap(JSONArray entries){return new JSONObject().put("quintCollection","map").put("entries",entries);}
 static JSONObject observe()throws Exception {
  JSONArray pending=new JSONArray(),queued=new JSONArray(),outcomes=new JSONArray(),waiting=new JSONArray();
  for(int id=1;id<=4;id++){
   PluginCall call=calls.get(id);Long admitted=call==null?null:pending().get(call.getCallbackId());
   Runnable task=call==null?null:queued(call);Long queuedEpoch=task==null?null:(Long)captured(task,long.class);
   pending.put(new JSONArray().put(id).put(admitted==null?-1:admitted));queued.put(new JSONArray().put(id).put(queuedEpoch==null?-1:queuedEpoch));
   outcomes.put(new JSONArray().put(id).put(outcome(call)));if(call!=null&&waiters().containsKey(call))waiting.put(id);
  }
  String recording=(String)Trace.read(capture(),"id");
  JSONObject event=NoteBridgePorts.events.isEmpty()?null:NoteBridgePorts.events.getJSONObject(NoteBridgePorts.events.length()-1).getJSONObject("value");
  return Trace.fields("epoch",epoch(),"foreground",Trace.read(bridge,"speechForeground"),"destroyed",Trace.read(bridge,"destroyed"),
   "inCall",NoteBridgePorts.audio.mode!=AudioManager.MODE_NORMAL,"permission",NoteBridgePorts.permission.name().toLowerCase(),
   "pending",qmap(pending),"queued",qmap(queued),"outcomes",qmap(outcomes),"draining",gate().draining(),
   "waiters",new JSONObject().put("quintCollection","set").put("values",waiting),
   "cancelQueued",cancelTask!=null&&NoteBridgePorts.queue.contains(cancelTask),"barrierQueued",barrierTask!=null&&NoteBridgePorts.queue.contains(barrierTask),
   "captureOwner",recording==null?0:recordingOwners.get(recording),"captureOpen",Trace.read(capture(),"recorder")!=null,
   "captureInterrupted",Trace.read(capture(),"interrupted"),
   "starts",NoteBridgePorts.starts,"event",event==null?"none":event.optString("interrupted",event.getString("status")),"events",NoteBridgePorts.events.length(),
   "lastAccepted",lastAccepted,"lastEpoch",lastEpoch,"lastCurrent",lastCurrent,"lastForeground",lastForeground,
   "lastDestroyed",lastDestroyed,"lastCall",lastCall,"lastDraining",lastDraining);
 }
 static void permission(PermissionState value)throws Exception {NoteBridgePorts.permission=value;trace.step("setPermission",observe(),value.name().toLowerCase());}
 static void phone(boolean active)throws Exception {NoteBridgePorts.audio.mode=active?AudioManager.MODE_IN_CALL:AudioManager.MODE_NORMAL;trace.step("setCall",observe(),active);}
 static void request(int id)throws Exception {PluginCall call=new PluginCall(new JSObject());calls.put(id,call);bridge.startRecording(call);trace.step("request",observe(),id);}
 static void reply(int id,boolean granted)throws Exception {
  NoteBridgePorts.permission=granted?PermissionState.GRANTED:PermissionState.DENIED;
  Method callback=LocalSpeechBridgePlugin.class.getDeclaredMethod("microphonePermission",PluginCall.class);callback.setAccessible(true);callback.invoke(bridge,calls.get(id));
  trace.step("permissionReply",observe(),id,granted);
 }
 static void start(int id,boolean opens)throws Exception {
  Runnable task=queued(calls.get(id));if(task==null)throw new AssertionError("No queued recording start");
  lastEpoch=(Long)captured(task,long.class);lastCurrent=epoch();lastForeground=(boolean)Trace.read(bridge,"speechForeground");
  lastDestroyed=(boolean)Trace.read(bridge,"destroyed");lastCall=NoteBridgePorts.audio.mode!=AudioManager.MODE_NORMAL;lastDraining=gate().draining();
  NoteRecordingPorts.failOpen=!opens;NoteBridgePorts.queue.remove(task);task.run();lastAccepted=outcome(calls.get(id)).equals("recording");
  if(lastAccepted)recordingOwners.put(calls.get(id).result.getString("recordingId"),id);
  trace.step("runStart",observe(),id,opens);
 }
 static void host(String action)throws Exception {
  if(action.equals("pauseHost"))bridge.pauseHost();else if(action.equals("resumeHost"))bridge.resumeHost();else bridge.closeHost();
  trace.step(action,observe());
 }
 static void interrupt(boolean released)throws Exception {
  Method callback=LocalSpeechBridgePlugin.class.getDeclaredMethod("callStarted");callback.setAccessible(true);
  String id=calls.get(1).result.getString("recordingId");
  File file=(File)Trace.read(capture(),"file");
  int events=NoteBridgePorts.events.length();
  NoteRecordingPorts.failRelease=!released;callback.invoke(bridge);
  JSONObject event=NoteBridgePorts.events.getJSONObject(0).getJSONObject("value");
  if(!"failed".equals(event.getString("status"))||!"call-active".equals(event.getString("interrupted"))||
     !id.equals(event.getString("recordingId"))||event.has("durationMs")||capture().selected(id)!=null)
   throw new AssertionError("Call published selectable audio or an unbound terminal event");
  if(events==0&&(file==null||file.exists()==released))throw new AssertionError("Call cleanup state disagrees with release");
  trace.step("interruptForCall",observe(),released);
 }
 static void cancel(int id)throws Exception {
  ArrayList<Runnable> before=new ArrayList<>(NoteBridgePorts.queue);PluginCall call=new PluginCall(new JSObject());calls.put(id,call);bridge.cancelRecording(call);
  for(Runnable task:NoteBridgePorts.queue)if(!before.contains(task))cancelTask=task;
  trace.step("beginCancel",observe(),id);
 }
 static void runCancel(boolean captureOk,boolean accepts)throws Exception {
  if(!accepts&&!workers().isShutdown())for(int n=0;n<4;n++)workers().execute(()->{});
  NoteRecordingPorts.failRelease=!captureOk;NoteBridgePorts.queue.remove(cancelTask);ArrayList<Runnable> before=new ArrayList<>(NoteBridgePorts.queue);cancelTask.run();
  if(captureOk&&accepts){
   workerRelease.countDown();workers().submit(()->{}).get(5,TimeUnit.SECONDS);
   for(Runnable task:NoteBridgePorts.queue)if(!before.contains(task))barrierTask=task;
   if(barrierTask==null)throw new AssertionError("No posted completion barrier");
  }
  trace.step("runCancel",observe(),captureOk,accepts);
 }
 static void finish()throws Exception {NoteBridgePorts.queue.remove(barrierTask);barrierTask.run();trace.step("finishBarrier",observe());}
 static void timeout(int id)throws Exception {Runnable task=waiters().get(calls.get(id));task.run();trace.step("timeout",observe(),id);}
 static void stop(boolean accepted)throws Exception {
  PluginCall call=new PluginCall(new JSObject());ArrayList<Runnable> before=new ArrayList<>(NoteBridgePorts.queue);bridge.stopRecording(call);
  for(Runnable task:new ArrayList<>(NoteBridgePorts.queue))if(!before.contains(task)){NoteBridgePorts.queue.remove(task);task.run();}
  if((call.rejected==null)!=accepted||call.settled!=1)throw new AssertionError("Unexpected stop result");
  if(accepted)trace.step("stopDraft",observe());
  else trace.value.getJSONArray("steps").put(new JSONObject().put("label","interrupted stop refused")
   .put("action",Trace.action("stopDraft").put("reject",true)).put("expect",observe()));
 }
 static void run(String path,String mode)throws Exception {
  NoteRecordingPorts.root=new File(path,mode);NoteRecordingPorts.root.mkdirs();bridge=new Bridge();bridge.load();NoteBridgePorts.hold=true;
  workerRelease=new CountDownLatch(1);CountDownLatch workerHeld=new CountDownLatch(1);
  workers().execute(()->{workerHeld.countDown();try{workerRelease.await();}catch(InterruptedException ignored){Thread.currentThread().interrupt();}});
  if(!workerHeld.await(5,TimeUnit.SECONDS))throw new AssertionError("No worker hold");trace=new Trace("shared-recording-"+mode,observe());
  try{
   if(mode.equals("call-direct")){phone(true);request(1);}
   else if(mode.startsWith("permission")||mode.equals("two-prompts")){
    permission(PermissionState.PROMPT);request(1);
    if(mode.equals("two-prompts")){request(2);reply(2,true);reply(1,true);start(2,true);start(1,true);}
    else{
     if(mode.equals("permission-call"))phone(true);
     if(mode.equals("permission-pause")||mode.equals("permission-resume"))host("pauseHost");
     if(mode.equals("permission-resume"))host("resumeHost");
     if(mode.equals("permission-destroy"))host("closeHost");
     if(mode.equals("permission-cancel"))cancel(3);
     reply(1,!mode.equals("permission-denied"));
     if(mode.equals("permission-cancel")){runCancel(true,true);finish();}
     else if(!mode.equals("permission-denied")&&!mode.equals("permission-destroy"))start(1,true);
    }
   }else if(mode.startsWith("cancel")){
    if(mode.equals("cancel-live")||mode.equals("cancel-release-failure")){request(1);start(1,true);}
    else if(mode.equals("cancel-queued"))request(1);
    cancel(3);
    if(mode.equals("cancel-joined"))cancel(4);
    if(mode.equals("cancel-timeout"))timeout(3);
    if(mode.equals("cancel-destroy"))host("closeHost");
    if(mode.equals("cancel-queued"))start(1,true);
    runCancel(!mode.equals("cancel-release-failure"),!mode.equals("cancel-worker-refused")&&!mode.equals("cancel-destroy"));
    if(mode.equals("cancel-release-failure")||mode.equals("cancel-worker-refused")||mode.equals("cancel-destroy")){request(2);}
    else{
     if(mode.equals("cancel-start-during"))request(1);
     finish();
     if(mode.equals("cancel-retry")){request(2);start(2,true);}
    }
   }else{
    request(1);
    if(mode.equals("queued-call"))phone(true);
    if(mode.equals("queued-pause")||mode.equals("queued-resume"))host("pauseHost");
    if(mode.equals("queued-resume"))host("resumeHost");
    if(mode.equals("queued-destroy"))host("closeHost");
    start(1,!mode.equals("open-failure"));
    if(mode.equals("pause-active"))host("pauseHost");
    if(mode.equals("call-active")){phone(true);interrupt(true);interrupt(true);}
    if(mode.equals("call-release-failure")){
     phone(true);interrupt(false);interrupt(true);phone(false);stop(false);
     cancel(3);runCancel(true,true);finish();request(2);start(2,true);
    }
    if(mode.equals("destroy-active"))host("closeHost");
    if(mode.equals("stop"))stop(true);
    if(mode.equals("second-start")){request(2);start(2,true);}
   }
   for(PluginCall call:calls.values())if(call.settled>1)throw new AssertionError("Call settled twice");
   System.out.println(trace.value);
  }finally{
   NoteRecordingPorts.failRelease=false;workerRelease.countDown();NoteBridgePorts.hold=false;
   if(!(boolean)Trace.read(bridge,"destroyed"))bridge.closeHost();
   workers().awaitTermination(5,TimeUnit.SECONDS);
  }
 }
 public static void main(String[] args)throws Exception {
  if(!args[1].equals("campaign")){run(args[0],args[1]);return;}
  JSONArray traces=new JSONArray();
  for(int i=2;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),SharedRecordingTraces.class.getName(),args[0],args[i]).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String output=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new AssertionError("Shared recording scenario failed: "+args[i]);traces.put(new JSONObject(output));
  }
  System.out.println(traces);
 }
}
