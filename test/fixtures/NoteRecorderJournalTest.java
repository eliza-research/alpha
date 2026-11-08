package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.media.MediaRecorder;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import java.io.File;
import java.nio.file.Files;
import org.json.JSONArray;

/** Host-JVM check of AlphaNoteRecorder's journal and process-death recovery over stub Android
 * classes (test/fixtures/note-recorder-jvm). Not Android, MediaRecorder or foreground-service evidence. */
public final class NoteRecorderJournalTest {
 private static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 private static final String OWNER="ab".repeat(32);
 /** A new process: the process-wide recorder is created again and recovers from disk. */
 private static AlphaNoteRecorder restart(Context context)throws Exception{
  java.lang.reflect.Field field=AlphaNoteRecorder.class.getDeclaredField("instance");field.setAccessible(true);field.set(null,null);
  return AlphaNoteRecorder.get(context);
 }
 public static void main(String[] args)throws Exception{
  File home=Files.createTempDirectory("note-recorder").toFile();Context context=new Context(home);File root=new File(home,"note-recording");
  try{
   AlphaNoteRecorder recorder=restart(context);
   JSObject started=recorder.start(OWNER,"f-work");String id=started.getString("recordingId");
   SystemClock.now+=20_000;MediaRecorder.last.rollToNext();
   SystemClock.now+=21_000;MediaRecorder.last.rollToNext();
   recorder.setText(id,id+"-s0","first words");
   check(new File(root,id+"/00002.m4a").isFile(),"the segment being written is on disk");
   // The process dies while segment 2 is being written.
   AlphaNoteRecorder recovered=restart(context);
   JSObject status=recovered.status();
   check(id.equals(status.getString("recordingId")),"the recording comes back");
   check("paused".equals(status.getString("state"))&&status.getBoolean("recovered"),"recovered paused");
   JSONArray segments=status.getJSONArray("segments");
   check(segments.length()==2,"both finished segments are kept: "+segments);
   check(segments.getJSONObject(0).getLong("durationMs")==20_000&&segments.getJSONObject(1).getLong("durationMs")==21_000,"with their durations");
   check("first words".equals(segments.getJSONObject(0).getString("text"))&&!segments.getJSONObject(1).has("text"),"and the transcript journaled with them");
   check(!new File(root,id+"/00002.m4a").exists(),"the unreadable partial segment is dropped");
   check(OWNER.equals(status.getJSONObject("binding").getString("ownerDigest"))&&"f-work".equals(status.getJSONObject("binding").getString("folderId")),"the owner and folder binding survive");
   check(recovered.segment(id+"-s1")!=null&&recovered.segment(id+"-s2")==null,"only finished segments are readable");
   // Resume continues in a new segment after the recovered ones.
   recovered.resume(id);SystemClock.now+=5_000;recovered.stop(id);
   check(recovered.status().getJSONArray("segments").length()==3,"resume continues with a third segment");
   recovered.discard();check(root.listFiles().length==0,"discard removes every file");
   // A session whose journal is unreadable, or that lacks a journaled segment, is removed; so is a stray folder.
   AlphaNoteRecorder fresh=restart(context);String broken=fresh.start(OWNER,"").getString("recordingId");
   SystemClock.now+=20_000;MediaRecorder.last.rollToNext();
   Files.write(new File(root,broken+"/segments.json").toPath(),"{\"segments\":[".getBytes());
   new File(root,"not-a-recording").mkdirs();
   check(restart(context).status().optString("recordingId","").isEmpty(),"nothing is recovered from a torn journal");
   check(root.listFiles().length==0,"the torn session and the stray folder are deleted");
   AlphaNoteRecorder third=restart(context);String gap=third.start(OWNER,"").getString("recordingId");
   SystemClock.now+=20_000;MediaRecorder.last.rollToNext();
   new File(root,gap+"/00000.m4a").delete();
   check(restart(context).status().optString("recordingId","").isEmpty()&&root.listFiles().length==0,"a journaled segment missing on disk drops the session");
   System.out.println("PASS note recorder journal");
  }finally{deleteTree(home);}
 }
 private static void deleteTree(File file){File[] kids=file.listFiles();if(kids!=null)for(File kid:kids)deleteTree(kid);file.delete();}
}
