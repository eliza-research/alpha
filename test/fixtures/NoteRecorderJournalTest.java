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
   check(recovered.claimCanonicalSave(id),"the stopped recording reserves its canonical save");
   AlphaNoteRecorder pending=restart(context);
   check(pending.status().getBoolean("canonicalSavePending"),"an uncertain save stays reserved after restart");
   try{pending.resume(id);throw new AssertionError("an uncertain save resumed");}catch(java.io.IOException expected){}
   pending.discard();check(root.listFiles().length==0,"discard removes this recording's files");
   // Unreadable recordings and unrelated directories retain their bytes for explicit recovery.
   AlphaNoteRecorder fresh=restart(context);String broken=fresh.start(OWNER,"").getString("recordingId");
   SystemClock.now+=20_000;MediaRecorder.last.rollToNext();
   Files.write(new File(root,broken+"/segments.json").toPath(),"{\"segments\":[".getBytes());
   new File(root,"not-a-recording").mkdirs();
   check(restart(context).status().optString("recordingId","").isEmpty(),"nothing is recovered from a torn journal");
   check(new File(root,broken+"/segments.json").isFile(),"the unreadable journal is retained");
   check(new File(root,broken+"/00000.m4a").isFile(),"finished audio is retained");
   check(new File(root,"not-a-recording").isDirectory(),"an unrelated directory is retained");
   try{restart(context).start(OWNER,"");throw new AssertionError("uncertain audio allowed a new recording");}catch(java.io.IOException expected){check("recovery".equals(expected.getMessage()),"recovery refusal");}
   File gapHome=new File(home,"gap-home");check(gapHome.mkdir(),"gap test directory");
   Context gapContext=new Context(gapHome);File gapRoot=new File(gapHome,"note-recording");
   AlphaNoteRecorder third=restart(gapContext);String gap=third.start(OWNER,"").getString("recordingId");
   SystemClock.now+=20_000;MediaRecorder.last.rollToNext();
   check(new File(gapRoot,gap+"/00000.m4a").delete(),"remove one journaled segment");
   AlphaNoteRecorder missing=restart(gapContext);
   check(missing.status().optString("recordingId","").isEmpty(),"a missing segment is not presented as a complete recording");
   check(new File(gapRoot,gap+"/segments.json").isFile()&&new File(gapRoot,gap+"/00001.m4a").isFile(),"remaining journal and audio survive an uncertain recovery");
   try{missing.start(OWNER,"");throw new AssertionError("missing audio allowed a new recording");}catch(java.io.IOException expected){check("recovery".equals(expected.getMessage()),"missing-segment refusal");}
   System.out.println("PASS note recorder journal");
  }finally{deleteTree(home);}
 }
 private static void deleteTree(File file){File[] kids=file.listFiles();if(kids!=null)for(File kid:kids)deleteTree(kid);file.delete();}
}
