package ai.alphacompute.alphaphone;

import ai.eliza.voice.LocalSpeechBridgePlugin;
import ai.eliza.voice.SpeechAudioFocus;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import java.io.File;
import java.lang.reflect.Method;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Reproduces pending draft admission after the audio mode enters a phone call. */
public final class SharedRecordingProbe {
 public static final class Bridge extends LocalSpeechBridgePlugin {
  Bridge(){super("alpha-cloud-voice-","alpha-cloud-tts-");}
  public void close(){handleOnDestroy();}
 }
 public static void main(String[] args)throws Exception {
  NoteRecordingPorts.root=new File(args[0]);NoteRecordingPorts.root.mkdirs();Bridge bridge=new Bridge();bridge.load();
  PluginCall call=new PluginCall(new JSObject());NoteBridgePorts.hold=true;
  NoteBridgePorts.permission=PermissionState.PROMPT;bridge.startRecording(call);
  NoteBridgePorts.audio.mode=android.media.AudioManager.MODE_IN_CALL;
  Method callback=LocalSpeechBridgePlugin.class.getDeclaredMethod("microphonePermission",PluginCall.class);callback.setAccessible(true);
  NoteBridgePorts.permission=PermissionState.GRANTED;callback.invoke(bridge,call);
  NoteBridgePorts.hold=false;NoteBridgePorts.flush();
  System.out.println(new JSONObject().put("settled",call.settled).put("rejected",call.rejected==null?JSONObject.NULL:call.rejected)
   .put("starts",NoteBridgePorts.starts).put("closed",Trace.read(bridge,"destroyed")));
  bridge.close();((ExecutorService)Trace.read(bridge,"workers")).awaitTermination(5,TimeUnit.SECONDS);
 }
}
