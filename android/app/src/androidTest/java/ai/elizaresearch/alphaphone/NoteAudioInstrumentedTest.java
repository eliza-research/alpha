package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.*;
import java.io.*;
import java.nio.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real native private storage, MediaPlayer, bridge and recreation. No account or network request. */
@RunWith(AndroidJUnit4.class)
public class NoteAudioInstrumentedTest {
 private static JSONObject call(String expression)throws Exception {
  NotesSecureFixture.evaluate("window.__noteAudioResult=null;Promise.resolve("+expression+").then(x=>window.__noteAudioResult=JSON.stringify(x||{})).catch(()=>window.__noteAudioResult=JSON.stringify({error:true}))");
  for(int i=0;i<200;i++){String raw=NotesSecureFixture.evaluate("window.__noteAudioResult");if(!"null".equals(raw))return new JSONObject((String)new JSONTokener(raw).nextValue());SystemClock.sleep(50);}throw new AssertionError("Note audio call timed out");
 }
 private static void ready()throws Exception {for(int i=0;i<100;i++){if("true".equals(NotesSecureFixture.evaluate("Boolean(window.Capacitor?.Plugins?.AlphaNoteAudio)")))return;SystemClock.sleep(100);}fail("Note audio bridge unavailable");}
 private static void until(String expression)throws Exception {for(int i=0;i<200;i++){if("true".equals(NotesSecureFixture.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(50);}fail("Voice note UI did not reach expected state: "+expression);}
 private static byte[] wav(){int n=16000;ByteBuffer b=ByteBuffer.allocate(44+n*2).order(ByteOrder.LITTLE_ENDIAN);b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36+n*2).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(n*2);return b.array();}
 private static AlphaNoteAudioPlugin plugin(){for(android.app.Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED))if(activity instanceof MainActivity)return (AlphaNoteAudioPlugin)((MainActivity)activity).getBridge().getPlugin("AlphaNoteAudio").getInstance();throw new IllegalStateException();}
 @Test public void savedAudioSurvivesDraftRemovalRecreationAndUndo()throws Exception {
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String audioId=UUID.randomUUID().toString(),noteId=UUID.randomUUID().toString();File fixture=File.createTempFile("synthetic-note-",".wav",context.getCacheDir());java.nio.file.Files.write(fixture.toPath(),wav());String input="{audioId:"+JSONObject.quote(audioId)+",noteId:"+JSONObject.quote(noteId)+",operationId:\"11111111-1111-4111-8111-111111111111\"}";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();AtomicReference<JSONObject> saved=new AtomicReference<>();BoundedActivityScenario.main(()->{try{saved.set(plugin().retain(fixture,audioId,noteId,2000,"Edited synthetic transcript"));}catch(Exception e){throw new RuntimeException(e);}});
   assertEquals("Edited synthetic transcript",saved.get().getString("transcript"));assertFalse(saved.get().has("path"));assertTrue(fixture.delete());
   JSONObject started=call("Capacitor.Plugins.AlphaNoteAudio.play("+input+")");assertFalse(started.has("error"));assertEquals(audioId,started.getString("audioId"));assertTrue("Native MediaPlayer acknowledged actual playback start",started.getBoolean("playing"));
   scenario.recreate();ready();assertFalse(call("Capacitor.Plugins.AlphaNoteAudio.state()").getBoolean("playing"));assertEquals("Edited synthetic transcript",call("Capacitor.Plugins.AlphaNoteAudio.describe("+input+")").getString("transcript"));
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.remove({audioId:"+JSONObject.quote(audioId)+",noteId:'wrong-note'})").has("error"));
   assertFalse(call("Capacitor.Plugins.AlphaNoteAudio.remove("+input+")").has("error"));assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.play("+input+")").has("error"));
   scenario.recreate();ready();assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.play("+input+")").has("error"));
   assertFalse(call("Capacitor.Plugins.AlphaNoteAudio.restore("+input+")").has("error"));assertFalse(call("Capacitor.Plugins.AlphaNoteAudio.play("+input+")").has("error"));call("Capacitor.Plugins.AlphaNoteAudio.stop()");
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.describe({audioId:'../escape'})").has("error"));
  }finally{fixture.delete();for(String suffix:new String[]{".audio",".json",".json.bak",".pending"})new File(context.getNoBackupFilesDir(),"note-audio/"+audioId+suffix).delete();}
 }
 @Test public void actualNativeCaptureSaveAndDraftRevocationDoNotDeleteSavedAudio()throws Exception {
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.RECORD_AUDIO);String recording=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();JSONObject started=call("Capacitor.Plugins.AlphaVoiceCloud.startRecording()");assertFalse(started.has("error"));recording=started.getString("recordingId");SystemClock.sleep(1200);assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.stopRecording()").has("error"));String request="{recordingId:"+JSONObject.quote(recording)+",noteId:'native-capture-fixture',transcript:'Manually edited fixture transcript; no transcription request'}";
   JSONObject saved=call("Capacitor.Plugins.AlphaVoiceCloud.saveRecording("+request+")");assertEquals(recording,saved.getString("audioId"));assertFalse(call("Capacitor.Plugins.AlphaVoiceCloud.cancelRecording()").has("error"));assertTrue(call("Capacitor.Plugins.AlphaVoiceCloud.saveRecording("+request+")").has("error"));
   scenario.recreate();ready();String key="{audioId:"+JSONObject.quote(recording)+"}";assertEquals("native-capture-fixture",call("Capacitor.Plugins.AlphaNoteAudio.describe("+key+")").getString("noteId"));assertFalse(call("Capacitor.Plugins.AlphaNoteAudio.play("+key+")").has("error"));call("Capacitor.Plugins.AlphaNoteAudio.stop()");
   // Restore the real durable asset into the prototype note shape, then exercise its visible player.
   String note=new JSONObject().put("id","native-capture-fixture").put("kind","voice").put("title","Native recording fixture").put("body",saved.getString("transcript")).put("audio",saved).put("dur",saved.getLong("durationMs")/1000.0).put("summary",new JSONArray()).put("actions",new JSONArray()).put("lines",new JSONArray().put(new JSONObject().put("s","me").put("at",0).put("t",saved.getString("transcript")))).put("when","Fixture").put("pinned",false).toString();
   NotesSecureFixture.replaceRecords("records=>["+note+",...records.filter(n=>n.id!=='native-capture-fixture')]");
   scenario.recreate();ready();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"));until("document.querySelector('button[aria-label=\"Open Native recording fixture\"]')");NotesSecureFixture.evaluate("document.querySelector('button[aria-label=\"Open Native recording fixture\"]').click()");until("document.querySelector('button[aria-label=\"Play recording\"]')");
   assertEquals("true",NotesSecureFixture.evaluate("document.body.innerText.includes('Manually edited fixture transcript; no transcription request')"));observePlaybackStart();NotesSecureFixture.evaluate("document.querySelector('button[aria-label=\"Play recording\"]').click()");requirePlaybackStart(recording);
   NotesSecureFixture.evaluate("window.dispatchEvent(new Event('alpha-back'))");awaitPlaybackStopped();
   NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.id!=='native-capture-fixture')");

  }finally{if(recording!=null)for(String suffix:new String[]{".audio",".json",".json.bak",".pending"})new File(context.getNoBackupFilesDir(),"note-audio/"+recording+suffix).delete();}
 }
 // Capture the native start acknowledgement before clicking: short real recordings may finish
 // before a second instrumentation round trip, especially on the launcher distribution.
 private static void awaitPlaybackStopped()throws Exception {for(int i=0;i<100;i++){if(!call("Capacitor.Plugins.AlphaNoteAudio.state()").getBoolean("playing"))return;SystemClock.sleep(50);}fail("Native playback did not stop after leaving note");}
 private static void observePlaybackStart()throws Exception {assertFalse(call("(async()=>{await window.__noteAudioStartedListener?.remove();window.__noteAudioStarted=null;window.__noteAudioStartedListener=await Capacitor.Plugins.AlphaNoteAudio.addListener('started',value=>{window.__noteAudioStarted=value;});return {};})()").has("error"));}
 private static void requirePlaybackStart(String audioId)throws Exception {until("window.__noteAudioStarted?.audioId==="+JSONObject.quote(audioId)+"&&window.__noteAudioStarted.playing===true");call("window.__noteAudioStartedListener.remove()");}
 private static void chooseManualRecording()throws Exception{
  String button="[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Record without transcription'&&e.getClientRects().length&&!e.disabled)";
  until(button);NotesSecureFixture.evaluate("("+button+").click()");
 }
 private static void click(String label)throws Exception{String b="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(b+"&&!"+b+".disabled");NotesSecureFixture.evaluate(b+".click()");}
 @Test public void dictationReplacesSelectionAndKeepsTextNoteAcrossRecreation()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.RECORD_AUDIO);
  String title="Dictation selection "+UUID.randomUUID(),expected="Before inserted after";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();String original=NotesSecureFixture.evaluate("localStorage.getItem('alpha.connection.selection.v1')");
   try{
    NotesSecureFixture.evaluate("localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}))");scenario.recreate();ready();AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"));until("window.__alphaTestNavigation?.status==='complete'");click("New note");
    fillEditor("Title",title);fillEditor("Note","Before OLD after");
    String saved="__notesEnvelope.records.find(n=>n.title==="+JSONObject.quote(title)+")";until(saved+"?.body==='Before OLD after'");
    NotesSecureFixture.evaluate("(()=>{const t=document.querySelector('textarea[aria-label=\"Note\"]');t.focus();t.setSelectionRange(7,10);})()");
    click("Dictate");chooseManualRecording();click("Start recording");SystemClock.sleep(1300);click("Stop recording");click("Review recording");fillEditor("Review transcript","inserted");click("Apply transcript");
    until("document.querySelector('textarea[aria-label=\"Note\"]')?.value==="+JSONObject.quote(expected));
    until("document.querySelector('textarea[aria-label=\"Note\"]')?.selectionStart===15");
    JSONObject note=new JSONObject((String)new JSONTokener(NotesSecureFixture.evaluate("JSON.stringify("+saved+")")).nextValue());assertEquals("text",note.getString("kind"));assertEquals(expected,note.getString("body"));assertFalse("Dictating text must not create a saved voice asset",note.has("audio"));
    scenario.recreate();ready();AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"));click("Open "+title);
    until("document.querySelector('textarea[aria-label=\"Note\"]')?.value==="+JSONObject.quote(expected));assertEquals("false",NotesSecureFixture.evaluate("Boolean(document.querySelector('button[aria-label=\"Play recording\"]'))"));
   }finally{
    NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.title!=="+JSONObject.quote(title)+")");
    NotesSecureFixture.evaluate("(()=>{const value="+original+";if(value===null)localStorage.removeItem('alpha.connection.selection.v1');else localStorage.setItem('alpha.connection.selection.v1',value);})()");
   }
  }
 }
 private static void fillEditor(String label,String value)throws Exception{
  String selector="document.querySelector('input[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+'],textarea[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(selector);
  NotesSecureFixture.evaluate("(()=>{const e="+selector+";Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");
 }
 @Test public void offlineNotesUiRecordsManualTranscriptAndSavesActualAudio()throws Exception{
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.RECORD_AUDIO);
  String audioId=null,noteId=null,transcript="Manual offline transcript "+UUID.randomUUID();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();String original=NotesSecureFixture.evaluate("localStorage.getItem('alpha.connection.selection.v1')");
   try{
    NotesSecureFixture.evaluate("localStorage.setItem('alpha.connection.selection.v1',JSON.stringify({kind:'offline'}))");scenario.recreate();ready();AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"));
    click("Record and transcribe");chooseManualRecording();click("Start recording");until("document.querySelector('button[aria-label=\"Stop recording\"]')");SystemClock.sleep(1300);click("Stop recording");click("Review recording");until("document.querySelector('textarea[aria-label=\"Review transcript\"]')");
    NotesSecureFixture.evaluate("(()=>{const t=document.querySelector('textarea[aria-label=\"Review transcript\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,"+JSONObject.quote(transcript)+");t.dispatchEvent(new Event('input',{bubbles:true}));t.dispatchEvent(new Event('change',{bubbles:true}));})()");click("Save note");
    String saved="__notesEnvelope.records.find(n=>n.body==="+JSONObject.quote(transcript)+")";until(saved+"?.audio?.audioId");
    JSONObject note=new JSONObject((String)new JSONTokener(NotesSecureFixture.evaluate("JSON.stringify("+saved+")")).nextValue());audioId=note.getJSONObject("audio").getString("audioId");noteId=note.getString("id");assertEquals("voice",note.getString("kind"));assertEquals(transcript,call("Capacitor.Plugins.AlphaNoteAudio.describe({audioId:"+JSONObject.quote(audioId)+"})").getString("transcript"));
    scenario.recreate();ready();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"));click("Open Voice note");until("document.body.innerText.includes("+JSONObject.quote(transcript)+")");observePlaybackStart();click("Play recording");requirePlaybackStart(audioId);call("Capacitor.Plugins.AlphaNoteAudio.stop()");
   }finally{
    if(noteId!=null)NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.id!=="+JSONObject.quote(noteId)+")");
    NotesSecureFixture.evaluate("(()=>{const value="+original+";if(value===null)localStorage.removeItem('alpha.connection.selection.v1');else localStorage.setItem('alpha.connection.selection.v1',value);})()");
   }
  }finally{if(audioId!=null)for(String suffix:new String[]{".audio",".json",".json.bak",".pending"})new File(context.getNoBackupFilesDir(),"note-audio/"+audioId+suffix).delete();}
 }


 @Test public void expiredOwnedDeletionCannotRestoreBeforeMigration()throws Exception {
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  String audioId=UUID.randomUUID().toString(),noteId=UUID.randomUUID().toString(),operation=UUID.randomUUID().toString();
  File fixture=File.createTempFile("audio-expiry-",".wav",context.getCacheDir());java.nio.file.Files.write(fixture.toPath(),wav());
  String input=new JSONObject().put("audioId",audioId).put("noteId",noteId).put("operationId",operation).toString();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();BoundedActivityScenario.main(()->{try{plugin().retain(fixture,audioId,noteId,2000,"Synthetic retention fixture");}catch(Exception e){throw new RuntimeException(e);}});
   assertEquals("removed",call("Capacitor.Plugins.AlphaNoteAudio.remove("+input+")").getString("status"));
   // Age the durable tombstone while the activity remains alive: expiry must
   // hold even before the next startup migration removes the audio bytes.
   BoundedActivityScenario.main(()->{try{AlphaConnectionPlugin storage=(AlphaConnectionPlugin)plugin().getBridge().getPlugin("AlphaConnection").getInstance();String slot="note-audio-metadata:v1:"+audioId;JSONObject record=new JSONObject(storage.readCredentialSlot(slot));record.put("deletedAt",System.currentTimeMillis()-31L*24*60*60*1000);storage.writeCredentialSlot(slot,record.toString());}catch(Exception e){throw new RuntimeException(e);}});
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.restore("+input+")").has("error"));
   assertEquals("removed",call("Capacitor.Plugins.AlphaNoteAudio.deletionStatus("+input+")").getString("status"));
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.play("+input+")").has("error"));
  }finally{fixture.delete();new AlphaCredentialStore(context).removeCredentialSlot("note-audio-metadata:v1:"+audioId);for(String suffix:new String[]{".audio",".json",".json.bak",".pending"})new File(context.getNoBackupFilesDir(),"note-audio/"+audioId+suffix).delete();}
 }
 /** Notes Trash expiry / Delete forever: only the owning deletion erases bytes and transcript, idempotently, and never a live recording. */
 @Test public void purgeErasesOnlyTheOwningDeletionAndCannotBeRestored()throws Exception {
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  String audioId=UUID.randomUUID().toString(),noteId=UUID.randomUUID().toString(),operation=UUID.randomUUID().toString(),other=UUID.randomUUID().toString();
  File fixture=File.createTempFile("audio-purge-",".wav",context.getCacheDir());java.nio.file.Files.write(fixture.toPath(),wav());
  String input=new JSONObject().put("audioId",audioId).put("noteId",noteId).put("operationId",operation).toString();
  String foreign=new JSONObject().put("audioId",audioId).put("noteId",noteId).put("operationId",other).toString();
  String wrongNote=new JSONObject().put("audioId",audioId).put("noteId","wrong-note").put("operationId",operation).toString();
  File bytes=new File(context.getNoBackupFilesDir(),"note-audio/"+audioId+".audio");
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();BoundedActivityScenario.main(()->{try{plugin().retain(fixture,audioId,noteId,2000,"Synthetic purge transcript");}catch(Exception e){throw new RuntimeException(e);}});
   // A live (not trashed) recording is never erased.
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.purge("+input+")").has("error"));assertTrue(bytes.isFile());
   assertEquals("removed",call("Capacitor.Plugins.AlphaNoteAudio.remove("+input+")").getString("status"));
   // Another operation, or a different note, cannot erase this deletion's recording.
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.purge("+foreign+")").has("error"));
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.purge("+wrongNote+")").has("error"));
   assertTrue(bytes.isFile());assertEquals("Synthetic purge transcript",call("Capacitor.Plugins.AlphaNoteAudio.describe("+input+")").getString("transcript"));
   JSONObject purged=call("Capacitor.Plugins.AlphaNoteAudio.purge("+input+")");
   assertEquals("purged",purged.getString("status"));assertEquals(operation,purged.getString("operationId"));assertEquals(audioId,purged.getString("audioId"));
   assertFalse(bytes.exists());assertEquals("",call("Capacitor.Plugins.AlphaNoteAudio.describe("+input+")").getString("transcript"));
   // Idempotent across recreation; erased audio cannot be restored, re-deleted into a new owner, or played.
   scenario.recreate();ready();
   assertEquals("purged",call("Capacitor.Plugins.AlphaNoteAudio.purge("+input+")").getString("status"));
   assertEquals("purged",call("Capacitor.Plugins.AlphaNoteAudio.deletionStatus("+input+")").getString("status"));
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.restore("+input+")").has("error"));
   assertEquals("purged",call("Capacitor.Plugins.AlphaNoteAudio.remove("+input+")").getString("status"));
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.play("+input+")").has("error"));
  }finally{fixture.delete();new AlphaCredentialStore(context).removeCredentialSlot("note-audio-metadata:v1:"+audioId);for(String suffix:new String[]{".audio",".json",".json.bak",".pending"})new File(context.getNoBackupFilesDir(),"note-audio/"+audioId+suffix).delete();}
 }
 @Test public void optInRetiredDeletionCannotArriveAfterReloadAndRestore()throws Exception {
  org.junit.Assume.assumeTrue("Explicit native audio fence fixture opt-in", "true".equals(InstrumentationRegistry.getArguments().getString("audioFence")));
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();String audioId=UUID.randomUUID().toString(),noteId=UUID.randomUUID().toString(),operation=UUID.randomUUID().toString();
  File fixture=File.createTempFile("audio-fence-",".wav",context.getCacheDir());java.nio.file.Files.write(fixture.toPath(),wav());String input="{audioId:"+JSONObject.quote(audioId)+",noteId:"+JSONObject.quote(noteId)+",operationId:"+JSONObject.quote(operation)+"}";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   ready();BoundedActivityScenario.main(()->{try{plugin().retain(fixture,audioId,noteId,2000,"Synthetic fence fixture");}catch(Exception e){throw new RuntimeException(e);}});
   // Prior app versions wrote deletedAt without an operation owner. Explicit restore
   // may retire that legacy tombstone; delete must never adopt it into a new operation.
   BoundedActivityScenario.main(()->{try{AlphaConnectionPlugin storage=(AlphaConnectionPlugin)plugin().getBridge().getPlugin("AlphaConnection").getInstance();String slot="note-audio-metadata:v1:"+audioId;JSONObject legacy=new JSONObject(storage.readCredentialSlot(slot));legacy.put("deletedAt",System.currentTimeMillis());storage.writeCredentialSlot(slot,legacy.toString());}catch(Exception e){throw new RuntimeException(e);}});
   assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.remove("+input+")").has("error"));
   JSONObject legacy=call("Capacitor.Plugins.AlphaNoteAudio.describe("+input+")");assertTrue(legacy.has("deletedAt"));assertFalse(legacy.has("deletionOperations"));
   // Explicit restore retires the operation before its delayed remove reaches native.
   assertEquals("restored",call("Capacitor.Plugins.AlphaNoteAudio.restore("+input+")").getString("status"));
   scenario.recreate();ready();JSONObject late=call("Capacitor.Plugins.AlphaNoteAudio.remove("+input+")");assertEquals("restored",late.getString("status"));assertEquals(operation,late.getString("operationId"));assertFalse(call("Capacitor.Plugins.AlphaNoteAudio.describe("+input+")").has("deletedAt"));
   assertEquals("restored",call("Capacitor.Plugins.AlphaNoteAudio.deletionStatus("+input+")").getString("status"));
   String second=input.replace(operation,UUID.randomUUID().toString());assertEquals("removed",call("Capacitor.Plugins.AlphaNoteAudio.remove("+second+")").getString("status"));
   scenario.recreate();ready();assertEquals("restored",call("Capacitor.Plugins.AlphaNoteAudio.restore("+input+")").getString("status"));assertTrue(call("Capacitor.Plugins.AlphaNoteAudio.describe("+input+")").has("deletedAt"));assertEquals("restored",call("Capacitor.Plugins.AlphaNoteAudio.restore("+second+")").getString("status"));
  }finally{fixture.delete();for(String suffix:new String[]{".audio",".json",".json.bak",".pending"})new File(context.getNoBackupFilesDir(),"note-audio/"+audioId+suffix).delete();}
 }
}
