package ai.alphacompute.alphaphone;

import android.content.Context;
import android.media.MediaRecorder;
import com.getcapacitor.JSObject;
import java.io.File;
import java.lang.reflect.Constructor;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Exact public recorder state and journal bytes at native operation boundaries. */
public final class NoteRecordingTraces {
 static AlphaNoteRecorder recorder;
 static Context context;
 static Trace trace;
 static final Map<String,Integer> ids=new HashMap<>();
 static JSONObject map(JSONArray entries){return new JSONObject().put("quintCollection","map").put("entries",entries);}
 static JSONObject observe()throws Exception {
  JSObject status=recorder.status();String id=status.getString("recordingId");
  JSONObject binding=status.optJSONObject("binding");
  MediaRecorder capture=(MediaRecorder)Trace.read(recorder,"recorder");
  File directory=(File)Trace.read(recorder,"dir");
  JSONArray durations=new JSONArray(),texts=new JSONArray(),diskDurations=new JSONArray(),diskTexts=new JSONArray();
  JSONArray segments=status.optJSONArray("segments");
  if(segments!=null)for(int i=0;i<segments.length();i++){JSONObject item=segments.getJSONObject(i);durations.put(item.getLong("durationMs"));if(item.has("text"))texts.put(new JSONArray().put(i).put(item.getString("text").equals("words")?1:2));}
  File journal=directory==null?null:new File(directory,"segments.json");
  boolean journalValid=true,missingSegment=false;
  if(journal!=null&&journal.isFile())try{
   JSONArray saved=new JSONObject(Files.readString(journal.toPath())).getJSONArray("segments");
   for(int i=0;i<saved.length();i++){JSONObject item=saved.getJSONObject(i);diskDurations.put(item.getLong("d"));if(item.has("t"))diskTexts.put(new JSONArray().put(i).put(item.getString("t").equals("words")?1:2));if(!new File(directory,String.format(java.util.Locale.ROOT,"%05d.m4a",i)).isFile())missingSegment=true;}
  }catch(org.json.JSONException malformed){journalValid=false;}
  int index=((Number)Trace.read(recorder,"index")).intValue();
  File current=directory==null?null:new File(directory,String.format(java.util.Locale.ROOT,"%05d.m4a",index));
  JSONObject observation=Trace.fields("phase",status.getString("state"),"id",id==null?0:ids.get(id),
   "owner",binding==null?0:binding.optString("ownerDigest").startsWith("a")?1:2,
   "folder",binding==null||binding.isNull("folderId")?0:binding.getString("folderId").equals("f-one")?1:2,
   "capture",capture==null?0:capture.sequence,"issued",NoteRecordingPorts.recorders.size(),
   "now",NoteRecordingPorts.now,"startedAt",Trace.read(recorder,"segmentStarted"),"pausedAt",Trace.read(recorder,"pausedAt"),"pausedTotal",Trace.read(recorder,"pausedTotal"),
   "durations",durations,"texts",map(texts),"diskDurations",diskDurations,"diskTexts",map(diskTexts),
   "disk",journal!=null&&journal.isFile(),"journalValid",journalValid,"missingSegment",missingSegment,"currentFile",current!=null&&current.isFile(),
   "nextFile",capture!=null&&Trace.read(capture,"next")!=null,"timer",NoteRecordingPorts.timers.containsKey(Trace.read(recorder,"rollover")),
   "recovered",status.optBoolean("recovered"),"reason",status.optString("stopReason","none"),
   "joined",directory!=null&&new File(directory,"joined.m4a").isFile(),
   "recoveryBlocked",Trace.read(recorder,"recoveryUnavailable"));
  observation.put("cursor",index);observation.put("durationMs",status.optLong("durationMs",0));return observation;
 }
 static String start(int identity,boolean journal,boolean opens)throws Exception {
  NoteRecordingPorts.failJournal=!journal;NoteRecordingPorts.failOpen=!opens;
  String id=null;
  try{id=recorder.start(identity==1?"a".repeat(64):"b".repeat(64),identity==1?"f-one":"f-two").getString("recordingId");ids.put(id,identity);}
  catch(java.io.IOException expected){if(journal&&opens)throw expected;}
  trace.step("start",observe(),identity,identity,identity,journal,opens);return id;
 }
 static void advance(int delta)throws Exception {NoteRecordingPorts.advance(delta);trace.step("advance",observe(),delta);}
 static void stop(String id,boolean keep,boolean journal)throws Exception {
  NoteRecordingPorts.failStop=!keep;NoteRecordingPorts.failJournal=!journal;
  recorder.stop(id);trace.step("stop",observe(),ids.get(id),keep,journal);
 }
 static void rollover(boolean journal)throws Exception {NoteRecordingPorts.failJournal=!journal;NoteRecordingPorts.runTimers();trace.step("rollover",observe(),true,journal,true);}
 static void restart()throws Exception {restart("restart");}
 static void restart(String action)throws Exception {
  NoteRecordingPorts.timers.clear();
  for(MediaRecorder capture:NoteRecordingPorts.recorders)capture.release();
  Constructor<AlphaNoteRecorder> constructor=AlphaNoteRecorder.class.getDeclaredConstructor(Context.class);constructor.setAccessible(true);recorder=constructor.newInstance(context);
  trace.step(action,observe());
  if((boolean)Trace.read(recorder,"recoveryUnavailable")){
   boolean refused=false;try{recorder.start("b".repeat(64),"f-two");}catch(java.io.IOException expected){refused="recovery".equals(expected.getMessage());}
   if(!refused)throw new AssertionError("Unknown retained audio admitted a replacement capture");
   trace.value.getJSONArray("steps").put(new JSONObject().put("label","retained audio refuses replacement").put("action",Trace.action("start",2,2,2,true,true).put("reject",true)).put("expect",observe()));
  }
 }
 static void text(String id,boolean journal)throws Exception {text(id,1,journal);}
 static void text(String id,int value,boolean journal)throws Exception {
  NoteRecordingPorts.failJournal=!journal;
  try{recorder.setText(id,id+"-s0",value==1?"words":"edited");}catch(java.io.IOException expected){if(journal)throw expected;}
  trace.step("setText",observe(),ids.get(id),0,value,journal);
 }
 static void join(String id,boolean success)throws Exception {
  NoteRecordingPorts.failJoin=!success;
  try{recorder.joined(id);}catch(java.io.IOException expected){if(success)throw expected;}
  trace.step("join",observe(),ids.get(id),success);
 }
 static void run(String path,String mode)throws Exception {
  NoteRecordingPorts.root=new File(path,mode);NoteRecordingPorts.root.mkdirs();context=new Context();recorder=AlphaNoteRecorder.get(context);
  trace=new Trace("native-recording-"+mode,observe());
  String id=start(1,!mode.equals("start-journal-failure"),!mode.equals("start-open-failure"));
  if(id==null){System.out.println(trace.value);return;}
  if(mode.equals("pause")){
   advance(5000);recorder.pause(id);trace.step("pause",observe(),1);advance(5000);
   recorder.resume(id);trace.step("resume",observe(),1,true);advance(1000);stop(id,true,true);
  }else if(mode.equals("stale-callback")){
   MediaRecorder old=(MediaRecorder)Trace.read(recorder,"recorder");recorder.discard();trace.step("discard",observe());start(2,true,true);
   old.fail();trace.step("captureError",observe(),1);old.emit(MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING);trace.step("prepareNext",observe(),1);
  }else if(mode.startsWith("next-")){
   MediaRecorder capture=(MediaRecorder)Trace.read(recorder,"recorder");advance(5000);
   capture.emit(MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING);trace.step("prepareNext",observe(),1);advance(1000);
   boolean journal=!mode.equals("next-journal-failure");NoteRecordingPorts.failJournal=!journal;
   capture.emit(MediaRecorder.MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED);trace.step("nextStarted",observe(),1,journal);
  }else if(mode.equals("short-stop")){advance(1000);stop(id,false,true);restart();}
  else if(mode.equals("capture-error")){((MediaRecorder)Trace.read(recorder,"recorder")).fail();trace.step("captureError",observe(),1);}
  else if(mode.equals("wrong-id")){
   boolean rejected=false;try{recorder.pause("foreign");}catch(IllegalStateException expected){rejected=true;}
   if(!rejected)throw new AssertionError("Foreign recording admitted");
   trace.value.getJSONArray("steps").put(new JSONObject().put("label","foreign ID refused").put("action",Trace.action("pause",2).put("reject",true)).put("expect",observe()));
  }else {
   advance(27000);rollover(!mode.equals("rollover-journal-failure"));
   if(mode.equals("rollover-journal-failure")){restart();}
   else if(mode.equals("resume-recovered")){text(id,true);restart();recorder.resume(id);trace.step("resume",observe(),1,true);advance(1000);stop(id,true,true);join(id,true);}
   else {
    stop(id,true,true);
    File directory=(File)Trace.read(recorder,"dir"),journal=new File(directory,"segments.json");
    if(mode.equals("text-edit-failure")){text(id,true);text(id,2,false);restart();}
    else if(mode.equals("corrupt-journal")){
     Files.writeString(journal.toPath(),"not-json");trace.step("corruptJournal",observe());restart();
    }else if(mode.equals("missing-segment")){
     Files.delete(new File(directory,"00000.m4a").toPath());trace.step("loseSegment",observe());restart();
    }else if(mode.equals("legacy-binding")){
     JSONObject data=new JSONObject(Files.readString(journal.toPath()));data.remove("ownerDigest");data.remove("folderId");
     Files.writeString(journal.toPath(),data.toString());restart("legacyRestart");
    }else {
     text(id,!mode.equals("text-journal-failure"));
     if(mode.equals("text-journal-failure"))restart();else join(id,!mode.equals("join-failure"));
    }
   }
  }
  System.out.println(trace.value);
 }
 public static void main(String[] args)throws Exception {
  if(!args[1].equals("campaign")){run(args[0],args[1]);return;}
  JSONArray traces=new JSONArray();
  for(int i=2;i<args.length;i++){
   Process process=new ProcessBuilder(System.getProperty("java.home")+"/bin/java","-cp",System.getProperty("java.class.path"),NoteRecordingTraces.class.getName(),args[0],args[i])
    .redirectError(ProcessBuilder.Redirect.INHERIT).start();
   String output=new String(process.getInputStream().readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
   if(process.waitFor()!=0)throw new AssertionError("Recorder scenario failed: "+args[i]);traces.put(new JSONObject(output));
  }
  System.out.println(traces);
 }
}
