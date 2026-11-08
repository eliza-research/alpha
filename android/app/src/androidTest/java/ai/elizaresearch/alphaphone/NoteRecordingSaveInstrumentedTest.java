package ai.elizaresearch.alphaphone;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Saving a Notes recording (design/view-refresh-2026-11 PLAN.md section 3): a transcript longer
 * than the metadata bound (hours of speech) never stops the audio from being saved, and a retried
 * save into the same note (the note id is the recording id) succeeds.
 */
@RunWith(AndroidJUnit4.class)
public class NoteRecordingSaveInstrumentedTest {
 private static byte[] wav(){int n=16000;ByteBuffer b=ByteBuffer.allocate(44+n*2).order(ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+n*2).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(n*2);return b.array();}
 private static AlphaNoteAudioPlugin plugin(){for(android.app.Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED))if(activity instanceof MainActivity)return (AlphaNoteAudioPlugin)((MainActivity)activity).getBridge().getPlugin("AlphaNoteAudio").getInstance();throw new IllegalStateException();}

 @Test public void transcriptPrefixIsBoundedAndKeepsSurrogatePairs(){
  assertEquals("short",AlphaNoteAudioPlugin.transcriptPrefix("short",10));
  assertEquals("ab",AlphaNoteAudioPlugin.transcriptPrefix("abc",2));
  assertEquals("a pair is never split","a",AlphaNoteAudioPlugin.transcriptPrefix("a\uD83D\uDE00",2));
 }

 @Test public void aFourHourTranscriptStillSavesTheAudioAndDoneCanBeRetried()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  String recordingId=UUID.randomUUID().toString();
  StringBuilder words=new StringBuilder();while(words.length()<200_000)words.append("a long lecture goes on ");
  String transcript=words.toString();
  File first=File.createTempFile("note-recording-",".wav",context.getCacheDir()),again=File.createTempFile("note-recording-",".wav",context.getCacheDir());
  try(FileOutputStream out=new FileOutputStream(first)){out.write(wav());}
  try(FileOutputStream out=new FileOutputStream(again)){out.write(wav());}
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AtomicReference<JSONObject> saved=new AtomicReference<>(),retried=new AtomicReference<>();
   BoundedActivityScenario.main(()->{try{saved.set(plugin().retainNoteRecording(first,recordingId,recordingId,3_600_000L*4,transcript));}catch(Exception e){throw new RuntimeException(e);}});
   assertEquals(recordingId,saved.get().getString("audioId"));
   assertEquals(AlphaNoteAudioPlugin.NOTE_RECORDINGS.maxTranscript,saved.get().getString("transcript").length());
   // Done again (after a lost note save or a restart) saves into the same note.
   BoundedActivityScenario.main(()->{try{retried.set(plugin().retainNoteRecording(again,recordingId,recordingId,3_600_000L*4,transcript));}catch(Exception e){throw new RuntimeException(e);}});
   assertEquals(recordingId,retried.get().getString("audioId"));
  }finally{first.delete();again.delete();for(String suffix:new String[]{".audio",".json",".json.bak",".pending"})new File(context.getNoBackupFilesDir(),"note-audio/"+recordingId+suffix).delete();}
 }
}
