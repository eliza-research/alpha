package ai.elizaresearch.alphaphone;

import ai.eliza.voice.LocalSpeechBridgePlugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import java.io.File;
import java.lang.reflect.Method;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/** Real shared parent/controller/capture with controlled physical AudioRecord and inference. */
public final class LiveCaptureProbe {
 public static final class Bridge extends LocalSpeechBridgePlugin {
  Bridge(){super("alpha-cloud-voice-","alpha-cloud-tts-");}
  public void close(){handleOnDestroy();}
 }
 public static void main(String[] args)throws Exception {
  NoteRecordingPorts.root=new File(args[0]);NoteRecordingPorts.root.mkdirs();Bridge bridge=new Bridge();bridge.load();
  String mode=args.length>1?args[1]:"permission";
  PluginCall call=new PluginCall(new JSObject().put("captureId","00000000-0000-0000-0000-000000000001"));
  Object controller=Trace.read(bridge,"live");
  if(mode.equals("permission"))NoteBridgePorts.permission=PermissionState.PROMPT;else LiveCapturePorts.holdOpen=true;
  bridge.startLiveCapture(call);
  if(mode.equals("opening")&&!LiveCapturePorts.opening.await(5,TimeUnit.SECONDS))throw new AssertionError("No opening");
  NoteBridgePorts.audio.mode=android.media.AudioManager.MODE_IN_CALL;
  Method phone=LocalSpeechBridgePlugin.class.getDeclaredMethod("callStarted");phone.setAccessible(true);phone.invoke(bridge);
  if(mode.equals("permission")){
   NoteBridgePorts.permission=PermissionState.GRANTED;
   Method callback=LocalSpeechBridgePlugin.class.getDeclaredMethod("liveMicrophonePermission",PluginCall.class);callback.setAccessible(true);callback.invoke(bridge,call);
  }else LiveCapturePorts.allowOpen.countDown();
  ((ExecutorService)Trace.read(controller,"worker")).submit(()->{}).get(5,TimeUnit.SECONDS);
  System.out.println(new JSONObject().put("mode",mode).put("settled",call.settled).put("rejected",call.rejected==null?JSONObject.NULL:call.rejected)
   .put("startsDuringCall",LiveCapturePorts.startsDuringCall).put("current",Trace.read(controller,"current")!=null).put("released",LiveCapturePorts.records.stream().allMatch(record->record.released)).put("physicalRecording",LiveCapturePorts.records.stream().anyMatch(record->record.recording)));
  bridge.close();
  for(String name:new String[]{"worker","stopWorker","pipeWorker"})((ExecutorService)Trace.read(controller,name)).awaitTermination(5,TimeUnit.SECONDS);
  ((ExecutorService)Trace.read(bridge,"workers")).awaitTermination(5,TimeUnit.SECONDS);
 }
}
