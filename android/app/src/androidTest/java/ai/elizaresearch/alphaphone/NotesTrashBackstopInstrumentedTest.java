package ai.elizaresearch.alphaphone;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * Native Notes Trash backstop on the real encrypted slot store and recording files: expired
 * text and voice entries are erased with the renderer's rules, kept entries stay byte-identical,
 * and a recording a saved note still references is never touched. The permanent-deletion pass
 * (finishPermanentDeletions) is covered on the same stores. Saved slots are restored.
 */
@RunWith(AndroidJUnit4.class)
public final class NotesTrashBackstopInstrumentedTest {
 private static final long DAY=24L*60*60*1000;
 private static final String[] SLOTS={AlphaNoteAudioPlugin.NOTES_TRASH_SLOT,AlphaNoteAudioPlugin.NOTES_SLOT,AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT,"note-audio-metadata:v1:backstop-expired","note-audio-metadata:v1:backstop-shared"};
 private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
 private final AlphaCredentialStore store=new AlphaCredentialStore(context);
 private final String[] saved=new String[SLOTS.length];

 @Before public void save()throws Exception{for(int i=0;i<SLOTS.length;i++)saved[i]=store.readCredentialSlot(SLOTS[i]);}
 @After public void restore()throws Exception{
  for(int i=0;i<SLOTS.length;i++){if(saved[i]==null)store.removeCredentialSlot(SLOTS[i]);else store.writeCredentialSlot(SLOTS[i],saved[i]);}
  for(String id:new String[]{"backstop-expired","backstop-shared"}){new File(audioDir(),id+".audio").delete();new File(audioDir(),id+".json").delete();}
 }
 private File audioDir(){File dir=new File(context.getNoBackupFilesDir(),"note-audio");dir.mkdirs();return dir;}
 private void recording(String audioId,String noteId,String operation,long deletedAt)throws Exception{
  try(FileOutputStream out=new FileOutputStream(new File(audioDir(),audioId+".audio"))){out.write("synthetic".getBytes(StandardCharsets.UTF_8));}
  JSONObject record=new JSONObject().put("audioId",audioId).put("noteId",noteId).put("durationMs",1000).put("createdAt",deletedAt-1000).put("mimeType","audio/mp4")
   .put("transcript","Synthetic spoken words").put("deletedAt",deletedAt).put("activeDeletionOperation",operation).put("deletionOperations",new JSONObject().put(operation,"removed"));
  store.writeCredentialSlot("note-audio-metadata:v1:"+audioId,record.toString());
 }
 /** JSON.stringify's form for these simple records: insertion order, no spaces, no escaped slashes. */
 private static String entry(String id,String noteId,String kind,String title,long deletedAt,String audioId){
  String audio=audioId==null?"":",\"audio\":{\"audioId\":\""+audioId+"\",\"noteId\":\""+noteId+"\"}";
  return "{\"id\":\""+id+"\",\"note\":{\"id\":\""+noteId+"\",\"kind\":\""+kind+"\",\"title\":\""+title+"\",\"body\":\"Body with a / slash\""+audio+"}"+(audioId==null?"":",\"audio\":{\"audioId\":\""+audioId+"\"}")+",\"index\":0,\"deletedAt\":"+deletedAt+"}";
 }
 private void notes(String... audioIds)throws Exception{
  JSONArray records=new JSONArray().put(new JSONObject().put("id","backstop-live").put("kind","text").put("title","Live").put("body",""));
  for(String audioId:audioIds)records.put(new JSONObject().put("id","backstop-live-"+audioId).put("kind","voice").put("title","Shares").put("body","").put("audio",new JSONObject().put("audioId",audioId).put("noteId","backstop-live-"+audioId)));
  JSONObject envelope=new JSONObject().put("version",2).put("collectionId","backstop").put("records",records).put("deleted",new JSONArray());
  store.writeCredentialSlot(AlphaNoteAudioPlugin.NOTES_SLOT,new JSONObject().put("currentRaw",envelope.toString()).toString());
 }

