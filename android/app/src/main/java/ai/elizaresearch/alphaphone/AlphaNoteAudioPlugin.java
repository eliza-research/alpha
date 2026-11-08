package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.RecordingStore;
import android.media.MediaPlayer;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.*;
import java.util.*;
import org.json.JSONObject;

/**
 * Durable, device-local voice notes. No paths, audio bytes or credentials cross the JS bridge.
 * Storage, receipts and owner fences are the shared recording store (elizaOS plugin-native-media
 * RecordingStore); Alpha keeps its installed names, playback and the Notes Trash backstop.
 */
@CapacitorPlugin(name="AlphaNoteAudio")
public class AlphaNoteAudioPlugin extends Plugin {
 private MediaPlayer player; private String playingId; private PluginCall preparing;
 private final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
 private final java.util.concurrent.ExecutorService migrationWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
 private volatile boolean destroyed;
 private volatile String migrationState="pending";
 private volatile int migrationFailures;
 /**
  * Alpha's installed recording store: note-audio in no-backup storage, metadata in the
  * Keystore-backed slot store under note-audio-metadata:v1:, owned by noteId. These names predate
  * the shared store and stay fixed so existing recordings and receipts keep resolving.
  */
 static RecordingStore recordings(android.content.Context context){return recordings(context,CLIPS);}
 /**
  * Both bounds keep the orphan-recording backstop (AUDIO_BACKSTOP_MS, twice Recently deleted
  * retention), so a recording a restorable note still uses is never erased first. Clips keep the
  * shared clip bounds; a Notes recording (AlphaNoteRecorder) has no length limit and its
  * transcript fits the 512 KiB metadata slot. Requires patches/eliza/notes-recording-store.patch.
  */
 static final RecordingStore.Limits CLIPS=new RecordingStore.Limits(RecordingStore.MAX_BYTES,RecordingStore.MAX_DURATION_MS,RecordingStore.MAX_TRANSCRIPT,AlphaNoteAudioPlugin.AUDIO_BACKSTOP_MS);
 static final RecordingStore.Limits NOTE_RECORDINGS=new RecordingStore.Limits(Long.MAX_VALUE,Long.MAX_VALUE,150_000,AlphaNoteAudioPlugin.AUDIO_BACKSTOP_MS);
 private static RecordingStore recordings(android.content.Context context,RecordingStore.Limits limits){
  AlphaCredentialStore store=new AlphaCredentialStore(context);
  return new RecordingStore(new File(context.getNoBackupFilesDir(),"note-audio"),"note-audio-metadata:v1:","noteId",new RecordingStore.Slots(){
   @Override public String read(String slot)throws Exception{return store.readCredentialSlot(slot);}
   @Override public void write(String slot,String value)throws Exception{store.writeCredentialSlot(slot,value);}
   @Override public void remove(String slot)throws Exception{store.removeCredentialSlot(slot);}
  },limits);
 }
 private RecordingStore recordings(){return recordings(getContext());}
 @Override public void load(){
  // Plugin registration/startup must not synchronously decrypt an entire old collection.
  main.post(()->{if(destroyed)return;if(PluginWorkers.submit(migrationWorker,this::migrateLegacyMetadata,()->migrationState="stopped"))PluginWorkers.submit(migrationWorker,this::sweepTrashOnStart,()->migrationState="stopped");});
 }
 private void migrateLegacyMetadata(){
  migrationState="running";
  try{migrationFailures+=recordings().migrateLegacy(()->destroyed);}
  catch(Exception retained){migrationFailures++;/* Keep both copies; explicit status reports recovery needed. */}
  finally{migrationState=destroyed?"stopped":migrationFailures>0?"needs-recovery":"complete";}
 }
 private void sweepTrashOnStart(){
  if(destroyed)return;
  try{finishPermanentDeletions(getContext(),System.currentTimeMillis());}catch(Exception retained){/* The renderer's startup pass and the periodic sweep retry. */}
  try{sweepExpiredTrash(getContext(),System.currentTimeMillis());}catch(Exception retained){/* The renderer and the periodic sweep retry. */}
 }

