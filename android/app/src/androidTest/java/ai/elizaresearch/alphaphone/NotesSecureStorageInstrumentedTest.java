package ai.elizaresearch.alphaphone;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
/** Real renderer edits -> Capacitor -> Keystore storage -> activity reconstruction.
 * Opt-in disposable qualification device only; uses unique synthetic content. */
public final class NotesSecureStorageInstrumentedTest {
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void until(String code)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}throw new AssertionError("Notes secure fixture not ready");}
 private void click(String label)throws Exception{String code="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==="+JSONObject.quote(label)+"&&b.getClientRects().length&&!b.disabled)";until(code);js("("+code+").click()");}
 private JSONObject saved()throws Exception{js("window.__notesSecureRead=null;Capacitor.Plugins.AlphaConnection.secureRead({slot:'notes-records:v1:device'}).then(v=>window.__notesSecureRead=v.value,()=>window.__notesSecureRead='ERROR')");until("window.__notesSecureRead!==null");return new JSONObject((String)new JSONTokener(js("window.__notesSecureRead")).nextValue());}
 private JSONObject envelope()throws Exception{return new JSONObject(saved().getString("currentRaw"));}
 private void stored(String expression)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(NotesSecureFixture.evaluate(expression)))return;SystemClock.sleep(100);}throw new AssertionError("Expected encrypted Notes commit missing");}
 private void committed()throws Exception{try{until("document.body.textContent.includes('Note text encrypted on this device')");}catch(AssertionError failure){
  String diagnostic=js("JSON.stringify({state:document.documentElement.dataset.notesStorageState||'absent',stage:document.documentElement.dataset.notesOpenStage||'absent',category:document.documentElement.dataset.notesRecoveryCategory||'absent',renderedRecovery:document.body.textContent.includes('Saved notes need recovery. Original data retained.'),renderedOpening:document.body.textContent.includes('Opening saved notes…')})");
  throw new AssertionError("Encrypted Notes receipt missing; fixed-category diagnostic="+diagnostic,failure);
 }}
 private void input(String selector,String value,boolean multiline)throws Exception{until("document.querySelector("+JSONObject.quote(selector)+")");js("(()=>{const e=document.querySelector("+JSONObject.quote(selector)+");Object.getOwnPropertyDescriptor("+(multiline?"HTMLTextAreaElement":"HTMLInputElement")+".prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");committed();}
 private static String sha(String value)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 @Test public void actualEditorEncryptedCommitAndRecreation()throws Exception{
  org.junit.Assume.assumeTrue("Explicit disposable Notes qualification","1".equals(InstrumentationRegistry.getArguments().getString("notesSecureStorage")));
  String title="SECURE-NOTE-"+UUID.randomUUID(),body="Synthetic private body "+UUID.randomUUID();String id=null;Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   try{
    AppNavigation.liveMode();js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");committed();
    assertEquals("true",js("localStorage.getItem('alphaphone:notes:v2')===null&&localStorage.getItem('alphaphone:prototype:notes:v1')===null"));
    click("New note");committed();input("input[aria-label=Title]",title,false);input("textarea[aria-label=Note]",body,true);
    stored("__notesEnvelope.records.some(n=>n.title==="+JSONObject.quote(title)+"&&n.body==="+JSONObject.quote(body)+")");
    JSONArray records=envelope().getJSONArray("records");int found=0;for(int i=0;i<records.length();i++){JSONObject n=records.getJSONObject(i);if(title.equals(n.optString("title"))){assertEquals(body,n.getString("body"));id=n.getString("id");found++;}}assertEquals(1,found);
    File encrypted=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials/"+sha("notes-records:v1:device"));String bytes=new String(Files.readAllBytes(encrypted.toPath()),StandardCharsets.ISO_8859_1);assertFalse(bytes.contains(title));assertFalse(bytes.contains(body));
    scenario.recreate();AppNavigation.liveMode();js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");committed();click("Open "+title);assertEquals(JSONObject.quote(body),js("document.querySelector('textarea[aria-label=Note]').value"));
    click("Delete note");stored("!__notesEnvelope.records.some(n=>n.title==="+JSONObject.quote(title)+")");committed();JSONArray remaining=envelope().getJSONArray("records");for(int i=0;i<remaining.length();i++)assertNotEquals(id,remaining.getJSONObject(i).getString("id"));
    scenario.recreate();AppNavigation.liveMode();js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");committed();assertEquals("false",js("[...document.querySelectorAll('button')].some(b=>b.getAttribute('aria-label')==="+JSONObject.quote("Open "+title)+")"));
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    // Only the unique fixture is eligible for deletion; never clear the collection.
    try{AppNavigation.liveMode();js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");committed();JSONArray remaining=envelope().getJSONArray("records");boolean exists=false;for(int i=0;i<remaining.length();i++)if(title.equals(remaining.getJSONObject(i).optString("title")))exists=true;if(exists){click("Open "+title);click("Delete note");committed();}}catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
   }
  }
 }
 @Test public void freshInstallLegacyMigrationRetainsExactArchiveAndAudio()throws Exception{
  org.junit.Assume.assumeTrue("Explicit fresh-install migration campaign","1".equals(InstrumentationRegistry.getArguments().getString("notesSecureMigration")));
  String marker="MIGRATION-"+UUID.randomUUID(),baseline=null,legacyRaw=null,currentRaw=null;Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   try{
    AppNavigation.liveMode();js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");committed();baseline=NotesSecureFixture.read();
    JSONObject original=new JSONObject(baseline),originalEnvelope=new JSONObject(original.getString("currentRaw"));
    assertEquals("Fresh empty collection required",0,originalEnvelope.getJSONArray("records").length());assertEquals(0,originalEnvelope.getJSONArray("deleted").length());
    JSONObject archive=original.getJSONObject("archive");for(String name:new String[]{"v1","v2","daily"})assertTrue("No original archive may be replaced",archive.isNull(name));
    assertEquals("true",js("localStorage.getItem('alphaphone:notes:v2')===null&&localStorage.getItem('alphaphone:prototype:notes:v1')===null"));
    JSONArray records=new JSONArray().put(new JSONObject().put("id",marker).put("kind","voice").put("title",marker).put("body","Exact transcript").put("audio",new JSONObject().put("audioId",marker+"-audio").put("noteId",marker).put("mimeType","audio/mp4")).put("custom",new JSONArray().put("retained").put(42)));
    legacyRaw=records.toString();currentRaw=new JSONObject().put("version",2).put("collectionId",UUID.randomUUID().toString()).put("records",records).put("deleted",new JSONArray().put(new JSONObject().put("id",marker+"-deleted").put("revision","exact-prior-revision").put("operationId",marker+"-operation"))).toString();
    JSONObject clear=new JSONObject().put("slot","notes-records:v1:device").put("expectedValue",baseline).put("value",JSONObject.NULL);assertEquals("saved",NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+clear+")").getString("status"));
    js("localStorage.setItem('alphaphone:prototype:notes:v1',"+JSONObject.quote(legacyRaw)+");localStorage.setItem('alphaphone:notes:v2',"+JSONObject.quote(currentRaw)+")");
    scenario.recreate();AppNavigation.liveMode();js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");committed();
    JSONObject migrated=new JSONObject(NotesSecureFixture.read());assertEquals(currentRaw,migrated.getString("currentRaw"));assertEquals(legacyRaw,migrated.getJSONObject("archive").getString("v1"));assertEquals(currentRaw,migrated.getJSONObject("archive").getString("v2"));
    assertEquals("true",js("localStorage.getItem('alphaphone:notes:v2')===null&&localStorage.getItem('alphaphone:prototype:notes:v1')===null"));
    scenario.recreate();AppNavigation.liveMode();assertEquals("Lossless archive and audio association survive recreation",migrated.toString(),new JSONObject(NotesSecureFixture.read()).toString());
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    if(baseline!=null&&currentRaw!=null)try{
     JSONObject r=NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureRead({slot:'notes-records:v1:device'})");String now=r.isNull("value")?null:r.getString("value");
     if(now!=null&&!now.equals(baseline)){JSONObject owned=new JSONObject(now);assertEquals("Do not overwrite an unrelated collection",currentRaw,owned.getString("currentRaw"));assertEquals(currentRaw,owned.getJSONObject("archive").getString("v2"));}
     if(!Objects.equals(now,baseline)){JSONObject restore=new JSONObject().put("slot","notes-records:v1:device").put("expectedValue",now==null?JSONObject.NULL:now).put("value",baseline);assertEquals("saved",NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+restore+")").getString("status"));}
     js("(()=>{for(const [key,value] of [['alphaphone:prototype:notes:v1',"+JSONObject.quote(legacyRaw)+"],['alphaphone:notes:v2',"+JSONObject.quote(currentRaw)+"]])if(localStorage.getItem(key)===value)localStorage.removeItem(key);})()");
     assertEquals(baseline,NotesSecureFixture.read());
    }catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
   }
  }
 }

 /**
  * The same legacy-layout migration across a real process restart (an upgrade reaches the new
  * build in a new process). scripts/test-native-restart.mjs notes-secure-migration passes
  * notesSecureMigrationPhase=prepare (fresh install: install the legacy localStorage layout and
  * empty the encrypted slot), force-stops the app, then verify (a new process migrates and the
  * exact bytes are read back from the encrypted slot), then cleanup (the baseline is restored).
  * The fixture state between phases is a test-owned file in the app's private files directory.
  */
 @Test public void secureMigrationProcessRestartPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("notesSecureMigrationPhase");
  org.junit.Assume.assumeTrue("Run by node scripts/test-native-restart.mjs notes-secure-migration","prepare".equals(phase)||"verify".equals(phase)||"cleanup".equals(phase));
  File state=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"notes-secure-migration-fixture.json");
  if("prepare".equals(phase)){
   assertFalse("A previous migration fixture was not cleaned up",state.exists());
   String marker="MIGRATION-"+UUID.randomUUID();
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");committed();
    String baseline=NotesSecureFixture.read();
    JSONObject original=new JSONObject(baseline),originalEnvelope=new JSONObject(original.getString("currentRaw"));
    assertEquals("Fresh empty collection required",0,originalEnvelope.getJSONArray("records").length());
    JSONObject archive=original.getJSONObject("archive");for(String name:new String[]{"v1","v2","daily"})assertTrue("No original archive may be replaced",archive.isNull(name));
    JSONArray records=new JSONArray().put(new JSONObject().put("id",marker).put("kind","voice").put("title",marker).put("body","Exact transcript").put("audio",new JSONObject().put("audioId",marker+"-audio").put("noteId",marker).put("mimeType","audio/mp4")).put("custom",new JSONArray().put("retained").put(42)));
    String legacyRaw=records.toString(),currentRaw=new JSONObject().put("version",2).put("collectionId",UUID.randomUUID().toString()).put("records",records).put("deleted",new JSONArray().put(new JSONObject().put("id",marker+"-deleted").put("revision","exact-prior-revision").put("operationId",marker+"-operation"))).toString();
    // Recorded before any change, so cleanup can restore the baseline even if a later step fails.
    Files.write(state.toPath(),new JSONObject().put("baseline",baseline).put("legacyRaw",legacyRaw).put("currentRaw",currentRaw).toString().getBytes(StandardCharsets.UTF_8));
    JSONObject clear=new JSONObject().put("slot","notes-records:v1:device").put("expectedValue",baseline).put("value",JSONObject.NULL);assertEquals("saved",NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+clear+")").getString("status"));
    js("localStorage.setItem('alphaphone:prototype:notes:v1',"+JSONObject.quote(legacyRaw)+");localStorage.setItem('alphaphone:notes:v2',"+JSONObject.quote(currentRaw)+")");
    assertEquals("Legacy layout installed","true",js("localStorage.getItem('alphaphone:notes:v2')!==null&&localStorage.getItem('alphaphone:prototype:notes:v1')!==null"));
   }
   return;
  }
  // A prepare that failed before recording anything changed nothing, so there is nothing to restore.
  if("cleanup".equals(phase)&&!state.isFile())return;
  assertTrue("The prepare phase recorded its fixture",state.isFile());
  JSONObject fixture=new JSONObject(new String(Files.readAllBytes(state.toPath()),StandardCharsets.UTF_8));
  String baseline=fixture.getString("baseline"),legacyRaw=fixture.getString("legacyRaw"),currentRaw=fixture.getString("currentRaw");
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();
   if("verify".equals(phase)){
    js(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");committed();
    JSONObject migrated=new JSONObject(NotesSecureFixture.read());
    assertEquals("The current envelope migrated byte for byte",currentRaw,migrated.getString("currentRaw"));
    assertEquals("The v1 archive holds the exact legacy bytes",legacyRaw,migrated.getJSONObject("archive").getString("v1"));
    assertEquals("The v2 archive holds the exact current bytes",currentRaw,migrated.getJSONObject("archive").getString("v2"));
    assertEquals("The legacy layout is removed after migration","true",js("localStorage.getItem('alphaphone:notes:v2')===null&&localStorage.getItem('alphaphone:prototype:notes:v1')===null"));
    return;
   }
   // cleanup: restore the baseline, never overwriting an unrelated collection.
   JSONObject r=NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureRead({slot:'notes-records:v1:device'})");String now=r.isNull("value")?null:r.getString("value");
   if(now!=null&&!now.equals(baseline)){JSONObject owned=new JSONObject(now);assertEquals("Do not overwrite an unrelated collection",currentRaw,owned.getString("currentRaw"));}
   if(!Objects.equals(now,baseline)){JSONObject restore=new JSONObject().put("slot","notes-records:v1:device").put("expectedValue",now==null?JSONObject.NULL:now).put("value",baseline);assertEquals("saved",NotesSecureFixture.call("Capacitor.Plugins.AlphaConnection.secureCompareExchange("+restore+")").getString("status"));}
   js("(()=>{for(const [key,value] of [['alphaphone:prototype:notes:v1',"+JSONObject.quote(legacyRaw)+"],['alphaphone:notes:v2',"+JSONObject.quote(currentRaw)+"]])if(localStorage.getItem(key)===value)localStorage.removeItem(key);})()");
   assertEquals(baseline,NotesSecureFixture.read());
  }finally{if("cleanup".equals(phase))Files.deleteIfExists(state.toPath());}
 }
}
