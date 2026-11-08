package ai.elizaresearch.alphaphone;

import android.media.AudioManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.lang.reflect.Method;
import org.json.JSONArray;
import org.json.JSONObject;

/** Executes complete product Note methods. Parent lifecycle/permission are external ports. */
public final class NotePermissionTraces {
 static AlphaVoiceCloudPlugin plugin;
 static Trace trace;
 static PluginCall call;
 static String queued="none";
 static boolean lastForeground,lastClosed,lastCall,lastAccepted;
 static int lastStarts;
 static String permission(){return NoteBridgePorts.permission.name().toLowerCase();}
 static boolean inCall(){return NoteBridgePorts.audio.mode!=AudioManager.MODE_NORMAL;}
 static String outcome(){
  if(call==null)return "none";
  if(call.settled==0)return "pending";
  if(call.rejected!=null){
   if("call-active".equals(call.code))return "call";
   if("permission-denied".equals(call.code))return "permission";
   if("Recording cancelled".equals(call.rejected))return "cancelled";
   return "error";
  }
  return call.result.getString("state");
 }
 static JSONObject observe()throws Exception {
  return Trace.fields("foreground",Trace.read(plugin,"noteForeground"),"closed",Trace.read(plugin,"closed"),
   "inCall",inCall(),"permission",permission(),
   "permissionPending",NoteBridgePorts.permissionCall!=null&&NoteBridgePorts.permissionCall.settled==0&&queued.equals("none"),
   "queued",queued,"recording",AlphaNoteRecorder.get(NoteBridgePorts.context).status().getString("state"),
   "outcome",outcome(),"starts",NoteBridgePorts.starts,"lastForeground",lastForeground,
   "lastClosed",lastClosed,"lastCall",lastCall,"lastAccepted",lastAccepted,"lastStarts",lastStarts);
 }
 static PluginCall fresh(boolean resume){
  JSObject data=new JSObject().put("ownerDigest","a".repeat(64)).put("folderId","f-one");
  if(resume)data.put("recordingId",AlphaNoteRecorder.get(NoteBridgePorts.context).status().getString("recordingId"));
  return new PluginCall(data);
 }
 static void permission(PermissionState state)throws Exception {
  NoteBridgePorts.permission=state;trace.step("setPermission",observe(),permission());
 }
 static void phone(boolean active)throws Exception {
  NoteBridgePorts.audio.mode=active?AudioManager.MODE_IN_CALL:AudioManager.MODE_NORMAL;
  trace.step("setCall",observe(),active);
 }
 static void host(String action)throws Exception {
  if(action.equals("pauseHost"))plugin.handleOnPause();
  else if(action.equals("resumeHost"))plugin.handleOnResume();
  else plugin.fixtureDestroy();
  trace.step(action,observe());
 }
 static void request(boolean resume)throws Exception {
  NoteBridgePorts.hold=true;call=fresh(resume);
  if(resume)plugin.resumeNoteRecording(call);else plugin.startNoteRecording(call);
  queued=NoteBridgePorts.queue.isEmpty()?"none":resume?"resume":"start";
  trace.step(resume?"requestResume":"requestStart",observe());
 }
 static void reply(boolean granted)throws Exception {
  NoteBridgePorts.permission=granted?PermissionState.GRANTED:PermissionState.DENIED;
  Method callback=AlphaVoiceCloudPlugin.class.getDeclaredMethod("noteMicrophonePermission",PluginCall.class);
  callback.setAccessible(true);callback.invoke(plugin,NoteBridgePorts.permissionCall);
  queued=NoteBridgePorts.queue.isEmpty()?"none":"start";
  trace.step("permissionReply",observe(),granted);
 }
 static void deliver(boolean success)throws Exception {
  lastForeground=(boolean)Trace.read(plugin,"noteForeground");lastClosed=(boolean)Trace.read(plugin,"closed");
  lastCall=inCall();lastStarts=NoteBridgePorts.starts;NoteRecordingPorts.failOpen=!success;
  NoteBridgePorts.hold=false;NoteBridgePorts.flush();queued="none";
  lastAccepted=outcome().equals("recording");trace.step("runQueued",observe(),success);
 }
 static void edit(String action)throws Exception {
  call=fresh(true);NoteBridgePorts.hold=false;
  if(action.equals("pauseRecording"))plugin.pauseNoteRecording(call);
  else if(action.equals("discardRecording"))plugin.discardNoteRecording(call);
  else plugin.stopNoteRecording(call);
  trace.step(action,observe());
 }
 static void run(String path,String mode)throws Exception {
  NoteRecordingPorts.root=new File(path,mode);NoteRecordingPorts.root.mkdirs();
  plugin=new AlphaVoiceCloudPlugin();plugin.load();trace=new Trace("note-permission-"+mode,observe());
  if(mode.equals("direct-call")){phone(true);request(false);}
  else if(mode.equals("permission-denied")){permission(PermissionState.PROMPT);request(false);reply(false);}
  else if(mode.startsWith("permission-")){
   permission(PermissionState.PROMPT);request(false);
   if(mode.equals("permission-call"))phone(true);
   if(mode.equals("permission-closed"))host("closeHost");
   if(mode.equals("permission-paused"))host("pauseHost");
   reply(true);deliver(true);
  }else if(mode.equals("resume-empty")){request(true);deliver(true);}
  else{
   request(false);
   if(mode.equals("queued-call"))phone(true);
   if(mode.equals("queued-paused"))host("pauseHost");
   if(mode.equals("queued-closed"))host("closeHost");
   if(mode.equals("paused-resumed")){host("pauseHost");host("resumeHost");}
   deliver(!mode.equals("start-failure"));
   if(mode.startsWith("resume")||mode.equals("second-start")||mode.equals("discard-retry")){
    if(mode.equals("second-start")){request(false);deliver(true);}
    else if(mode.equals("discard-retry")){edit("discardRecording");request(false);deliver(true);}
    else{
     if(!mode.equals("resume-recording"))edit(mode.equals("resume-stopped")||mode.equals("resume-failure")?"stopRecording":"pauseRecording");
     if(mode.equals("resume-direct-call"))phone(true);
     if(mode.equals("resume-retired")){host("pauseHost");host("closeHost");}
     request(true);
     if(mode.equals("resume-queued-call"))phone(true);
     if(mode.equals("resume-paused"))host("pauseHost");
     if(!mode.equals("resume-direct-call"))deliver(!mode.equals("resume-failure"));
    }
   }
  }
  if(call!=null&&call.settled>1)throw new AssertionError("Call settled more than once");
  System.out.println(trace.value);
 }
 public static void main(String[] args)throws Exception {
  if(!args[1].equals("campaign")){run(args[0],args[1]);return;}
  JSONArray traces=new JSONArray();
  for(int i=2;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),NotePermissionTraces.class.getName(),args[0],args[i])
    .redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String output=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new AssertionError("Note permission scenario failed: "+args[i]);
   traces.put(new JSONObject(output));
  }
  System.out.println(traces);
 }
}