 /** Product Trash retention, matching notes-trash-policy.ts: thirty days after deletion. */
 static final long NOTES_TRASH_RETENTION_MS=30L*24*60*60*1000;
 /** Orphan-recording backstop: twice Trash retention, so the Trash rules (live references, review) always decide first. */
 static final long AUDIO_BACKSTOP_MS=2*NOTES_TRASH_RETENTION_MS;
 static final String NOTES_TRASH_SLOT="notes-trash:v1:device",NOTES_SLOT="notes-records:v1:device",PENDING_AUDIO_SLOT="notes-audio-deletions:v1:device";
 private static final String TRASH_PREFIX="{\"version\":1,\"entries\":[",TRASH_SUFFIX="]}";
 private static final String TRASH_WORK="alpha-notes-trash-backstop";
 private static final Object SWEEP_LOCK=new Object();
 private static final String OPERATION="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

 /** Periodic best-effort upkeep while Alpha is closed; the renderer remains the primary purge path. */
 static void scheduleTrashBackstop(android.content.Context context){
  androidx.work.WorkManager.getInstance(context).enqueueUniquePeriodicWork(TRASH_WORK,androidx.work.ExistingPeriodicWorkPolicy.KEEP,
   new androidx.work.PeriodicWorkRequest.Builder(NotesTrashBackstopWorker.class,6,java.util.concurrent.TimeUnit.HOURS).build());
 }
 public static final class NotesTrashBackstopWorker extends androidx.work.Worker {
  public NotesTrashBackstopWorker(@androidx.annotation.NonNull android.content.Context context,@androidx.annotation.NonNull androidx.work.WorkerParameters params){super(context,params);}
  @androidx.annotation.NonNull @Override public Result doWork(){
   boolean retry=false;
   // Independent passes: a failure of one never skips the other.
   try{finishPermanentDeletions(getApplicationContext(),System.currentTimeMillis());}catch(Exception unavailable){retry=true;}
   try{sweepExpiredTrash(getApplicationContext(),System.currentTimeMillis());}catch(Exception unavailable){retry=true;}
   return retry?Result.retry():Result.success();
  }
 }

