package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.Context;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaPlayer;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.io.File;
import java.lang.reflect.Constructor;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * The native Notes recorder on a device (design/view-refresh-2026-11 PLAN.md section 3; spec
 * notes-view CrashKeepsAudio, NoLengthLimit). Records real microphone audio across more than two
 * segments with a pause, then recovers a copy of the recording in a new recorder (as a new process
 * would after a crash), drops the partial segment, keeps journaled text, and joins the segments
 * into one playable file whose length matches the journal. Takes about a minute and a half.
 */
@RunWith(AndroidJUnit4.class)
public class NoteRecorderInstrumentedTest {
 private static Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private static <T> T main(java.util.concurrent.Callable<T> work){
  AtomicReference<T> out=new AtomicReference<>();AtomicReference<Exception> failed=new AtomicReference<>();
  InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{try{out.set(work.call());}catch(Exception e){failed.set(e);}});
  if(failed.get()!=null)throw new AssertionError(failed.get());return out.get();
 }
 /** A recorder as a new process would build it: it recovers what is on disk. */
 private static AlphaNoteRecorder fresh()throws Exception{Constructor<AlphaNoteRecorder> c=AlphaNoteRecorder.class.getDeclaredConstructor(Context.class);c.setAccessible(true);return c.newInstance(context().getApplicationContext());}
 private static int segments(JSObject status)throws Exception{return status.getJSONArray("segments").length();}
 private static void copyTree(File from,File to)throws Exception{if(from.isDirectory()){assertTrue(to.mkdirs());for(File kid:from.listFiles())copyTree(kid,new File(to,kid.getName()));}else Files.copy(from.toPath(),to.toPath());}
 private static long mediaMs(File file)throws Exception{MediaExtractor e=new MediaExtractor();try{e.setDataSource(file.getAbsolutePath());for(int t=0;t<e.getTrackCount();t++){MediaFormat f=e.getTrackFormat(t);if(f.getString(MediaFormat.KEY_MIME).startsWith("audio/"))return f.getLong(MediaFormat.KEY_DURATION)/1000;}return -1;}finally{e.release();}}

 @Test public void theNotificationShowsPausedWithResumeAndTheRecordingLength()throws Exception{
  JSObject paused=new JSObject();paused.put("state","paused");paused.put("recordingId",UUID.randomUUID().toString());paused.put("durationMs",90_000);
  android.app.Notification p=AlphaNoteRecordingService.notification(context(),paused);
  assertEquals("Paused",p.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString());
  assertEquals("Resume",p.actions[0].title.toString());
  assertFalse("no running chronometer while paused",p.extras.getBoolean(android.app.Notification.EXTRA_SHOW_CHRONOMETER));
  JSObject recording=new JSObject();recording.put("state","recording");recording.put("recordingId",paused.getString("recordingId"));recording.put("durationMs",90_000);
  long now=System.currentTimeMillis();android.app.Notification r=AlphaNoteRecordingService.notification(context(),recording);
  assertEquals("Recording",r.extras.getCharSequence(android.app.Notification.EXTRA_TITLE).toString());
  assertEquals("Pause",r.actions[0].title.toString());
  assertTrue(r.extras.getBoolean(android.app.Notification.EXTRA_SHOW_CHRONOMETER));
  assertEquals("the chronometer counts the recording's length, not the time since resume",now-90_000,r.when,2000);
 }

 @Test public void segmentsSurviveACrashAndJoinIntoOnePlayableRecording()throws Exception{
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(),Manifest.permission.RECORD_AUDIO);
  AlphaNoteRecorder recorder=AlphaNoteRecorder.get(context());
  if(recorder.open())main(()->{recorder.discard();return null;});
  File root=new File(context().getNoBackupFilesDir(),"note-recording"),copy=null;
  AlphaNoteRecorder recovered=null;
  try{
   JSObject started=main(recorder::start);String id=started.getString("recordingId");
   assertEquals("recording",started.getString("state"));
   // Pause for two seconds: paused time is not recording time.
   SystemClock.sleep(3000);main(()->recorder.pause(id));long pausedAt=main(recorder::status).getLong("durationMs");
   SystemClock.sleep(2000);assertEquals("paused time does not count",pausedAt,main(recorder::status).getLong("durationMs"),300);
   main(()->recorder.resume(id));
   // More than two finished segments: the recorder rolls over with no length limit.
   long end=SystemClock.elapsedRealtime()+150_000;JSObject status=main(recorder::status);
   while(segments(status)<3&&SystemClock.elapsedRealtime()<end){SystemClock.sleep(500);status=main(recorder::status);}
   assertTrue("three finished segments: "+status,segments(status)>=3);
   assertEquals("recording",status.getString("state"));
   JSONArray list=status.getJSONArray("segments");long journaled=0;
   for(int i=0;i<list.length();i++){long d=list.getJSONObject(i).getLong("durationMs");assertTrue("every segment fits the 30 s window: "+d,d>0&&d<30_000);journaled+=d;}
   String first=list.getJSONObject(0).getString("segmentId");
   main(()->{recorder.setText(id,first,"journaled words");return null;});
   assertNotNull("a finished segment is readable",recorder.segment(first));
   // A crash: the files as they are now (finished segments, journal, the partial segment being
   // written), recovered by a new recorder as a new process would.
   String crashedId=UUID.randomUUID().toString();copy=new File(root,crashedId);
   File live=new File(root,id);copyTree(live,copy);
   int partialIndex=list.length();
   assertTrue("the segment being written exists before the crash",new File(copy,String.format(java.util.Locale.ROOT,"%05d.m4a",partialIndex)).isFile());
   main(()->{recorder.discard();return null;});
   assertFalse("discard deletes every segment",live.exists());
   AlphaNoteRecorder next=fresh();recovered=next;
   JSObject back=main(next::status);
   assertEquals("paused",back.getString("state"));assertTrue(back.getBoolean("recovered"));assertEquals(crashedId,back.getString("recordingId"));
   assertEquals("finished segments are kept",list.length(),segments(back));
   assertEquals("journaled text is kept","journaled words",back.getJSONArray("segments").getJSONObject(0).getString("text"));
   assertFalse("the partial segment is dropped",new File(copy,String.format(java.util.Locale.ROOT,"%05d.m4a",partialIndex)).exists());
   // Stop and join: one playable m4a as long as the journal says.
   main(()->next.stop(crashedId));
   File joined=next.joined(crashedId);
   long total=next.totalMs(),length=mediaMs(joined);
   assertTrue("joined length "+length+" ms matches the journal "+total+" ms",Math.abs(length-total)<1500);
   MediaPlayer player=new MediaPlayer();
   try{player.setDataSource(joined.getAbsolutePath());player.prepare();assertTrue(Math.abs(player.getDuration()-total)<1500);}finally{player.release();}
  }finally{
   AlphaNoteRecorder r=recovered;if(r!=null)main(()->{r.discard();return null;});
   if(recorder.open())main(()->{recorder.discard();return null;});
   if(copy!=null&&copy.exists())for(File f:copy.listFiles())f.delete();
   if(copy!=null)copy.delete();
  }
 }
}
