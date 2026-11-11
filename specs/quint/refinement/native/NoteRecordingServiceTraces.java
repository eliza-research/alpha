package ai.alphacompute.alphaphone;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import java.io.File;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Real foreground service commands, paired with the actual recorder's current ID. */
public final class NoteRecordingServiceTraces {
 static final Map<String,Integer> identities=new HashMap<>();
 static AlphaNoteRecorder recorder;
 static AlphaNoteRecordingService service;
 static Context context;
 static Trace trace;
 static int startId;
 static int identity(String value){return value==null?0:identities.getOrDefault(value,0);}
 static JSONObject observe()throws Exception {
  Notification shown=NoteRecordingPorts.notifications.last;
  return Trace.fields("recording",identity(recorder.status().getString("recordingId")),"phase",recorder.status().getString("state"),
   "foreground",Trace.read(service,"foreground"),"owner",identity((String)Trace.read(service,"foregroundRecording")),
   "title",shown==null?"none":shown.title,"toggle",shown==null?"none":shown.toggle,
   "chronometer",shown!=null&&shown.chronometer,"stopRequested",service.stopped);
 }
 static String begin(int value)throws Exception {
  String id=recorder.start(String.valueOf((char)('a'+value)).repeat(64),"f-"+value).getString("recordingId");
  identities.put(id,value);trace.step("recordingStarts",observe(),value);return id;
 }
 static void command(String action,String id){
  NoteRecordingPorts.latestDeliveredStartId=++startId;
  service.onStartCommand(new Intent(context,AlphaNoteRecordingService.class).setAction(action)
   .putExtra(AlphaNoteRecordingService.EXTRA_RECORDING,id),0,startId);
 }
 static void notificationCommand(PendingIntent action){
  if(action==null)throw new AssertionError("Notification action was not built");
  NoteRecordingPorts.latestDeliveredStartId=++startId;
  service.onStartCommand(action.deliveryIntent(),0,startId);
 }
 static void start(String id,boolean accepted)throws Exception {
  NoteRecordingPorts.failForeground=!accepted;
  AlphaNoteRecordingService.start(context,id);
  NoteRecordingPorts.latestDeliveredStartId=++startId;
  service.onStartCommand(NoteRecordingPorts.commands.remove(0),0,startId);
  NoteRecordingPorts.failForeground=false;
  trace.step("startService",observe(),identity(id),accepted);
 }
 static void stop(String id)throws Exception {
  AlphaNoteRecordingService.recordingClosed(context,id);
  NoteRecordingPorts.latestDeliveredStartId=++startId;
  service.onStartCommand(NoteRecordingPorts.commands.remove(0),0,startId);trace.step("stopService",observe(),identity(id));
 }
 static void fallback(String id,boolean newerStart)throws Exception {
  NoteRecordingPorts.failServiceLaunch=true;NoteRecordingPorts.newerStartPending=newerStart;
  AlphaNoteRecordingService.recordingClosed(context,id);
  NoteRecordingPorts.failServiceLaunch=false;NoteRecordingPorts.newerStartPending=false;
  if(NoteRecordingPorts.stopServiceCalls!=0)throw new AssertionError("Fallback used unowned Context.stopService");
  trace.step("stopServiceWhen",observe(),identity(id),!newerStart);
 }
 static void close()throws Exception {recorder.discard();trace.step("recordingCloses",observe());}
 static void run(String directory,String mode)throws Exception {
  NoteRecordingPorts.root=new File(directory,mode);NoteRecordingPorts.root.mkdirs();
  context=new Context();recorder=AlphaNoteRecorder.get(context);service=new AlphaNoteRecordingService();
  trace=new Trace("recording-service-"+mode,observe());
  String first=begin(1);
  if(mode.equals("foreground-refused")){start(first,false);System.out.println(trace.value);return;}
  start(first,true);
  PendingIntent firstPause=PendingIntent.latestService(1),firstFinish=PendingIntent.latestService(3);
  if(mode.startsWith("same-id-")){
   recorder.stop(first);trace.step("recordingStops",observe());
   boolean queued=!mode.equals("same-id-stop");
   if(queued){NoteRecordingPorts.holdPosts=true;NoteRecordingPorts.failServiceLaunch=true;AlphaNoteRecordingService.recordingClosed(context,first);NoteRecordingPorts.failServiceLaunch=false;}
   recorder.resume(first);trace.step("recordingResumes",observe());start(first,true);
   if(mode.equals("same-id-stopped-fallback")){recorder.stop(first);trace.step("recordingStops",observe());}
   if(queued){NoteRecordingPorts.flushPosts();trace.step("stopServiceWhen",observe(),1,!mode.equals("same-id-stopped-fallback"));}
   else stop(first);
   if(!service.shown||!recorder.owns(first))throw new AssertionError("Late close stopped the same recording after resume");
  }else if(mode.equals("fallback-current")||mode.equals("fallback-pending")){
   recorder.stop(first);trace.step("recordingStops",observe());fallback(first,mode.equals("fallback-pending"));
  }else if(mode.equals("fallback-blank")){fallback("",false);if(!service.shown)throw new AssertionError("Blank fallback hid live recording");}
  else if(mode.equals("old-owner")||mode.equals("old-toggle")||mode.equals("old-start")||mode.equals("fallback-old-owner")){
   PendingIntent firstResume=null;
   if(mode.equals("old-toggle")){
    notificationCommand(firstPause);trace.step("toggle",observe(),1,true);
    firstResume=PendingIntent.latestService(2);
   }
   close();String second=begin(2);start(second,true);
   if(mode.equals("fallback-old-owner")){fallback(first,false);}
   else if(mode.equals("old-start")){start(first,true);}
   else if(mode.equals("old-toggle")){
    notificationCommand(firstPause);trace.step("toggle",observe(),1,true);
    command(AlphaNoteRecordingService.ACTION_PAUSE,second);trace.step("toggle",observe(),2,true);
    notificationCommand(firstResume);trace.step("toggle",observe(),1,false);
    if(!"paused".equals(recorder.status().getString("state")))throw new AssertionError("Retired notification resumed the successor recording");
   }else {stop(first);stop("");}
   if(!service.shown||!recorder.owns(second))throw new AssertionError("Retired command hid successor recording");
   recorder.stop(second);trace.step("recordingStops",observe());stop(second);
  }else if(mode.equals("blank-open")){
   stop("");if(!service.shown)throw new AssertionError("Blank command hid live recording");
  }else if(mode.equals("discard-blank")){close();stop("");}
  else if(mode.equals("discard-exact")){close();stop(first);}
  else if(mode.equals("current-stop")){recorder.stop(first);trace.step("recordingStops",observe());stop(first);}
  else if(mode.equals("recreated")){
   notificationCommand(firstPause);trace.step("toggle",observe(),1,true);
   PendingIntent retainedResume=PendingIntent.latestService(2);
   service.onDestroy();trace.step("destroy",observe());service=new AlphaNoteRecordingService();
   notificationCommand(retainedResume);trace.step("toggle",observe(),1,false);
   if(service.shown||!"paused".equals(recorder.status().getString("state")))throw new AssertionError("Retired notification restarted a service without foreground ownership");
   start(first,true);
   command(AlphaNoteRecordingService.ACTION_PAUSE,first);trace.step("toggle",observe(),1,true);
   command(AlphaNoteRecordingService.ACTION_RESUME,first);trace.step("toggle",observe(),1,false);
  }else if(mode.equals("notification-stop")||mode.equals("paused-notification-stop")){
   if(mode.startsWith("paused-")){command(AlphaNoteRecordingService.ACTION_PAUSE,first);trace.step("toggle",observe(),1,true);}
   PendingIntent retainedResume=PendingIntent.latestService(2);
   notificationCommand(PendingIntent.latestService(3));trace.step("finish",observe(),1);
   if(service.shown||!recorder.owns(first)||!"stopped".equals(recorder.status().getString("state")))throw new AssertionError("Notification Stop did not keep the stopped recording for Notes");
   if(mode.startsWith("paused-")){
    notificationCommand(retainedResume);trace.step("toggle",observe(),1,false);
    if(service.shown||!"stopped".equals(recorder.status().getString("state")))throw new AssertionError("Retired Resume rearmed the recording after Stop");
   }
  }else if(mode.equals("old-notification-stop")){
   close();String second=begin(2);start(second,true);
   notificationCommand(firstFinish);trace.step("finish",observe(),1);
   if(!service.shown||!recorder.owns(second)||!"recording".equals(recorder.status().getString("state")))throw new AssertionError("Retired notification Stop reached the successor recording");
  }else if(mode.equals("blank-notification-stop")){
   command(AlphaNoteRecordingService.ACTION_FINISH,"");trace.step("finish",observe(),0);
   if(!service.shown||!"recording".equals(recorder.status().getString("state")))throw new AssertionError("Blank notification Stop reached the live recording");
  }else if(mode.equals("pause-resume")){
   command(AlphaNoteRecordingService.ACTION_PAUSE,first);trace.step("toggle",observe(),1,true);
   NoteRecordingPorts.advance(5000);
   command(AlphaNoteRecordingService.ACTION_RESUME,first);trace.step("toggle",observe(),1,false);
  }
  System.out.println(trace.value);
 }
 public static void main(String[] args)throws Exception {
  if(!args[1].equals("campaign")){run(args[0],args[1]);return;}
  JSONArray traces=new JSONArray();
  for(int i=2;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),
     NoteRecordingServiceTraces.class.getName(),args[0],args[i]).redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String output=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new AssertionError("Service scenario failed: "+args[i]);traces.put(new JSONObject(output));
  }
  System.out.println(traces);
 }
}