 @Test public void expiredTextAndVoiceEntriesAreErasedAndOthersKeptVerbatim()throws Exception{
  long now=System.currentTimeMillis(),expired=now-3*DAY-60_000,fresh=now-DAY;
  String opText="11111111-1111-4111-8111-111111111111",opVoice="22222222-2222-4222-8222-222222222222",opShared="33333333-3333-4333-8333-333333333333",opFresh="44444444-4444-4444-8444-444444444444",opLive="55555555-5555-4555-8555-555555555555";
  recording("backstop-expired","backstop-voice",opVoice,expired);
  recording("backstop-shared","backstop-shared-note",opShared,expired);
  notes("backstop-shared");
  store.removeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT);
  String keptFresh=entry(opFresh,"backstop-fresh","text","Fresh",fresh,null);
  String keptShared=entry(opShared,"backstop-shared-note","voice","Shared",expired,"backstop-shared");
  String keptLive=entry(opLive,"backstop-live","text","Live again",expired,null);
  String trash="{\"version\":1,\"entries\":["+entry(opText,"backstop-text","text","Expired",expired,null)+","+keptFresh+","+entry(opVoice,"backstop-voice","voice","Voice",expired,"backstop-expired")+","+keptShared+","+keptLive+"]}";
  store.writeCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT,trash);

  assertEquals(2,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
  assertEquals("Kept entries are copied byte for byte","{\"version\":1,\"entries\":["+keptFresh+","+keptShared+","+keptLive+"]}",store.readCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT));
  assertFalse("Expired recording bytes erased",new File(audioDir(),"backstop-expired.audio").exists());
  JSONObject erased=new JSONObject(store.readCredentialSlot("note-audio-metadata:v1:backstop-expired"));
  assertEquals("",erased.getString("transcript"));assertEquals("purged",erased.getJSONObject("deletionOperations").getString(opVoice));
  assertTrue("A recording a saved note references is kept",new File(audioDir(),"backstop-shared.audio").exists());
  assertEquals("Synthetic spoken words",new JSONObject(store.readCredentialSlot("note-audio-metadata:v1:backstop-shared")).getString("transcript"));
  assertEquals("Idempotent",0,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
 }

 @Test public void unreadableStoresAndReviewRowsMakeItANoOp()throws Exception{
  long now=System.currentTimeMillis(),expired=now-3*DAY-60_000;String op="66666666-6666-4666-8666-666666666666";
  recording("backstop-expired","backstop-voice",op,expired);
  String trash="{\"version\":1,\"entries\":["+entry(op,"backstop-voice","voice","Voice",expired,"backstop-expired")+"]}";
  store.writeCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT,trash);
  store.removeCredentialSlot(AlphaNoteAudioPlugin.NOTES_SLOT);
  assertEquals("No saved-notes readback, no purge",0,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
  notes();
  store.writeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT,new JSONObject().put(op,new JSONObject().put("id",op)).toString());
  assertEquals("A deletion under review is never purged",0,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
  assertTrue(new File(audioDir(),"backstop-expired.audio").exists());
  store.writeCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT,"{\"entries\":[],\"version\":1}");
  store.removeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT);
  assertEquals("Unrecognized bytes are left alone",0,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
  assertEquals("{\"entries\":[],\"version\":1}",store.readCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT));
  assertNull(AlphaNoteAudioPlugin.trashEntrySpans("{\"version\":1,\"entries\":[{\"a\":\"]}\"},]}"));
  assertEquals(2,AlphaNoteAudioPlugin.trashEntrySpans("{\"version\":1,\"entries\":[{\"a\":\"},{\\\"\"},{\"b\":[1,{}]}]}").size());
 }
 /** MVP-15: the sweep takes its clock as an argument, so wrong and corrected clocks are exact. */
 @Test public void wrongClocksNeverPurgeEarlyAndTheDeadlineIsExact()throws Exception{
  long deletedAt=System.currentTimeMillis()-DAY;String opText="77777777-7777-4777-8777-777777777777",opVoice="88888888-8888-4888-8888-888888888888";
  recording("backstop-expired","backstop-voice",opVoice,deletedAt);
  notes();
  store.removeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT);
  String trash="{\"version\":1,\"entries\":["+entry(opText,"backstop-text","text","Clock",deletedAt,null)+","+entry(opVoice,"backstop-voice","voice","Voice",deletedAt,"backstop-expired")+"]}";
  store.writeCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT,trash);
  // A clock moved backwards (even before the deletion) and one millisecond before the deadline.
  for(long now:new long[]{deletedAt-10*DAY,1L,deletedAt,deletedAt+3*DAY-1}){
   assertEquals(0,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
   assertEquals("deletedAt is never rewritten",trash,store.readCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT));
   assertTrue(new File(audioDir(),"backstop-expired.audio").exists());
  }
  // Exactly three days after deletion both entries go, the recording with its own operation.
  assertEquals(2,AlphaNoteAudioPlugin.sweepExpiredTrash(context,deletedAt+3*DAY));
  assertEquals("{\"version\":1,\"entries\":[]}",store.readCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT));
  assertFalse(new File(audioDir(),"backstop-expired.audio").exists());
  assertEquals("purged",new JSONObject(store.readCredentialSlot("note-audio-metadata:v1:backstop-expired")).getJSONObject("deletionOperations").getString(opVoice));
 }

 /** MVP-15: process death after the recording erase but before the Trash row was removed converges. */
 @Test public void anEraseInterruptedBeforeItsRowWasRemovedIsCompletedOnce()throws Exception{
  long now=System.currentTimeMillis(),expired=now-3*DAY-60_000;String op="99999999-9999-4999-8999-999999999999";
  // The state a killed process leaves: bytes gone, receipt purged, row still present.
  JSONObject record=new JSONObject().put("audioId","backstop-expired").put("noteId","backstop-voice").put("durationMs",1000).put("createdAt",expired-1000).put("mimeType","audio/mp4")
   .put("transcript","").put("deletedAt",expired).put("activeDeletionOperation",op).put("deletionOperations",new JSONObject().put(op,"purged"));
  store.writeCredentialSlot("note-audio-metadata:v1:backstop-expired",record.toString());
  notes();
  store.removeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT);
  store.writeCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT,"{\"version\":1,\"entries\":["+entry(op,"backstop-voice","voice","Voice",expired,"backstop-expired")+"]}");
  assertEquals(1,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
  assertEquals("{\"version\":1,\"entries\":[]}",store.readCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT));
  assertEquals("The receipt is unchanged",record.toString(),new JSONObject(store.readCredentialSlot("note-audio-metadata:v1:backstop-expired")).toString());
  assertEquals("Idempotent",0,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
 }

 /** MVP-15: a permanent deletion under review (no Trash entry) leaves the sweep with nothing to erase. */
 @Test public void aPermanentDeletionUnderReviewIsNeverSweptThroughAnotherEntry()throws Exception{
  long now=System.currentTimeMillis(),expired=now-3*DAY-60_000;String stale="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",permanent="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  // The recording is in the audio trash under the permanent operation; an older Trash row names another operation.
  recording("backstop-expired","backstop-voice",permanent,expired);
  notes();
  store.writeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT,new JSONObject().put(permanent,new JSONObject().put("id",permanent).put("permanent",true)).toString());
  String trash="{\"version\":1,\"entries\":["+entry(stale,"backstop-voice","voice","Voice",expired,"backstop-expired")+"]}";
  store.writeCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT,trash);
  assertEquals("Only the operation that owns the audio trash may erase it",0,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now));
  assertEquals(trash,store.readCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT));
  assertTrue(new File(audioDir(),"backstop-expired.audio").exists());
  assertEquals("Synthetic spoken words",new JSONObject(store.readCredentialSlot("note-audio-metadata:v1:backstop-expired")).getString("transcript"));
 }
 // ---- MVP-15: native backstop for an interrupted permanent voice deletion (no Trash entry) ----
 private static final String REVISION="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",OTHER_REVISION="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",SOURCE_REVISION="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
 /** One recovery-row member in JSON.stringify's form: the renderer's AudioDeletion, keyed by its operation id. */
 private static String pendingRow(String operation,String noteId,String audioId,boolean permanent,boolean requested){
  return "\""+operation+"\":{\"id\":\""+operation+"\",\"target\":{\"sourceId\":\"backstop\",\"sourceRevision\":\""+SOURCE_REVISION+"\",\"noteId\":\""+noteId+"\",\"revision\":\""+REVISION+"\"},"
   +"\"note\":{\"id\":\""+noteId+"\",\"kind\":\"voice\",\"title\":\"Voice, \\\"quoted\\\" {}\",\"body\":\"Body with a / slash\",\"audio\":{\"audioId\":\""+audioId+"\",\"noteId\":\""+noteId+"\"}},\"audioId\":\""+audioId+"\""
   +(permanent?",\"permanent\":true":"")+(requested?",\"audioRequested\":true":"")+"}";
 }
 private void pending(String... rows)throws Exception{store.writeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT,"{"+String.join(",",rows)+"}");}
 private String pendingRaw()throws Exception{return store.readCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT);}
 private static JSONObject tombstone(String noteId,String revision,String operation)throws Exception{return new JSONObject().put("id",noteId).put("revision",revision).put("operationId",operation);}
 /** Saved Notes with one unrelated live note, the given tombstones and optional extra saved records. */
 private void savedNotes(String collection,JSONArray tombstones,JSONObject... extra)throws Exception{
  JSONArray records=new JSONArray().put(new JSONObject().put("id","backstop-live").put("kind","text").put("title","Live").put("body",""));
  for(JSONObject record:extra)records.put(record);
  JSONObject envelope=new JSONObject().put("version",2).put("collectionId",collection).put("records",records).put("deleted",tombstones);
  store.writeCredentialSlot(AlphaNoteAudioPlugin.NOTES_SLOT,new JSONObject().put("currentRaw",envelope.toString()).toString());
 }
 private static JSONObject voiceNote(String noteId,String audioId)throws Exception{return new JSONObject().put("id",noteId).put("kind","voice").put("title","Saved").put("body","").put("audio",new JSONObject().put("audioId",audioId).put("noteId",noteId));}
 /** A playable recording that no deletion has touched. */
 private void liveRecording(String audioId,String noteId)throws Exception{
  try(FileOutputStream out=new FileOutputStream(new File(audioDir(),audioId+".audio"))){out.write("synthetic".getBytes(StandardCharsets.UTF_8));}
  store.writeCredentialSlot("note-audio-metadata:v1:"+audioId,new JSONObject().put("audioId",audioId).put("noteId",noteId).put("durationMs",1000).put("createdAt",1000).put("mimeType","audio/mp4").put("transcript","Synthetic spoken words").toString());
 }
 private String metadataRaw(String audioId)throws Exception{return store.readCredentialSlot("note-audio-metadata:v1:"+audioId);}
 private boolean bytesExist(String audioId){return new File(audioDir(),audioId+".audio").exists();}

 /** Process death after the tombstone commit, before the recording was moved: the recording is erased for that note only. */
 @Test public void aPermanentDeletionCutAfterItsTombstoneIsFinishedForThatRecordingOnly()throws Exception{
  long now=System.currentTimeMillis();String op="c1111111-1111-4111-8111-111111111111",review="c2222222-2222-4222-8222-222222222222";
  liveRecording("backstop-expired","backstop-voice");
  liveRecording("backstop-shared","backstop-shared-note");
  // A second deletion, not permanent, is under the renderer's review: its row and recording must not change.
  String reviewRow=pendingRow(review,"backstop-shared-note","backstop-shared",false,true);
  pending(pendingRow(op,"backstop-voice","backstop-expired",true,false),reviewRow);
  savedNotes("backstop",new JSONArray().put(tombstone("backstop-voice",REVISION,op)).put(tombstone("backstop-shared-note",REVISION,review)));
  String sharedBefore=metadataRaw("backstop-shared");
  store.removeCredentialSlot(AlphaNoteAudioPlugin.NOTES_TRASH_SLOT);

  assertEquals(1,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
  assertEquals("The other row is copied byte for byte","{"+reviewRow+"}",pendingRaw());
  assertFalse("Recording bytes erased",bytesExist("backstop-expired"));
  JSONObject erased=new JSONObject(metadataRaw("backstop-expired"));
  assertEquals("",erased.getString("transcript"));assertEquals("backstop-voice",erased.getString("noteId"));
  assertEquals(now,erased.getLong("deletedAt"));assertEquals(op,erased.getString("activeDeletionOperation"));
  assertEquals(1,erased.getJSONObject("deletionOperations").length());assertEquals("purged",erased.getJSONObject("deletionOperations").getString(op));
  assertTrue("A recording under review is kept",bytesExist("backstop-shared"));
  assertEquals(sharedBefore,metadataRaw("backstop-shared"));
  assertEquals("Idempotent",0,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
  assertEquals("{"+reviewRow+"}",pendingRaw());
  // No Trash entry exists for a permanent deletion, so the expiry sweep has nothing to do either way.
  assertEquals(0,AlphaNoteAudioPlugin.sweepExpiredTrash(context,now+10*DAY));
 }

 /** Process death after the move to the audio trash, or after the erase: finished once, receipts exact. */
 @Test public void aPermanentDeletionCutAfterTheAudioTrashOrAfterTheEraseIsFinishedOnce()throws Exception{
  long now=System.currentTimeMillis(),movedAt=now-60_000;String op="c3333333-3333-4333-8333-333333333333";
  recording("backstop-expired","backstop-voice",op,movedAt);
  pending(pendingRow(op,"backstop-voice","backstop-expired",true,true));
  savedNotes("backstop",new JSONArray().put(tombstone("backstop-voice",REVISION,op)));
  assertEquals(1,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
  assertEquals("{}",pendingRaw());
  assertFalse(bytesExist("backstop-expired"));
  JSONObject erased=new JSONObject(metadataRaw("backstop-expired"));
  assertEquals("",erased.getString("transcript"));assertEquals("The audio-trash time is not rewritten",movedAt,erased.getLong("deletedAt"));
  assertEquals("purged",erased.getJSONObject("deletionOperations").getString(op));
  assertEquals(0,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));

  // Death after the erase, before the row was retired: only the row goes.
  String purged=metadataRaw("backstop-expired");
  pending(pendingRow(op,"backstop-voice","backstop-expired",true,true));
  assertEquals(1,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
  assertEquals("{}",pendingRaw());
  assertEquals("The receipt is unchanged",purged,metadataRaw("backstop-expired"));
 }

 /** Exact ownership: every state in which the note or the recording is not provably this deletion's is left untouched. */
 @Test public void aPermanentDeletionIsNeverFinishedWithoutExactNoteAndRecordingOwnership()throws Exception{
  long now=System.currentTimeMillis();String op="c4444444-4444-4444-8444-444444444444",other="c5555555-5555-4555-8555-555555555555";
  String row=pendingRow(op,"backstop-voice","backstop-expired",true,false);
  JSONArray own=new JSONArray().put(tombstone("backstop-voice",REVISION,op));
  String[] cases={"no tombstone: death before the commit is the renderer's rollback","note saved again","another saved note references the recording","tombstone of another operation",
   "tombstone of another revision","another collection","recording names another note","restore already started","another deletion holds the audio trash","row is not permanent","row id differs from its key","recording metadata missing"};
  for(String name:cases){
   liveRecording("backstop-expired","backstop-voice");
   savedNotes("backstop",own);
   String pendingBytes="{"+row+"}";
   switch(name){
    case "no tombstone: death before the commit is the renderer's rollback":savedNotes("backstop",new JSONArray());break;
    case "note saved again":savedNotes("backstop",own,voiceNote("backstop-voice","backstop-expired"));break;
    case "another saved note references the recording":savedNotes("backstop",own,voiceNote("backstop-adopter","backstop-expired"));break;
    case "tombstone of another operation":savedNotes("backstop",new JSONArray().put(tombstone("backstop-voice",REVISION,other)));break;
    case "tombstone of another revision":savedNotes("backstop",new JSONArray().put(tombstone("backstop-voice",OTHER_REVISION,op)));break;
    case "another collection":savedNotes("backstop-reset",own);break;
    case "recording names another note":liveRecording("backstop-expired","backstop-other-note");break;
    case "restore already started":store.writeCredentialSlot("note-audio-metadata:v1:backstop-expired",new JSONObject(metadataRaw("backstop-expired")).put("deletionOperations",new JSONObject().put(op,"restored")).toString());break;
    case "another deletion holds the audio trash":recording("backstop-expired","backstop-voice",other,now-60_000);break;
    case "row is not permanent":pendingBytes="{"+pendingRow(op,"backstop-voice","backstop-expired",false,true)+"}";break;
    case "row id differs from its key":pendingBytes="{"+row.replaceFirst("\"id\":\""+op+"\"","\"id\":\""+other+"\"")+"}";break;
    case "recording metadata missing":store.removeCredentialSlot("note-audio-metadata:v1:backstop-expired");break;
    default:fail(name);
   }
   store.writeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT,pendingBytes);
   String metadataBefore=metadataRaw("backstop-expired");
   assertEquals(name,0,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
   assertEquals(name+": the row stays for review, byte for byte",pendingBytes,pendingRaw());
   assertTrue(name+": recording bytes kept",bytesExist("backstop-expired"));
   assertEquals(name+": recording metadata unchanged",metadataBefore,metadataRaw("backstop-expired"));
  }
 }

 /** Unreadable or unrecognized stores make the permanent-deletion pass a no-op; rows are split only at top level. */
 @Test public void unreadableStoresMakeThePermanentDeletionPassANoOp()throws Exception{
  long now=System.currentTimeMillis();String op="c6666666-6666-4666-8666-666666666666";
  liveRecording("backstop-expired","backstop-voice");
  String row=pendingRow(op,"backstop-voice","backstop-expired",true,false);
  store.removeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT);
  savedNotes("backstop",new JSONArray().put(tombstone("backstop-voice",REVISION,op)));
  assertEquals("No recovery rows",0,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
  pending(row);
  store.removeCredentialSlot(AlphaNoteAudioPlugin.NOTES_SLOT);
  assertEquals("No saved-notes readback, no erase",0,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
  assertEquals("{"+row+"}",pendingRaw());assertTrue(bytesExist("backstop-expired"));
  savedNotes("backstop",new JSONArray().put(tombstone("backstop-voice",REVISION,op)));
  for(String unrecognized:new String[]{"[]","{ "+row+"}","{"+row+",}","{\"a\":1}","{"+row+",\"b\":[]}"}){
   // The secure store parses a slot value before it holds it, so text that is not JSON never
   // reaches the slot on a phone (measured on the API 36 emulator: the write of "{row,}" throws).
   // That refusal is the property for such a value; the slot keeps what it held and the pass still erases nothing.
   String held=pendingRaw();
   try{store.writeCredentialSlot(AlphaNoteAudioPlugin.PENDING_AUDIO_SLOT,unrecognized);}
   catch(org.json.JSONException refused){
    try{new org.json.JSONTokener(unrecognized).nextValue();fail("The store refused a value that parses: "+unrecognized);}catch(org.json.JSONException malformed){/* Expected: only unparseable text is refused. */}
    assertEquals(unrecognized,held,pendingRaw());
    assertEquals(unrecognized,0,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
    assertEquals(unrecognized,held,pendingRaw());assertTrue(bytesExist("backstop-expired"));
    continue;
   }
   assertEquals(unrecognized,0,AlphaNoteAudioPlugin.finishPermanentDeletions(context,now));
   assertEquals(unrecognized,pendingRaw());assertTrue(bytesExist("backstop-expired"));
  }
  assertNull(AlphaNoteAudioPlugin.pendingMemberSpans("[]"));
  assertNull(AlphaNoteAudioPlugin.pendingMemberSpans("{\"a\":{},}"));
  assertNull(AlphaNoteAudioPlugin.pendingMemberSpans("{\"a\":\"}\"}"));
  assertEquals(0,AlphaNoteAudioPlugin.pendingMemberSpans("{}").size());
  // Commas, braces and escaped quotes inside a row's strings never split it.
  java.util.List<String> spans=AlphaNoteAudioPlugin.pendingMemberSpans("{"+row+","+pendingRow("c7777777-7777-4777-8777-777777777777","n","a",false,false)+"}");
  assertEquals(2,spans.size());assertEquals(row,spans.get(0));
 }
}
