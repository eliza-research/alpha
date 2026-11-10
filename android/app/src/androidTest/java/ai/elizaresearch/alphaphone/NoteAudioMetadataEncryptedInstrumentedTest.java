package ai.elizaresearch.alphaphone;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
/** Actual Capacitor describe -> legacy migration -> Keystore -> recreation. */
public final class NoteAudioMetadataEncryptedInstrumentedTest {
 private static String hash(String value)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 private JSONObject describe(String id)throws Exception{return NotesSecureFixture.call("Capacitor.Plugins.AlphaNoteAudio.describe({audioId:"+JSONObject.quote(id)+"})");}
 @Test public void legacyTranscriptMovesToEncryptedStoreWithoutLosingAudioOrTombstone()throws Exception{
  org.junit.Assume.assumeTrue("Disposable native privacy qualification","1".equals(InstrumentationRegistry.getArguments().getString("notesAudioEncryption")));
  String id="audio-privacy-"+UUID.randomUUID(),slot="note-audio-metadata:v1:"+id,secret="SYNTHETIC-PRIVATE-"+UUID.randomUUID();
  File base=InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),dir=new File(base,"note-audio");dir.mkdirs();
  File metadata=new File(dir,id+".json"),audio=new File(dir,id+".audio"),encrypted=new File(base,"connection-credentials/"+hash(slot));
  byte[] recording={1,2,3,4,5};
  JSONObject original=new JSONObject().put("audioId",id).put("noteId",id+"-note").put("durationMs",1234).put("transcript",secret).put("deletedAt",System.currentTimeMillis()).put("extra",new JSONObject().put("keep",42));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   Files.write(audio.toPath(),recording);Files.write(metadata.toPath(),original.toString().getBytes(StandardCharsets.UTF_8));
   JSONObject migrated=describe(id);assertEquals(original.toString(),migrated.toString());
   assertEquals(1,new JSONObject(new String(Files.readAllBytes(metadata.toPath()),StandardCharsets.UTF_8)).getInt("encrypted"));assertArrayEquals(recording,Files.readAllBytes(audio.toPath()));
   assertTrue(encrypted.isFile());assertFalse(new String(Files.readAllBytes(encrypted.toPath()),StandardCharsets.ISO_8859_1).contains(secret));
   scenario.recreate();AppNavigation.liveMode();assertEquals(original.toString(),describe(id).toString());
   // Crash after encrypted commit but before legacy cleanup: retry is readback-safe.
   Files.write(metadata.toPath(),original.toString().getBytes(StandardCharsets.UTF_8));assertEquals(original.toString(),describe(id).toString());assertEquals(1,new JSONObject(new String(Files.readAllBytes(metadata.toPath()),StandardCharsets.UTF_8)).getInt("encrypted"));
  }finally{new android.util.AtomicFile(metadata).delete();new android.util.AtomicFile(encrypted).delete();audio.delete();}
 }
}
