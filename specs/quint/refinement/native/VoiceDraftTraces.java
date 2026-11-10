package ai.alphacompute.alphaphone;

import ai.eliza.voice.LocalVoiceRecording;
import android.content.Context;
import android.media.MediaRecorder;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Executes the shared draft recorder with primitive Android media and clock ports. */
public final class VoiceDraftTraces {
 static LocalVoiceRecording draft;
 static Context context;
 static Trace trace;
 static final Map<String,Integer> ids=new HashMap<>();
 static final JSONArray events=new JSONArray();
 static String selected="none";
 static boolean externalConfigured,externalReady,throwEvent;
 static File external;
 static int identity(String value){return value==null?0:ids.getOrDefault(value,0);}
 static LocalVoiceRecording fresh(){return new LocalVoiceRecording(context,"alpha-draft-",event->{events.put(event);if(throwEvent){throwEvent=false;throw new IllegalStateException("event receiver unavailable");}});}
 static JSONObject observe()throws Exception {
  File file=(File)Trace.read(draft,"file");MediaRecorder capture=(MediaRecorder)Trace.read(draft,"recorder");
  long bytes=file!=null&&file.isFile()?file.length():0;
  JSONObject last=events.isEmpty()?null:events.getJSONObject(events.length()-1);
  MediaRecorder latest=NoteRecordingPorts.recorders.isEmpty()?null:NoteRecordingPorts.recorders.get(NoteRecordingPorts.recorders.size()-1);
  return Trace.fields("id",identity((String)Trace.read(draft,"id")),"capture",capture==null?0:capture.sequence,
   "issued",NoteRecordingPorts.recorders.size(),"file",file!=null,"size",bytes==0?0:bytes>LocalVoiceRecording.MAX_BYTES?2:1,
   "now",NoteRecordingPorts.now,"startedAt",Trace.read(draft,"startedAt"),"duration",draft.durationMs(),
   "timer",NoteRecordingPorts.timers.containsKey(Trace.read(draft,"deadline")),"limit",latest==null?0:latest.maxDuration,
   "interrupted",Trace.read(draft,"interrupted"),
   "event",last==null?"none":last.optString("interrupted",last.getString("status")),"eventId",last==null?0:identity(last.optString("recordingId",null)),"events",events.length(),
   "selected",selected,"externalConfigured",externalConfigured,"externalReady",externalReady);
 }
 static String start(int value,int limit,boolean success)throws Exception {
  NoteRecordingPorts.failOpen=!success;String id=null;
  try{id=draft.start(limit).getString("recordingId");ids.put(id,value);}catch(java.io.IOException expected){if(success)throw expected;}
  selected="none";trace.step("start",observe(),value,limit,success);return id;
 }
 static void advance(int delta)throws Exception {NoteRecordingPorts.advance(delta);trace.step("advance",observe(),delta);}
 static void stop(boolean success)throws Exception {
  NoteRecordingPorts.failStop=!success;
  try{draft.stop();}catch(IllegalStateException expected){}
  trace.step("stop",observe(),success);
 }
 static void choose(String id,int value)throws Exception {File result=draft.selected(id);selected=result==null?"none":result.equals(external)?"external":"draft";trace.step("selectDraft",observe(),value);}
 static void run(String path,String mode)throws Exception {
  NoteRecordingPorts.root=new File(path,mode);NoteRecordingPorts.root.mkdirs();context=new Context();
  File stale=new File(context.getCacheDir(),"alpha-draft-stale.m4a"),foreign=new File(context.getCacheDir(),"foreign-stale.m4a");
  Files.write(stale.toPath(),new byte[]{1});Files.write(foreign.toPath(),new byte[]{1});
  draft=fresh();if(stale.exists()||!foreign.exists())throw new AssertionError("Constructor cache scope");
  trace=new Trace("voice-draft-"+mode,observe());
  if(mode.equals("constructor-failure")){
   NoteRecordingPorts.failConstructor=true;
   boolean failed=false;try{draft.start(29000);}catch(IllegalStateException expected){failed=true;}
   if(!failed)throw new AssertionError("Constructor failure was not injected");
   String left=(String)Trace.read(draft,"id");if(left!=null)ids.put(left,1);
   trace.step("constructorFailed",observe());
   String retry=start(1,29000,true);advance(1000);stop(true);choose(retry,1);
   System.out.println(trace.value);return;
  }
  if(mode.equals("invalid-limit")){
   boolean failed=false;try{draft.start(1234);}catch(IllegalArgumentException expected){failed=true;}
   if(!failed)throw new AssertionError("Invalid duration admitted");
   trace.value.getJSONArray("steps").put(new JSONObject().put("label","invalid capture duration refused")
    .put("action",Trace.action("start",1,1234,true).put("reject",true)).put("expect",observe()));
   System.out.println(trace.value);return;
  }
  String id=start(1,mode.equals("long")?59000:29000,!mode.equals("open-failure"));
  if(id==null){System.out.println(trace.value);return;}
  MediaRecorder capture=(MediaRecorder)Trace.read(draft,"recorder");
  if(mode.startsWith("interrupt-")){
   File file=(File)Trace.read(draft,"file");Runnable deadline=(Runnable)Trace.read(draft,"deadline");
   boolean released=!mode.equals("interrupt-release-failure");NoteRecordingPorts.failRelease=!released;
   draft.interrupt("call-active");trace.step("interrupt",observe(),released);
   JSONObject terminal=events.getJSONObject(0);
   if(!"failed".equals(terminal.getString("status"))||terminal.has("durationMs")||!id.equals(terminal.getString("recordingId"))||file.exists()==released)
    throw new AssertionError("Call cleanup or terminal event did not match the exact owned draft");
   draft.interrupt("call-active");trace.step("interrupt",observe(),true);
   deadline.run();trace.step("deadline",observe(),1);
   capture.fail();trace.step("microphoneError",observe(),1);
   capture.emit(MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED);trace.step("automatic",observe(),1,true,true);
   choose(id,1);
   if(!released){
    boolean refused=false;try{draft.metrics(id);}catch(IllegalStateException expected){refused=true;}
    if(!refused)throw new AssertionError("Interrupted recorder still reports microphone metrics");
    trace.value.getJSONArray("steps").put(new JSONObject().put("label","interrupted metrics refused")
     .put("action",Trace.action("metrics",1).put("reject",true)).put("expect",observe()));
    draft.cancel();trace.step("cancel",observe());if(file.exists())throw new AssertionError("Retry did not delete the interrupted draft");
   }
   start(2,29000,true);
  }else if(mode.equals("cancel")){draft.cancel();trace.step("cancel",observe());}
  else if(mode.equals("discard-wrong")){draft.discard("foreign");trace.step("discard",observe(),2);draft.discard(id);trace.step("discard",observe(),1);}
  else if(mode.equals("mic-error")){capture.fail();trace.step("microphoneError",observe(),1);}
  else if(mode.equals("deadline")){advance(29000);NoteRecordingPorts.runTimers();trace.step("deadline",observe(),1);}
  else if(mode.equals("auto-stop-failure")){NoteRecordingPorts.failStop=true;capture.emit(MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED);trace.step("automatic",observe(),1,false,true);}
  else if(mode.equals("limit-info")){capture.emit(MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED);trace.step("automatic",observe(),1,true,true);}
  else if(mode.equals("consumer-failure")){throwEvent=true;capture.emit(MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED);trace.step("automatic",observe(),1,true,false);capture.fail();trace.step("microphoneError",observe(),1);((Runnable)Trace.read(draft,"deadline")).run();trace.step("deadline",observe(),1);}
  else if(mode.equals("stale-callback")){
   Runnable oldDeadline=(Runnable)Trace.read(draft,"deadline");draft.cancel();trace.step("cancel",observe());start(2,29000,true);
   capture.fail();trace.step("microphoneError",observe(),1);oldDeadline.run();trace.step("deadline",observe(),1);
  }else if(mode.equals("metrics")){
   draft.metrics(id);trace.step("metrics",observe(),1);
   boolean failed=false;try{draft.metrics("foreign");}catch(IllegalStateException expected){failed=true;}
   if(!failed)throw new AssertionError("Foreign metric admitted");
   trace.value.getJSONArray("steps").put(new JSONObject().put("label","foreign metrics refused").put("action",Trace.action("metrics",2).put("reject",true)).put("expect",observe()));
  }else if(mode.equals("external")){
   external=new File(context.getCacheDir(),"finished-note.m4a");Files.write(external.toPath(),new byte[]{1});externalConfigured=true;externalReady=true;
   draft.selectAlso(value->value.equals("external")?external:null);trace.step("configureExternal",observe(),true);choose("external",3);
   stop(true);choose(id,1);
  }else if(mode.equals("recreate")){
   advance(1000);stop(true);draft=fresh();selected="none";externalConfigured=false;externalReady=false;trace.step("recreate",observe());
  }else {
   if(mode.equals("empty")||mode.equals("oversized")||mode.equals("max-bytes")){
    File file=(File)Trace.read(draft,"file");try(RandomAccessFile data=new RandomAccessFile(file,"rw")){data.setLength(mode.equals("empty")?0:mode.equals("max-bytes")?LocalVoiceRecording.MAX_BYTES:LocalVoiceRecording.MAX_BYTES+1);}
    trace.step("fileSize",observe(),mode.equals("empty")?0:mode.equals("max-bytes")?1:2);
   }
   advance(1000);stop(!mode.equals("stop-failure"));choose(id,1);
  }
  System.out.println(trace.value);
 }
 public static void main(String[] args)throws Exception {
  if(!args[1].equals("campaign")){run(args[0],args[1]);return;}
  JSONArray traces=new JSONArray();
  for(int i=2;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),VoiceDraftTraces.class.getName(),args[0],args[i])
    .redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String output=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new AssertionError("Voice draft scenario failed: "+args[i]);traces.put(new JSONObject(output));
  }
  System.out.println(traces);
 }
}