 /**
  * Native backstop for Notes Trash. Erases the recording of each Trash entry whose thirty days
  * have elapsed, then removes those entries from the encrypted Trash slot, under the same rules
  * as the renderer's maintenance: a note that is saved again, a recording that any saved note
  * still references, and a deletion still under review are never touched. Any unreadable or
  * unrecognized store makes it a no-op. The Trash slot is edited by compare-and-exchange on the
  * renderer's own bytes: kept entries are copied verbatim, so the result is exactly the
  * JSON.stringify form the renderer compares against, and a concurrent renderer edit wins.
  * Returns the number of entries removed.
  */
 static int sweepExpiredTrash(android.content.Context context,long now)throws Exception{
  // Sweeps serialize among themselves. The recording store's lock, which the main-thread plugin
  // methods also take, is held only while one recording is erased, never while large slots are decrypted.
  synchronized(SWEEP_LOCK){
   AlphaCredentialStore store=new AlphaCredentialStore(context);
   String raw=store.readCredentialSlot(NOTES_TRASH_SLOT);if(raw==null)return 0;
   java.util.List<String> spans=trashEntrySpans(raw);if(spans==null||spans.isEmpty())return 0;
   String notesRaw=store.readCredentialSlot(NOTES_SLOT);if(notesRaw==null)return 0;
   org.json.JSONArray records=new JSONObject(new JSONObject(notesRaw).getString("currentRaw")).getJSONArray("records");
   Set<String> liveNotes=new HashSet<>(),liveAudio=new HashSet<>();
   for(int i=0;i<records.length();i++){JSONObject note=records.getJSONObject(i);liveNotes.add(note.getString("id"));JSONObject audio=note.optJSONObject("audio");if(audio!=null&&audio.optString("audioId").length()>0)liveAudio.add(audio.getString("audioId"));}
   String pendingRaw=store.readCredentialSlot(PENDING_AUDIO_SLOT);JSONObject pending=pendingRaw==null?new JSONObject():new JSONObject(pendingRaw);
   List<String> kept=new ArrayList<>();int removed=0;
   for(String span:spans){
    JSONObject entry=new JSONObject(span),note=entry.getJSONObject("note");
    String id=entry.getString("id"),noteId=note.getString("id");long deletedAt=entry.getLong("deletedAt");
    boolean due=deletedAt>0&&now>=deletedAt+NOTES_TRASH_RETENTION_MS&&!liveNotes.contains(noteId);
    JSONObject audio=entry.optJSONObject("audio");
    if(due&&audio!=null){
     String audioId=audio.optString("audioId");
     due=!pending.has(id)&&!liveAudio.contains(audioId);
     if(due)due=recordings(context).purgeTrashed(audioId,noteId,id);
    }
    if(due)removed++;else kept.add(span);
   }
   if(removed==0)return 0;
   StringBuilder next=new StringBuilder(TRASH_PREFIX);
   for(int i=0;i<kept.size();i++){if(i>0)next.append(',');next.append(kept.get(i));}
   next.append(TRASH_SUFFIX);
   return store.compareExchangeCredentialSlot(NOTES_TRASH_SLOT,raw,next.toString())?removed:0;
  }
 }
 /**
  * Native backstop for a permanent voice deletion ("Delete forever without Trash") that process
  * death interrupted after its tombstone was committed. Such a deletion has no Trash entry, so
  * sweepExpiredTrash never sees it; its recovery row in the pending-deletions slot (marked
  * permanent) is the only record. For each such row this erases the recording and retires the
  * row, but only on exact ownership read from the encrypted stores:
  * - the saved Notes document holds this operation's own tombstone for the reviewed note id and
  *   revision in the reviewed collection, the note is not saved, and no saved note references
  *   the recording;
  * - the recording's metadata names that note; and
  * - this operation already holds the recording in the audio trash (receipt "removed"), already
  *   erased it ("purged"), or the recording was never moved and no other deletion holds it.
  * A recording with a "restored" receipt, one that another deletion holds, a note that is saved
  * again or changed, a row that is not marked permanent, a row whose renderer lease has not
  * expired (NotesDeletionLease: a live renderer is between its steps or shows it under review),
  * and any unreadable or unrecognized
  * store are left exactly as they are for the renderer's review. This pass never writes the Notes
  * document, so it cannot roll back or finish a deletion whose note is still saved; the
  * renderer's startup pass does that. Kept rows are copied byte for byte and the slot is edited
  * by compare-and-exchange, so a concurrent renderer edit wins. Returns the number of rows retired.
  */
 static int finishPermanentDeletions(android.content.Context context,long now)throws Exception{
  synchronized(SWEEP_LOCK){
   AlphaCredentialStore store=new AlphaCredentialStore(context);
   String raw=store.readCredentialSlot(PENDING_AUDIO_SLOT);if(raw==null)return 0;
   List<String> members=pendingMemberSpans(raw);if(members==null||members.isEmpty())return 0;
   String notesRaw=store.readCredentialSlot(NOTES_SLOT);if(notesRaw==null)return 0;
   JSONObject envelope=new JSONObject(new JSONObject(notesRaw).getString("currentRaw"));
   org.json.JSONArray records=envelope.getJSONArray("records"),tombstones=envelope.getJSONArray("deleted");String collection=envelope.getString("collectionId");
   Set<String> liveNotes=new HashSet<>(),liveAudio=new HashSet<>();
   for(int i=0;i<records.length();i++){JSONObject note=records.getJSONObject(i);liveNotes.add(note.getString("id"));JSONObject audio=note.optJSONObject("audio");if(audio!=null&&audio.optString("audioId").length()>0)liveAudio.add(audio.getString("audioId"));}
   List<String> kept=new ArrayList<>();int retired=0;
   for(String member:members){
    boolean done=false;
    try{
     JSONObject holder=new JSONObject("{"+member+"}");String operation=holder.keys().next();JSONObject row=holder.getJSONObject(operation);
     JSONObject target=row.getJSONObject("target"),note=row.getJSONObject("note"),noteAudio=note.getJSONObject("audio");
     String noteId=note.getString("id"),audioId=row.getString("audioId");
     // A row a live renderer still holds (between steps, or shown under review with Restore) is left alone.
     boolean bound=Boolean.TRUE.equals(row.opt("permanent"))&&!NotesDeletionLease.held(row,now)&&operation.matches(OPERATION)&&operation.equals(row.getString("id"))
      &&noteId.equals(target.getString("noteId"))&&audioId.equals(noteAudio.getString("audioId"))&&noteId.equals(noteAudio.getString("noteId"));
     boolean tombstoned=false;
     if(bound&&!liveNotes.contains(noteId)&&!liveAudio.contains(audioId)&&collection.equals(target.getString("sourceId")))for(int i=0;i<tombstones.length()&&!tombstoned;i++){
      JSONObject tombstone=tombstones.getJSONObject(i);
      tombstoned=noteId.equals(tombstone.optString("id"))&&target.getString("revision").equals(tombstone.optString("revision"))&&operation.equals(tombstone.optString("operationId"));
     }
     if(tombstoned)done=recordings(context).finishPermanent(audioId,noteId,operation,now);
    }catch(Exception retained){done=false;}
    if(done)retired++;else kept.add(member);
   }
   if(retired==0)return 0;
   StringBuilder next=new StringBuilder("{");
   for(int i=0;i<kept.size();i++){if(i>0)next.append(',');next.append(kept.get(i));}
   next.append('}');
   return store.compareExchangeCredentialSlot(PENDING_AUDIO_SLOT,raw,next.toString())?retired:0;
  }
 }
 /**
  * Top-level entry substrings of a Trash document written by JSON.stringify, or null when the
  * bytes are not exactly {"version":1,"entries":[...]}.
  */
 static List<String> trashEntrySpans(String raw){
  if(raw==null||!raw.startsWith(TRASH_PREFIX)||!raw.endsWith(TRASH_SUFFIX))return null;
  List<String> spans=topLevelSpans(raw,TRASH_PREFIX.length(),raw.length()-TRASH_SUFFIX.length());
  if(spans==null)return null;
  for(String span:spans)if(!span.startsWith("{")||!span.endsWith("}"))return null;
  return spans;
 }
 /**
  * Top-level "id":{row} member substrings of the pending-deletions document written by
  * JSON.stringify, or null when the bytes are not one flat object of object-valued members.
  */
 static List<String> pendingMemberSpans(String raw){
  if(raw==null||raw.length()<2||!raw.startsWith("{")||!raw.endsWith("}"))return null;
  List<String> spans=topLevelSpans(raw,1,raw.length()-1);
  if(spans==null)return null;
  for(String span:spans){
   try{JSONObject holder=new JSONObject("{"+span+"}");if(holder.length()!=1||!span.startsWith("\"")||!span.endsWith("}")||holder.optJSONObject(holder.keys().next())==null)return null;}
   catch(Exception unrecognized){return null;}
  }
  return spans;
 }
 /** Comma-separated values between start and end at nesting depth zero, verbatim; null when unbalanced or empty-valued. */
 private static List<String> topLevelSpans(String raw,int start,int end){
  List<String> spans=new ArrayList<>();
  int depth=0;boolean string=false,escape=false;
  if(start==end)return spans;
  for(int i=start;i<end;i++){
   char c=raw.charAt(i);
   if(string){if(escape)escape=false;else if(c=='\\')escape=true;else if(c=='"')string=false;continue;}
   if(c=='"')string=true;
   else if(c=='{'||c=='[')depth++;
   else if(c=='}'||c==']'){if(--depth<0)return null;}
   else if(c==','&&depth==0){if(i==start)return null;spans.add(raw.substring(start,i));start=i+1;}
  }
  if(string||depth!=0||start>=end)return null;
  spans.add(raw.substring(start,end));
  return spans;
 }

