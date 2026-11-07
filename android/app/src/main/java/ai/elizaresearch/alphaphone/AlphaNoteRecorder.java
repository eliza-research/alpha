package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.AtomicFile;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Notes voice recording without a length limit (design/view-refresh-2026-11 PLAN.md section 3).
 *
 * <p>One recording is a directory of AAC segments under {@code noBackupFilesDir/note-recording}.
 * MediaRecorder switches to the next segment file without a gap ({@code setNextOutputFile}) when
 * the current one nears {@link #SEGMENT_BYTES}, which finalizes it: a finished segment is a
 * complete m4a that survives process death, and each one is short enough for every transcription
 * route (the on-device 30 s window, the Cloud and paired 60 s request bound). A segment that has
 * not reached the size after {@link #SEGMENT_MS} of audio (a quiet encoder) is closed and the next
 * one opened. Only the segment being written is lost when the process dies. Stop is the only end
 * apart from low storage or a microphone error. The process-wide instance outlives the activity;
 * {@link AlphaNoteRecordingService} keeps the process in the foreground while a recording is open.
 * All MediaRecorder calls run on the main thread.</p>
 *
 * <p>The journal ({@code segments.json}) lists every finished segment with its duration and, once
 * transcribed, its text, so a recovered recording keeps both its audio and its transcript.</p>
 */
final class AlphaNoteRecorder {
 /** About 22 s of 64 kbit/s mono AAC per segment. */
 static final long SEGMENT_BYTES=180_000;
 /** A segment is closed after this much audio even when it is still under {@link #SEGMENT_BYTES}. */
 static final long SEGMENT_MS=27_000;
 /** Recording stops, keeping every finished segment, when free space falls below this. */
 static final long MIN_FREE_BYTES=64L*1024*1024;
 static final String ID="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
 private static AlphaNoteRecorder instance;
 static synchronized AlphaNoteRecorder get(Context context){if(instance==null)instance=new AlphaNoteRecorder(context.getApplicationContext());return instance;}

 interface Listener { void changed(JSObject status); }
 private static final class Segment { final long durationMs; String text; Segment(long d,String t){durationMs=d;text=t;} }
 private final Context context;
 private final Handler main=new Handler(Looper.getMainLooper());
 private volatile Listener listener;
 private MediaRecorder recorder;
 private String id;
 private File dir;
 private int index; // the segment being written
 private final List<Segment> finished=new ArrayList<>();
 private long segmentStarted,pausedAt,pausedTotal;
 private String state="idle"; // idle | recording | paused | stopped
 private String stopReason;
 private boolean recovered;
 private String ownerDigest;
 private String folderId;
 private final Runnable rollover=this::rollover;

 private AlphaNoteRecorder(Context context){this.context=context;recover();}
 void setListener(Listener value){listener=value;}
 void clearListener(Listener value){if(listener==value)listener=null;}

 private File root(){File d=new File(context.getNoBackupFilesDir(),"note-recording");if(!d.isDirectory()&&!d.mkdirs())throw new IllegalStateException("Recording storage unavailable");return d;}
 private File segmentFile(int i){return new File(dir,String.format(Locale.ROOT,"%05d.m4a",i));}
 private AtomicFile journal(){return new AtomicFile(new File(dir,"segments.json"));}

 /** A recording a previous process left behind comes back paused, with its finished segments. */
 private synchronized void recover(){
  File[] sessions;try{sessions=root().listFiles(File::isDirectory);}catch(RuntimeException unavailable){return;}
  if(sessions==null)return;
  for(File session:sessions){
   if(id!=null||!session.getName().matches(ID)){deleteTree(session);continue;}
   try{
    List<Segment> segments=new ArrayList<>();
    JSONObject record;
    try(InputStream in=new AtomicFile(new File(session,"segments.json")).openRead()){
     record=new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));
     JSONArray list=record.getJSONArray("segments");
     for(int i=0;i<list.length();i++){JSONObject s=list.getJSONObject(i);segments.add(new Segment(Math.max(1,s.getLong("d")),s.has("t")?s.getString("t"):null));}
    }
    if(segments.isEmpty())throw new IOException("No finished audio");
    for(int i=0;i<segments.size();i++)if(!new File(session,String.format(Locale.ROOT,"%05d.m4a",i)).isFile())throw new IOException("Segment missing");
    // The segment that was being written has no journal entry and cannot be read; it is dropped.
    File[] partial=session.listFiles((d,n)->n.endsWith(".m4a")&&parseIndex(n)>=segments.size());
    if(partial!=null)for(File f:partial)f.delete();
    id=session.getName();dir=session;finished.addAll(segments);index=segments.size();
    String recordedOwner=record.optString("ownerDigest","");
    String recordedFolder=record.optString("folderId","");
    ownerDigest=validOwner(recordedOwner)&&validFolder(recordedFolder)?recordedOwner:null;
    folderId=ownerDigest!=null&&!recordedFolder.isEmpty()?recordedFolder:null;
    state="paused";recovered=true;stopReason=null;
   }catch(Exception unreadable){deleteTree(session);}
  }
 }
 private static int parseIndex(String name){try{return Integer.parseInt(name.substring(0,name.length()-4));}catch(RuntimeException e){return -1;}}
 private long usableSpace(){try{return root().getUsableSpace();}catch(RuntimeException unavailable){return 0;}}

 private static boolean validOwner(String value){return value!=null&&value.matches("[a-f0-9]{64}");}
 private static boolean validFolder(String value){return value==null||value.isEmpty()||value.matches("f-[A-Za-z0-9_-]{1,64}");}
 synchronized JSObject start(String owner,String destination) throws IOException {
  if(id!=null)throw new IllegalStateException("A recording is already open");
  if(!validOwner(owner)||!validFolder(destination))throw new IllegalArgumentException("Invalid recording ownership");
  if(usableSpace()<MIN_FREE_BYTES)throw new IOException("storage");
  String next=UUID.randomUUID().toString();File folder=new File(root(),next);
  if(!folder.mkdirs())throw new IOException("Recording storage unavailable");
  id=next;dir=folder;finished.clear();index=0;pausedTotal=0;stopReason=null;recovered=false;
  ownerDigest=owner;folderId=destination==null||destination.isEmpty()?null:destination;
  state="recording";
  try{writeJournal();open(index);}catch(IOException|RuntimeException error){discard();throw error;}
  publish();return status();
 }

 private static MediaRecorder create(Context context){return Build.VERSION.SDK_INT>=Build.VERSION_CODES.S?new MediaRecorder(context):new MediaRecorder();}
 private void open(int segment) throws IOException {
  MediaRecorder next=create(context);
  try{
   next.setAudioSource(MediaRecorder.AudioSource.MIC);
   next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
   next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
   next.setAudioChannels(1);next.setAudioSamplingRate(16000);next.setAudioEncodingBitRate(64000);
   next.setMaxFileSize(SEGMENT_BYTES);
   next.setOutputFile(segmentFile(segment));
   next.setOnInfoListener(this::info);
   next.setOnErrorListener((source,what,extra)->{synchronized(this){if(recorder!=source)return;end("error",false);}});
   next.prepare();next.start();
  }catch(IOException|RuntimeException error){next.release();throw error;}
  recorder=next;segmentStarted=SystemClock.elapsedRealtime();pausedTotal=0;pausedAt=0;
  scheduleRollover();
 }
 private void scheduleRollover(){main.removeCallbacks(rollover);if(recorder!=null&&"recording".equals(state))main.postDelayed(rollover,Math.max(1000,SEGMENT_MS-currentMs()));}
 private long currentMs(){if(recorder==null)return 0;long now=SystemClock.elapsedRealtime();return Math.max(0,now-segmentStarted-pausedTotal-(pausedAt>0?now-pausedAt:0));}
 /** A segment that stayed under the size bound for {@link #SEGMENT_MS} is closed and the next opened. */
 private synchronized void rollover(){
  if(recorder==null||!"recording".equals(state))return;
  if(currentMs()<SEGMENT_MS-500){scheduleRollover();return;}
  finishCurrent();
  if(usableSpace()<MIN_FREE_BYTES){state="stopped";stopReason="storage";publish();return;}
  try{open(index);}catch(IOException|RuntimeException error){state="stopped";stopReason="error";}
  publish();
 }

 private synchronized void info(MediaRecorder source,int what,int extra){
  if(recorder!=source)return;
  try{
   if(what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_APPROACHING){
    if(usableSpace()<MIN_FREE_BYTES){end("storage",true);return;}
    source.setNextOutputFile(segmentFile(index+1));
   }else if(what==MediaRecorder.MEDIA_RECORDER_INFO_NEXT_OUTPUT_FILE_STARTED){
    // The previous file is complete: journal it, so it survives process death.
    long now=SystemClock.elapsedRealtime();finished.add(new Segment(Math.max(1,now-segmentStarted-pausedTotal),null));index++;segmentStarted=now;pausedTotal=0;
    writeJournal();scheduleRollover();publish();
   }else if(what==MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED){
    // The next file was not accepted in time: finalize this one and continue in a fresh recorder.
    finishCurrent();
    if(usableSpace()<MIN_FREE_BYTES){state="stopped";stopReason="storage";publish();return;}
    open(index);publish();
   }
  }catch(IOException|RuntimeException error){end("error",false);}
 }

 /** Stops the recorder, keeping the segment being written when it is readable. */
 private void finishCurrent(){
  main.removeCallbacks(rollover);
  MediaRecorder active=recorder;recorder=null;if(active==null)return;
  long now=SystemClock.elapsedRealtime();long duration=Math.max(1,now-segmentStarted-pausedTotal-(pausedAt>0?now-pausedAt:0));
  boolean kept=false;
  try{active.stop();kept=true;}catch(RuntimeException tooShort){/* No audio in this segment yet. */}
  active.release();
  File current=segmentFile(index);
  if(kept&&current.isFile()&&current.length()>0){finished.add(new Segment(duration,null));index++;}
  else current.delete();
  pausedTotal=0;pausedAt=0;
  try{writeJournal();}catch(IOException unwritten){/* The finished segments are still on disk for this process. */}
 }

 private void end(String reason,boolean keepCurrent){
  if(keepCurrent)finishCurrent();
  else{main.removeCallbacks(rollover);MediaRecorder active=recorder;recorder=null;if(active!=null){try{active.stop();}catch(RuntimeException ignored){}active.release();segmentFile(index).delete();}}
  pausedAt=0;pausedTotal=0;
  state="stopped";stopReason=reason;publish();
 }

 synchronized JSObject pause(String recordingId){
  owned(recordingId);
  if("recording".equals(state)&&recorder!=null){recorder.pause();pausedAt=SystemClock.elapsedRealtime();state="paused";main.removeCallbacks(rollover);publish();}
  return status();
 }
 synchronized JSObject resume(String recordingId) throws IOException {
  owned(recordingId);
  if(!"paused".equals(state)&&!"stopped".equals(state))return status();
  if(usableSpace()<MIN_FREE_BYTES)throw new IOException("storage");
  if(recorder!=null){recorder.resume();pausedTotal+=SystemClock.elapsedRealtime()-pausedAt;pausedAt=0;state="recording";scheduleRollover();}
  else{String before=state;state="recording";try{open(index);}catch(IOException|RuntimeException error){state=before;throw error;}} // A recovered or stopped recording continues in a new segment.
  stopReason=null;recovered=false;publish();return status();
 }
 synchronized JSObject stop(String recordingId){
  owned(recordingId);
  if(recorder!=null)finishCurrent();
  state="stopped";if(stopReason==null)stopReason="user";
  publish();return status();
 }
 /** The transcript of one finished segment, journaled with it. */
 synchronized void setText(String recordingId,String segmentId,String text) throws IOException {
  owned(recordingId);int i=segmentIndex(segmentId);if(i<0)throw new IllegalArgumentException("Unknown segment");
  if(text==null||text.length()>20_000)throw new IllegalArgumentException("Invalid transcript");
  finished.get(i).text=text;writeJournal();
 }
 /** Deletes the recording and every segment. */
 synchronized void discard(){
  main.removeCallbacks(rollover);
  MediaRecorder active=recorder;recorder=null;
  if(active!=null){try{active.stop();}catch(RuntimeException ignored){}active.release();}
  if(dir!=null)deleteTree(dir);
  id=null;dir=null;ownerDigest=null;folderId=null;finished.clear();index=0;state="idle";stopReason=null;recovered=false;pausedTotal=0;pausedAt=0;
  publish();
 }
 synchronized boolean owns(String recordingId){return id!=null&&id.equals(recordingId);}
 private void owned(String recordingId){if(!owns(recordingId))throw new IllegalStateException("Recording changed");}
 /** True while a recording is open (recording, paused or stopped but not yet saved or discarded). */
 synchronized boolean open(){return id!=null;}

 private int segmentIndex(String segmentId){
  if(id==null||segmentId==null||!segmentId.startsWith(id+"-s"))return -1;
  int i;try{i=Integer.parseInt(segmentId.substring(id.length()+2));}catch(RuntimeException invalid){return -1;}
  return i>=0&&i<finished.size()?i:-1;
 }
 /** A finalized segment, by the id the renderer was given; never the one being written. */
 synchronized File segment(String segmentId){
  int i=segmentIndex(segmentId);if(i<0)return null;
  File file=segmentFile(i);return file.isFile()?file:null;
 }

 synchronized JSObject status(){
  JSObject out=new JSObject();out.put("state",state);
  if(id==null)return out;
  out.put("recordingId",id);out.put("recovered",recovered);
  if(ownerDigest!=null)out.put("binding",new JSObject().put("ownerDigest",ownerDigest).put("folderId",folderId==null?JSONObject.NULL:folderId));
  if(stopReason!=null)out.put("stopReason",stopReason);
  long total=0;JSArray segments=new JSArray();
  for(int i=0;i<finished.size();i++){Segment s=finished.get(i);total+=s.durationMs;JSObject o=new JSObject();o.put("segmentId",id+"-s"+i);o.put("durationMs",s.durationMs);if(s.text!=null)o.put("text",s.text);segments.put(o);}
  total+=currentMs();
  out.put("durationMs",total);out.put("segments",segments);
  double peak=0;if(recorder!=null&&"recording".equals(state))try{peak=Math.max(0,Math.min(1,recorder.getMaxAmplitude()/32767.0));}catch(RuntimeException ignored){}
  out.put("peak",peak);
  return out;
 }
 private void publish(){Listener target=listener;if(target!=null)try{target.changed(status());}catch(RuntimeException ignored){}}

 private void writeJournal() throws IOException {
  AtomicFile file=journal();FileOutputStream out=null;
  try{
   JSONArray list=new JSONArray();
   for(Segment s:finished){JSONObject o=new JSONObject().put("d",s.durationMs);if(s.text!=null)o.put("t",s.text);list.put(o);}
   JSONObject record=new JSONObject().put("segments",list).put("ownerDigest",ownerDigest).put("folderId",folderId);
   out=file.startWrite();out.write(record.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(out);
  }
  catch(org.json.JSONException|IOException error){if(out!=null)file.failWrite(out);throw new IOException("Recording index unavailable",error);}
 }

 /**
  * One m4a of every finished segment, in order, for the saved voice note. Remuxed without
  * re-encoding. Runs off the main thread on a stopped recording.
  */
 synchronized File joined(String recordingId) throws IOException {
  owned(recordingId);
  if(recorder!=null||finished.isEmpty())throw new IOException("Stop the recording first");
  File out=new File(dir,"joined.m4a");out.delete();
  MediaMuxer muxer=new MediaMuxer(out.getAbsolutePath(),MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);
  int track=-1;long offset=0;boolean started=false;
  try{
   ByteBuffer buffer=ByteBuffer.allocate(64*1024);MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();
   for(int i=0;i<finished.size();i++){
    MediaExtractor extractor=new MediaExtractor();
    try{
     extractor.setDataSource(segmentFile(i).getAbsolutePath());
     int audio=-1;MediaFormat format=null;
     for(int t=0;t<extractor.getTrackCount();t++){MediaFormat f=extractor.getTrackFormat(t);String mime=f.getString(MediaFormat.KEY_MIME);if(mime!=null&&mime.startsWith("audio/")){audio=t;format=f;break;}}
     if(audio<0)throw new IOException("Segment has no audio");
     extractor.selectTrack(audio);
     if(!started){track=muxer.addTrack(format);muxer.start();started=true;}
     int rate=format.containsKey(MediaFormat.KEY_SAMPLE_RATE)?format.getInteger(MediaFormat.KEY_SAMPLE_RATE):16000;
     long last=-1;
     while(true){
      buffer.clear();int size=extractor.readSampleData(buffer,0);if(size<0)break;
      long time=extractor.getSampleTime();last=Math.max(last,time);
      info.set(0,size,offset+time,(extractor.getSampleFlags()&MediaExtractor.SAMPLE_FLAG_SYNC)!=0?MediaCodec.BUFFER_FLAG_KEY_FRAME:0);
      muxer.writeSampleData(track,buffer,info);extractor.advance();
     }
     // One AAC frame (1024 samples) after the last sample of this segment.
     offset+=Math.max(0,last)+1024L*1_000_000L/Math.max(1,rate);
    }finally{extractor.release();}
   }
   if(!started)throw new IOException("No audio");
   muxer.stop();
  }catch(IOException|RuntimeException error){try{muxer.release();}catch(RuntimeException ignored){}out.delete();throw error instanceof IOException?(IOException)error:new IOException("Recording could not be joined",error);}
  muxer.release();
  return out;
 }
 synchronized long totalMs(){long total=0;for(Segment s:finished)total+=s.durationMs;return total;}
 synchronized String recordingId(){return id;}

 private static void deleteTree(File file){File[] kids=file.listFiles();if(kids!=null)for(File kid:kids)deleteTree(kid);file.delete();}
}
