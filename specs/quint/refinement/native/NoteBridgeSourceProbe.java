package ai.alphacompute.alphaphone;

import android.media.AudioManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import java.io.File;
import org.json.JSONObject;

/** Product note methods execute with controlled parent lifecycle and permission ports. */
public final class NoteBridgeSourceProbe {
 public static void main(String[] args)throws Exception {
  NoteRecordingPorts.root=new File(args[0]);NoteRecordingPorts.root.mkdirs();
  String mode=args.length>1?args[1]:"resume-closed";
  AlphaVoiceCloudPlugin plugin=new AlphaVoiceCloudPlugin();plugin.load();
  PluginCall action;
  if(mode.startsWith("resume")){
   PluginCall begin=new PluginCall(new JSObject().put("ownerDigest","a".repeat(64)).put("folderId","f-one"));
   plugin.startNoteRecording(begin);
   String id=begin.result.getString("recordingId");
   plugin.pauseNoteRecording(new PluginCall(new JSObject().put("recordingId",id)));
   if(mode.equals("resume-closed")){plugin.handleOnPause();plugin.fixtureDestroy();}
   else NoteBridgePorts.hold=true;
   action=new PluginCall(new JSObject().put("recordingId",id));plugin.resumeNoteRecording(action);
   if(mode.equals("resume-call-queue")){NoteBridgePorts.audio.mode=AudioManager.MODE_IN_CALL;NoteBridgePorts.hold=false;NoteBridgePorts.flush();}
  }else{
   if(mode.equals("start-call-permission"))NoteBridgePorts.permission=PermissionState.PROMPT;
   else NoteBridgePorts.hold=true;
   action=new PluginCall(new JSObject().put("ownerDigest","a".repeat(64)).put("folderId","f-one"));plugin.startNoteRecording(action);
   if(mode.equals("start-paused-queue"))plugin.handleOnPause();else NoteBridgePorts.audio.mode=AudioManager.MODE_IN_CALL;
   if(mode.equals("start-call-permission")){
    NoteBridgePorts.permission=PermissionState.GRANTED;
    java.lang.reflect.Method callback=AlphaVoiceCloudPlugin.class.getDeclaredMethod("noteMicrophonePermission",PluginCall.class);callback.setAccessible(true);callback.invoke(plugin,action);
   }
   NoteBridgePorts.hold=false;NoteBridgePorts.flush();
  }
  System.out.println(new JSONObject().put("mode",mode).put("settled",action.settled).put("rejected",action.rejected==null?JSONObject.NULL:action.rejected)
   .put("foreground",Trace.read(plugin,"noteForeground")).put("closed",Trace.read(plugin,"closed"))
   .put("inCall",NoteBridgePorts.audio.mode!=AudioManager.MODE_NORMAL).put("state",AlphaNoteRecorder.get(NoteBridgePorts.context).status()));
 }
}