 @PluginMethod public void migrationStatus(PluginCall call){JSObject result=new JSObject();result.put("state",migrationState);result.put("failedRecords",migrationFailures);call.resolve(result);}

 /** Only native recorders can import a stopped clip; the renderer cannot nominate a path. */
 JSObject retain(File source,String recordingId,String noteId,long duration,String transcript)throws Exception {return JSObject.fromJSONObject(recordings().retain(source,recordingId,noteId,duration,transcript));}
 /**
  * Joins a Notes recording's segments and keeps them for the note, on this plugin's worker (after
  * the startup metadata pass). The renderer discards the segments once the note itself is saved.
  */
 void saveNoteRecording(PluginCall call,AlphaNoteRecorder recorder,String id){
  PluginWorkers.submit(migrationWorker,()->{
   try{File joined=recorder.joined(id);call.resolve(retainNoteRecording(joined,id,call.getString("noteId"),recorder.totalMs(),call.getString("transcript")));}
   catch(Exception error){call.reject("The recording could not be saved.");}
  },()->call.reject("The recording could not be saved."));
 }
 /**
  * A Notes recording has no length limit: the joined file is moved into place, not copied. The
  * note holds the whole transcript; the recording's metadata keeps at most its bounded prefix, so
  * a long recording's transcript never stops the audio from being saved.
  */
 JSObject retainNoteRecording(File source,String recordingId,String noteId,long duration,String transcript)throws Exception {return JSObject.fromJSONObject(recordings(getContext(),NOTE_RECORDINGS).retain(source,recordingId,noteId,duration,transcriptPrefix(transcript,NOTE_RECORDINGS.maxTranscript),true));}
 /** At most `max` UTF-16 units, never ending inside a surrogate pair. */
 static String transcriptPrefix(String transcript,int max){
  if(transcript==null||transcript.length()<=max)return transcript;
  int end=max;if(end>0&&Character.isHighSurrogate(transcript.charAt(end-1)))end--;
  return transcript.substring(0,end);
 }
 @PluginMethod public void describe(PluginCall call){try{call.resolve(JSObject.fromJSONObject(recordings().describe(call.getString("audioId"))));}catch(Exception error){call.reject("Saved recording is unavailable");}}
 @PluginMethod public void play(PluginCall call){main.post(()->{try{
  String key=RecordingStore.id(call.getString("audioId"));File file=recordings().playable(key);stop();
  MediaPlayer next=new MediaPlayer();player=next;playingId=key;preparing=call;next.setDataSource(file.getAbsolutePath());
  next.setOnPreparedListener(p->{if(player!=p)return;try{p.start();JSObject receipt=new JSObject();receipt.put("audioId",key);receipt.put("playing",p.isPlaying());receipt.put("positionMs",p.getCurrentPosition());preparing=null;notifyListeners("started",receipt);call.resolve(receipt);}catch(RuntimeException e){stop();}});
  next.setOnCompletionListener(p->{if(player==p){stop();JSObject event=new JSObject();event.put("audioId",key);notifyListeners("ended",event);}});
  next.setOnErrorListener((p,w,e)->{if(player==p){stop();JSObject event=new JSObject();event.put("audioId",key);notifyListeners("failed",event);}return true;});next.prepareAsync();
 }catch(Exception error){stop();call.reject("Saved recording could not be played");}});}
 @PluginMethod public void stop(PluginCall call){main.post(()->{stop();call.resolve();});}
 @PluginMethod public void state(PluginCall call){main.post(()->{JSObject value=new JSObject();try{value.put("playing",player!=null&&player.isPlaying());value.put("audioId",playingId);value.put("positionMs",player==null?0:player.getCurrentPosition());}catch(RuntimeException error){value.put("playing",false);}call.resolve(value);});}
 @PluginMethod public void remove(PluginCall call){changeDeleted(call,true);}
 @PluginMethod public void restore(PluginCall call){changeDeleted(call,false);}
 /** Notes Trash expiry or "Delete forever": erase the bytes of a recording this operation already moved to the audio trash. */
 @PluginMethod public void purge(PluginCall call){main.post(()->{try{
  String key=RecordingStore.id(call.getString("audioId"));
  call.resolve(JSObject.fromJSONObject(recordings().purge(key,call.getString("noteId"),call.getString("operationId"),()->{if(key.equals(playingId))stop();})));
 }catch(Exception error){call.reject("Saved recording could not be erased");}});}
 @PluginMethod public void deletionStatus(PluginCall call){try{call.resolve(JSObject.fromJSONObject(recordings().deletionStatus(call.getString("audioId"),call.getString("noteId"),call.getString("operationId"))));}catch(Exception error){call.reject("Recording operation is unavailable");}}
 /** Receipt and effect share one encrypted metadata commit; retired operations never regain permission. */
 private void changeDeleted(PluginCall call,boolean deleted){main.post(()->{try{
  String key=RecordingStore.id(call.getString("audioId")),noteId=call.getString("noteId"),operation=call.getString("operationId");
  Runnable stopPlayback=()->{if(key.equals(playingId))stop();};
  call.resolve(JSObject.fromJSONObject(deleted?recordings().remove(key,noteId,operation,stopPlayback):recordings().restore(key,noteId,operation,stopPlayback)));
 }catch(Exception error){call.reject("Saved recording could not be updated");}});}
 private void stop(){if(preparing!=null){preparing.reject("Playback cancelled");preparing=null;}if(player!=null){player.release();player=null;}playingId=null;}
 @Override protected void handleOnPause(){main.post(this::stop);}
 @Override protected void handleOnDestroy(){destroyed=true;migrationWorker.shutdownNow();migrationState="stopped";main.post(this::stop);}
}
