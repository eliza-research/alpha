package ai.elizaresearch.alphaphone;
import android.content.*;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import java.util.*;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;
/** Production refusal and preservation; positive SAF migration is an explicit test-mocks fixture only. */
public final class NotesDocumentInstrumentedTest {
 private void until(String expression)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(NotesSecureFixture.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}fail("Notes document flow timed out: "+expression+"; state="+NotesSecureFixture.evaluate("JSON.stringify({view:document.documentElement.dataset.activeView,storage:document.documentElement.dataset.notesStorageState,importDisabled:document.querySelector('button[aria-label=\"Import text note\"]')?.disabled,exportDisabled:document.querySelector('button[aria-label=\"Export text file\"]')?.disabled,cancellationNotice:document.body.textContent.includes('Document selection cancelled.'),observedCancellationNotice:window.__notesCancelNoticeSeen===true,observedReceipt:window.__notesReceiptSeen===true,documentHidden:document.hidden})"));}
 /**
  * A receipt is a notice that leaves the screen after 1.9 seconds. Reading the page for it afterwards
  * races its lifetime: one read of the WebView while the app returns from the system picker can take
  * longer than that, and one run timed out with the exported bytes already verified on disk. Record
  * the rendered notice as it appears, starting before the action that causes it.
  */
 private void observeReceipt(String text)throws Exception{
  NotesSecureFixture.evaluate("(()=>{window.__notesReceiptObserver?.disconnect();window.__notesReceiptSeen=false;const text="+JSONObject.quote(text)+",seen=()=>{if([...document.querySelectorAll('[data-alpha-toast] .drop > span')].some(node=>node.textContent===text&&node.getClientRects().length>0)){window.__notesReceiptSeen=true;window.__notesReceiptObserver.disconnect();}};window.__notesReceiptObserver=new MutationObserver(seen);window.__notesReceiptObserver.observe(document.body,{childList:true,subtree:true,characterData:true});seen();})()");
  assertEquals("An earlier notice cannot stand in for this receipt","false",NotesSecureFixture.evaluate("window.__notesReceiptSeen===true"));
 }
 private void awaitReceipt()throws Exception{
  try{until("window.__notesReceiptSeen===true");}finally{NotesSecureFixture.evaluate("window.__notesReceiptObserver?.disconnect();delete window.__notesReceiptObserver;delete window.__notesReceiptSeen");}
 }
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==="+JSONObject.quote(label)+"&&b.getClientRects().length&&!b.disabled)";until(q);NotesSecureFixture.evaluate("("+q+").click()");}
 private void title(String text)throws Exception{NotesSecureFixture.evaluate("(()=>{const e=document.querySelector('input[aria-label=Title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(text)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");until("document.querySelector('input[aria-label=Title]')?.value==="+JSONObject.quote(text.replace("\r\n","\n")));}
 // Fixed categories only: never retain activity dumps, document names, or UI text.
 private String surfaceCategory(String value){
  if(value==null||value.isEmpty())return "none";
  if(value.contains("documentsui")||value.contains("DocumentsActivity"))return "documents";
  if(value.contains("ResolverActivity")||value.contains("ChooserActivity"))return "resolver";
  if(value.contains("permissioncontroller"))return "permission";
  if(value.contains("systemui"))return "system-ui";
  if(value.contains("alphaphone"))return "app";
  if(value.contains("launcher"))return "launcher";
  return "other";
 }
 private void awaitDocumentPicker()throws Exception{
  android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();long end=SystemClock.elapsedRealtime()+15000;
  boolean sawResumed=false,sawExposed=false;int polls=0,nullRoots=0;String lastResumed="none",lastRoot="none";Set<String> surfaces=new TreeSet<>();
  while(SystemClock.elapsedRealtime()<end){
   String activities;try(java.io.InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand("dumpsys activity activities"))){activities=new String(input.readAllBytes(),StandardCharsets.UTF_8);}
   boolean resumed=activities.lines().anyMatch(line->(line.contains("mResumedActivity")||line.contains("topResumedActivity"))&&(line.contains("documentsui")||line.contains("DocumentsActivity")));
   lastResumed="none";
   for(String line:activities.split("\n"))if(line.contains("mResumedActivity")||line.contains("topResumedActivity")){lastResumed=surfaceCategory(line);surfaces.add(lastResumed);}
   AccessibilityNodeInfo root=ui.getRootInActiveWindow();boolean exposed=root!=null&&String.valueOf(root.getPackageName()).contains("documentsui");lastRoot=root==null?"none":surfaceCategory(String.valueOf(root.getPackageName()));if(root==null)nullRoots++;else root.recycle();
   polls++;sawResumed|=resumed;sawExposed|=exposed;
   if(resumed&&exposed)return;SystemClock.sleep(100);
  }
  throw new AssertionError("Requested document picker did not become the resumed accessible Android surface; polls="+polls+" nullRoots="+nullRoots+" sawDocumentsResumed="+sawResumed+" sawDocumentsAccessible="+sawExposed+" lastResumed="+lastResumed+" lastRoot="+lastRoot+" observedResumed="+surfaces);
 }
 private void cancelPicker(String readyControl)throws Exception{
  // JS click completion precedes the asynchronous native launch. Prove the picker
  // is foreground before asking the shared helper to send actual paired Back.
  awaitDocumentPicker();
  // Observe the actual rendered notice before native Back. A previous notice
  // must disappear first, so the import receipt cannot satisfy export cancellation.
  until("!document.body.textContent.includes('Document selection cancelled.')");
  NotesSecureFixture.evaluate("(()=>{window.__notesCancelNoticeSeen=false;window.__notesCancelObserver=new MutationObserver(()=>{if([...document.querySelectorAll('.drop > span')].some(node=>node.textContent==='Document selection cancelled. Nothing imported or exported.'&&node.getClientRects().length>0)){window.__notesCancelNoticeSeen=true;window.__notesCancelObserver.disconnect();}});window.__notesCancelObserver.observe(document.body,{childList:true,subtree:true,characterData:true});})()");
  try {
   WebViewTestDriver.cancelDocumentPicker();
   // Deliberately outlive the 1900 ms toast: slow Android surface readback must
   // not erase proof that the real cancellation notice was rendered.
   SystemClock.sleep(2100);
   until("document.documentElement.dataset.activeView==='notes'&&document.querySelector('button[aria-label=\""+readyControl+"\"]')?.disabled===false&&window.__notesCancelNoticeSeen===true");
  } finally {
   NotesSecureFixture.evaluate("window.__notesCancelObserver?.disconnect();delete window.__notesCancelObserver;delete window.__notesCancelNoticeSeen");
  }
 }
 private void nativeSave()throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;while(SystemClock.elapsedRealtime()<end){AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root!=null){ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);while(!queue.isEmpty()){AccessibilityNodeInfo node=queue.remove();if(node.isEnabled()&&"save".equalsIgnoreCase(String.valueOf(node.getText()))&&String.valueOf(node.getPackageName()).contains("documentsui")){assertTrue("Actual DocumentsUI Save",node.performAction(AccessibilityNodeInfo.ACTION_CLICK));return;}for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}}}SystemClock.sleep(100);}fail("DocumentsUI Save not exposed");
 }
 private String selectedExportId;
 private java.util.Map<?,?> selections()throws Exception{
  return new HashMap<>(SelectedDocumentAccess.selections());
 }
 private Uri selectExport(String name,long createdAfter,String text)throws Exception{
  // This is a genuine user-mediated grant; no raw URI is injected or authorized.
  NotesSecureFixture.evaluate("window.__notesExportGrant=null;Capacitor.Plugins.DailyApps.perform({action:'files'}).then(value=>window.__notesExportGrant=value,()=>window.__notesExportGrant={status:'failed'})");
  new SelectedDocumentInstrumentedTest().selectDocument(name);until("window.__notesExportGrant!==null");
  JSONObject result=new JSONObject(NotesSecureFixture.evaluate("window.__notesExportGrant"));assertEquals("selected",result.getString("status"));selectedExportId=result.getString("selectionId");
  Uri uri=Uri.parse(result.getString("uri"));verifyExport(uri,name,createdAfter,text);return uri;
 }
 private void verifyExport(Uri uri,String name,long createdAfter,String text)throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  assertEquals("Explicit content grant","content",uri.getScheme());assertTrue("Provider offered real persisted read/write grant",resolver.getPersistedUriPermissions().stream().anyMatch(p->p.getUri().equals(uri)&&p.isReadPermission()&&p.isWritePermission()));
  try(android.database.Cursor c=resolver.query(uri,new String[]{android.provider.DocumentsContract.Document.COLUMN_DISPLAY_NAME,android.provider.DocumentsContract.Document.COLUMN_MIME_TYPE,android.provider.DocumentsContract.Document.COLUMN_SIZE,android.provider.DocumentsContract.Document.COLUMN_LAST_MODIFIED,android.provider.DocumentsContract.Document.COLUMN_FLAGS},null,null,null)){
   assertNotNull(c);assertTrue(c.moveToFirst());assertTrue("Exact UUID fixture name",name.equals(c.getString(0)));assertEquals("text/plain",c.getString(1));assertEquals("Exact encoded size",text.getBytes(StandardCharsets.UTF_8).length,c.getLong(2));long changed=c.getLong(3);assertTrue("Fixture modification time",changed>=createdAfter*1000-2000&&changed<=System.currentTimeMillis()+2000);assertTrue("Provider supports explicit deletion",(c.getLong(4)&android.provider.DocumentsContract.Document.FLAG_SUPPORTS_DELETE)!=0);assertFalse("Exactly one selected document",c.moveToNext());
  }
  try(java.io.InputStream in=resolver.openInputStream(uri)){assertNotNull(in);assertArrayEquals("Independent exact provider-granted bytes",text.getBytes(StandardCharsets.UTF_8),in.readAllBytes());}
 }
 @Test public void realPickerImportExportCancelAndRecreation()throws Exception{if(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS){productRefusal();return;}runFlow(false);}
 private void productRefusal()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");
   String before=NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)");
   assertEquals("No product import control","false",NotesSecureFixture.evaluate("!!document.querySelector('button[aria-label=\"Import text note\"]')"));
   android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();java.util.concurrent.atomic.AtomicInteger outgoing=new java.util.concurrent.atomic.AtomicInteger();
   android.app.Instrumentation.ActivityMonitor monitor=new android.app.Instrumentation.ActivityMonitor(){@Override public android.app.Instrumentation.ActivityResult onStartActivity(Intent intent){outgoing.incrementAndGet();return new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null);}};
   instrumentation.addMonitor(monitor);
   try{
    NotesSecureFixture.evaluate("window.__notesMigrationPolicy=null;Promise.all([Capacitor.Plugins.AlphaNoteDocuments.importText(),Capacitor.Plugins.AlphaNoteDocuments.exportText({text:'synthetic refused text'})]).then(v=>window.__notesMigrationPolicy=v.map(x=>x.status))");
    until("window.__notesMigrationPolicy!==null");assertEquals("[\"unsupported\",\"unsupported\"]",NotesSecureFixture.evaluate("window.__notesMigrationPolicy"));assertEquals("No document activity launched",0,outgoing.get());
    assertEquals("Saved Notes unchanged",before,NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)"));
   }finally{instrumentation.removeMonitor(monitor);}
  }
 }
 private void runFlow(boolean retainNotes)throws Exception{
  assertTrue("Positive Notes migration requires explicit test-mocks APK",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();String suffix=retainNotes?InstrumentationRegistry.getArguments().getString("notesDocumentRunId"):UUID.randomUUID().toString(),name="alpha-note-import-"+suffix+".txt",outName="alpha-note-export-"+suffix,text="Synthetic note "+suffix+"\r\nUnicode café 🧪\n";
  SelectedDocumentInstrumentedTest picker=new SelectedDocumentInstrumentedTest();Uri source=picker.fixture(resolver,name,text),output=null;Set<String> created=new HashSet<>();boolean completed=false;Throwable primary=null;long exportStarted=0;SelectedDocumentAccess.restore(context);java.util.Map<?,?> priorSelections=selections();assertTrue("Leave capacity for one temporary picker capability without evicting Files",priorSelections.size()<32);java.io.File exportJournal=new java.io.File(context.getNoBackupFilesDir(),"notes-export-fixture-"+suffix+".json");
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");
   String initial=NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)");
   click("Import text note");cancelPicker("Import text note");assertEquals(initial,NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)"));
   click("Import text note");picker.selectDocument(name);until("document.querySelector('textarea[aria-label=Note]')?.value==="+JSONObject.quote(text.replace("\r\n","\n")));
   JSONArray imported=new JSONArray(NotesSecureFixture.evaluate("__notesEnvelope.records.filter(n=>n.body==="+JSONObject.quote(text)+").map(n=>n.id)"));assertEquals(1,imported.length());created.add(imported.getString(0));
   title(outName);click("Share note");click("Export text file");cancelPicker("Export text file");
   assertTrue("Cancelled export retains exact note",NotesSecureFixture.evaluate("__notesEnvelope.records.some(n=>n.body==="+JSONObject.quote(text)+")").equals("true"));
   until("!document.body.textContent.includes('Export saved and exact bytes verified.')");observeReceipt("Export saved and exact bytes verified.");
   click("Export text file");awaitDocumentPicker();exportStarted=System.currentTimeMillis()/1000;java.nio.file.Files.write(exportJournal.toPath(),new JSONObject().put("name",outName+".txt").put("expectedText",text).put("createdAfter",exportStarted).toString().getBytes(StandardCharsets.UTF_8));nativeSave();awaitReceipt();output=selectExport(outName+".txt",exportStarted,text);
   click("Close share");click("Back to notes");click("Import text note");picker.selectDocument(outName+".txt");until("document.querySelector('textarea[aria-label=Note]')?.value==="+JSONObject.quote(text.replace("\r\n","\n")));
   JSONArray all=new JSONArray(NotesSecureFixture.evaluate("__notesEnvelope.records.filter(n=>n.body==="+JSONObject.quote(text)+").map(n=>n.id)"));assertEquals("Import always creates a new note",2,all.length());for(int i=0;i<all.length();i++)created.add(all.getString(i));
   scenario.recreate();AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");assertEquals("2",NotesSecureFixture.evaluate("__notesEnvelope.records.filter(n=>n.body==="+JSONObject.quote(text)+").length"));
   if(retainNotes){JSONObject record=new JSONObject().put("body",text).put("title",outName).put("pid",android.os.Process.myPid());java.nio.file.Files.write(new java.io.File(context.getNoBackupFilesDir(),"notes-document-restart-"+suffix+".json").toPath(),record.toString().getBytes(StandardCharsets.UTF_8));}completed=true;
  }catch(Exception|AssertionError error){primary=error;throw error;}finally{
   java.util.List<Throwable> cleanupErrors=new ArrayList<>();
   try{resolver.delete(source,null,null);}catch(RuntimeException error){cleanupErrors.add(error);}
   if(exportStarted!=0)try(BoundedActivityScenario<MainActivity> cleanup=BoundedActivityScenario.launch(MainActivity.class)){
    until("document.documentElement.dataset.activeView");
    // Reacquire the exact document through DocumentsUI even when receipt handling
    // failed before recording a URI. Unknown metadata/bytes retain the journal.
    Uri exact=output;
    if(exact==null){if(selectedExportId!=null){SelectedDocumentAccess.forget(selectedExportId);selectedExportId=null;}exact=selectExport(outName+".txt",exportStarted,text);}
    verifyExport(exact,outName+".txt",exportStarted,text);
    assertTrue("Provider acknowledged exact granted document deletion",android.provider.DocumentsContract.deleteDocument(resolver,exact));
    java.nio.file.Files.deleteIfExists(exportJournal.toPath());
   }catch(Exception|AssertionError error){cleanupErrors.add(error);}
   if(selectedExportId!=null)try{SelectedDocumentAccess.forget(selectedExportId);selectedExportId=null;}catch(RuntimeException error){cleanupErrors.add(error);}
   try{assertTrue("All prior Files capability identities and URIs preserved",priorSelections.equals(selections()));SelectedDocumentAccess.restore(context);}catch(Exception|AssertionError error){cleanupErrors.add(error);}
   // Remove only these exact synthetic notes, even if a late assertion failed.
   if(!retainNotes||!completed)try(BoundedActivityScenario<MainActivity> cleanup=BoundedActivityScenario.launch(MainActivity.class)){
    until("document.documentElement.dataset.activeView");NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.body!=="+JSONObject.quote(text)+")");
   }catch(Exception|AssertionError error){cleanupErrors.add(error);}
   if(!cleanupErrors.isEmpty()){if(primary!=null){for(Throwable error:cleanupErrors)primary.addSuppressed(error);}else{AssertionError failure=new AssertionError("Owned Notes document cleanup failed");for(Throwable error:cleanupErrors)failure.addSuppressed(error);throw failure;}}
  }
 }
 @Test public void oversizedAndInvalidUtf8DoNotCreateNotes()throws Exception{
  if(!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS){productRefusal();return;}
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();SelectedDocumentInstrumentedTest picker=new SelectedDocumentInstrumentedTest();String suffix=UUID.randomUUID().toString(),largeName="alpha-note-large-"+suffix+".txt",badName="alpha-note-invalid-"+suffix+".txt";
  char[] oversized=new char[65537];Arrays.fill(oversized,'x');Uri large=picker.fixture(resolver,largeName,new String(oversized)),bad=picker.fixture(resolver,badName,"");
  try(java.io.OutputStream out=resolver.openOutputStream(bad,"wt")){assertNotNull(out);out.write(new byte[]{(byte)0xc3,0x28});}
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");String before=NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)");
   click("Import text note");picker.selectDocument(largeName);until("document.body.textContent.includes('limited to 64 KiB')");assertEquals(before,NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)"));
   click("Import text note");picker.selectDocument(badName);until("document.body.textContent.includes('requires UTF-8')");assertEquals(before,NotesSecureFixture.evaluate("JSON.stringify(__notesEnvelope)"));
  }finally{try{resolver.delete(large,null,null);}finally{resolver.delete(bad,null,null);}}
 }
 @Test public void documentProcessRestartPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("notesDocumentPhase");org.junit.Assume.assumeTrue("Explicit process runner required",phase!=null);
  assertTrue("Notes import/export restart is a development fixture: use explicit test-mocks APKs",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  String runId=InstrumentationRegistry.getArguments().getString("notesDocumentRunId");assertNotNull("Explicit process run ID required",runId);assertEquals("Canonical run UUID",UUID.fromString(runId).toString(),runId);
  android.os.Bundle evidence=new android.os.Bundle();evidence.putInt("notesDocumentPid",android.os.Process.myPid());InstrumentationRegistry.getInstrumentation().addResults(evidence);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();java.io.File file=new java.io.File(context.getNoBackupFilesDir(),"notes-document-restart-"+runId+".json"),exportRecovery=new java.io.File(context.getNoBackupFilesDir(),"notes-export-fixture-"+runId+".json");
  if(phase.equals("prepare")){assertFalse("Refuse unresolved note fixture",file.exists());assertFalse("Refuse unresolved export fixture",exportRecovery.exists());runFlow(true);return;}
  if(phase.equals("cleanup")&&!file.exists()){assertFalse("This run still has an unresolved exported document; recovery journal retained",exportRecovery.exists());return;}
  JSONObject record=new JSONObject(new String(java.nio.file.Files.readAllBytes(file.toPath()),StandardCharsets.UTF_8));String text=record.getString("body");
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();NotesSecureFixture.evaluate(AppNavigation.request("Notes"));until("window.__alphaTestNavigation?.status==='complete'");
   if(phase.equals("restore")){
    assertNotEquals("Different Android process",record.getInt("pid"),android.os.Process.myPid());click("Open "+record.getString("title"));until("document.querySelector('textarea[aria-label=Note]')?.value==="+JSONObject.quote(text.replace("\r\n","\n")));
    assertEquals("2",NotesSecureFixture.evaluate("__notesEnvelope.records.filter(n=>n.body==="+JSONObject.quote(text)+").length"));
   }else assertEquals("cleanup",phase);
   NotesSecureFixture.replaceRecords("records=>records.filter(n=>n.body!=="+JSONObject.quote(text)+")");
  }
  java.nio.file.Files.delete(file.toPath());assertFalse("This run still has an unresolved exported document; recovery journal retained",exportRecovery.exists());
 }

}
