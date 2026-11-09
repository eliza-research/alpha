package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.IOException;
import java.util.UUID;
import java.util.function.Consumer;

/** One foreground-only private audio draft. Capture and upload are separate user actions. */
final class DevelopmentVoiceCapture {
 private final Context context;
 private final Consumer<JSObject> events;
 private final Handler handler = new Handler(Looper.getMainLooper());
 private MediaRecorder recorder;
 private File file;
 private String id;
 private long startedAt;
 private long durationMs;
 private Runnable deadline;
 DevelopmentVoiceCapture(Context context, Consumer<JSObject> events) {
  this.context = context; this.events = events;
  File[] stale = context.getCacheDir().listFiles((dir,name) -> name.startsWith("alpha-dev-voice-") && name.endsWith(".m4a"));
  if (stale != null) for (File candidate : stale) candidate.delete();
 }
 synchronized JSObject start() throws IOException {
  if (file != null) throw new IllegalStateException("Finish or discard the current recording first");
  id = UUID.randomUUID().toString(); file = new File(context.getCacheDir(), "alpha-dev-voice-" + id + ".m4a");
  recorder = new MediaRecorder();
  try {
   recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
   recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
   recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
   recorder.setAudioChannels(1); recorder.setAudioSamplingRate(16000); recorder.setAudioEncodingBitRate(64000);
   recorder.setOutputFile(file.getAbsolutePath()); recorder.setMaxDuration(59000); recorder.setMaxFileSize(4 * 1024 * 1024);
   recorder.setOnInfoListener((source, what, extra) -> {
    if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) stopAutomatically();
   });
   recorder.setOnErrorListener((source, what, extra) -> {
    // Carry the id taken before cancel() clears it: the renderer ignores events for other recordings.
    JSObject result=new JSObject();
    synchronized(this) { if (recorder != source) return; result.put("recordingId",id); cancel(); }
    result.put("status","failed");result.put("message","Recording stopped because Android reported a microphone error");events.accept(result);
   });
   recorder.prepare(); recorder.start(); startedAt = SystemClock.elapsedRealtime();
   deadline = this::stopAutomatically; handler.postDelayed(deadline,59000);
   JSObject result = new JSObject(); result.put("status","recording"); result.put("recordingId",id); result.put("maxDurationMs",59000); return result;
  } catch (IOException | RuntimeException error) { cancel(); throw error; }
 }
 synchronized JSObject stop() {
  if (recorder == null) throw new IllegalStateException("No recording is active");
  handler.removeCallbacks(deadline); durationMs = SystemClock.elapsedRealtime() - startedAt;
  try { recorder.stop(); }
  catch (RuntimeException error) { cancel(); throw new IllegalStateException("Recording was too short or unavailable"); }
  recorder.release(); recorder = null;
  if (!file.isFile() || file.length() == 0 || file.length() > 4 * 1024 * 1024) { cancel(); throw new IllegalStateException("Recording is unavailable or exceeds the size limit"); }
  JSObject result = new JSObject(); result.put("status","recorded"); result.put("recordingId",id); result.put("durationMs",durationMs); return result;
 }
 synchronized void stopAutomatically() {
  if (recorder == null) return;
  String recordingId = id;
  try { events.accept(stop()); }
  catch (RuntimeException error) { JSObject result=new JSObject();result.put("recordingId",recordingId);result.put("status","failed");result.put("message","Recording could not be saved");events.accept(result); }
 }
 synchronized JSObject retain(AlphaNoteAudioPlugin store,String recordingId,String noteId,String transcript)throws Exception {File chosen=selected(recordingId);if(chosen==null)throw new IllegalStateException();return store.retain(chosen,recordingId,noteId,durationMs,transcript);}
 synchronized File selected(String recordingId) {
  if (recorder != null || file == null || !id.equals(recordingId)) return null;
  return file;
 }
 synchronized void cancel() {
  if (deadline != null) handler.removeCallbacks(deadline);
  if (recorder != null) { try { recorder.stop(); } catch (RuntimeException ignored) {} recorder.release(); recorder=null; }
  if (file != null) file.delete(); file=null; id=null; durationMs=0;
 }
}
