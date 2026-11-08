package ai.elizaresearch.alphaphone;

import android.app.Instrumentation;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** A real 600-file DocumentsUI tree grant: cursor paging past one page, and native
 * multi-select move, share (ACTION_SEND_MULTIPLE) and confirmed delete with per-item outcomes. */
@RunWith(AndroidJUnit4.class)
public class FilesTreeBatchInstrumentedTest {
 private static final int FILES=600;
 private String eval(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js)throws Exception{long end=SystemClock.elapsedRealtime()+30000;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+js+")")))return;SystemClock.sleep(150);}fail("Batch condition: "+js+"; status="+eval("JSON.stringify([...document.querySelectorAll('[role=status]')].map(e=>e.textContent.slice(0,200)))"));}
 private String button(String label){return "document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";}
 private void click(String label)throws Exception{until(button(label)+" && !("+button(label)+").disabled");eval("("+button(label)+").click()");}
 /** Chooser dispatch precedes its input focus; Back must cancel Android's chooser. */
 private void chooserForeground()throws Exception{
  android.app.UiAutomation ui=InstrumentationRegistry.getInstrumentation().getUiAutomation();
  for(int i=0;i<150;i++){
   android.view.accessibility.AccessibilityNodeInfo root=ui.getRootInActiveWindow();
   if(root!=null&&"com.android.intentresolver".contentEquals(root.getPackageName()))return;
   SystemClock.sleep(100);
  }
  fail("System chooser acquired input focus before cancellation");
 }
 private void mainForeground()throws Exception{
  for(int i=0;i<100;i++){
   java.util.concurrent.atomic.AtomicBoolean focused=new java.util.concurrent.atomic.AtomicBoolean();
   WebViewTestDriver.withActivity(MainActivity.class,a->focused.set(a.hasWindowFocus()));
   if(focused.get())return;
   SystemClock.sleep(100);
  }
  fail("System chooser returned to the real main Activity");
 }
 private int rows()throws Exception{return Integer.parseInt(eval("document.querySelectorAll('[data-alpha-subview=files-folder] button[aria-label^=\"Open file-\"],[data-alpha-subview=files-folder] button[aria-label^=\"Select file-\"],[data-alpha-subview=files-folder] button[aria-label^=\"Deselect file-\"]').length"));}
 private List<String> names(ContentResolver resolver,Uri tree,Uri folder)throws Exception{List<String> values=new ArrayList<>();Uri query=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(folder));try(Cursor c=resolver.query(query,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){assertNotNull(c);while(c.moveToNext())values.add(c.getString(0));}return values;}
 private Uri child(ContentResolver resolver,Uri tree,Uri folder,String name)throws Exception{Uri query=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(folder));try(Cursor c=resolver.query(query,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){assertNotNull(c);while(c.moveToNext())if(name.equals(c.getString(1)))return DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0));}return null;}
 private Uri seed(ContentResolver resolver,String folder,String name,String text)throws Exception{
  ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,name);values.put(MediaStore.Downloads.MIME_TYPE,"text/plain");values.put(MediaStore.Downloads.RELATIVE_PATH,"Download/"+folder+"/");values.put(MediaStore.Downloads.IS_PENDING,1);
  Uri uri=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);
  try(java.io.OutputStream out=resolver.openOutputStream(uri)){assertNotNull(out);out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));}
  ContentValues published=new ContentValues();published.put(MediaStore.Downloads.IS_PENDING,0);resolver.update(uri,published,null,null);return uri;
 }
 @Test public void sixHundredEntriesPageAndBatchMoveShareDelete()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  assertFalse("Use disposable app state: never replace an existing user-selected tree",context.getSharedPreferences("alpha-files-tree",0).contains("root"));
  String folder="AlphaTree-"+UUID.randomUUID();List<Uri> seeded=new ArrayList<>();Uri treeUri=null;FilesTreeInstrumentedTest picker=new FilesTreeInstrumentedTest();
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();AtomicReference<Intent> chooser=new AtomicReference<>();
  Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_CHOOSER.equals(intent.getAction()))chooser.set(new Intent(intent));return null;}};
  try{
   for(int i=0;i<FILES;i++)seeded.add(seed(resolver,folder,String.format(Locale.ROOT,"file-%03d.txt",i),"Batch fixture "+i));
   seeded.add(seed(resolver,folder+"/Destination","keep.txt","Destination marker"));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();until("document.documentElement.dataset.activeView");eval(AppNavigation.request("Files"));until(AppNavigation.selected("Files"));
    click("Choose folder");picker.chooseFixtureFolder(folder);picker.pickerText("Use this folder");picker.pickerText("Allow");
    until("[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Showing 250 of "+(FILES+1)+" entries'))");
    String saved=context.getSharedPreferences("alpha-files-tree",0).getString("root",null);assertNotNull(saved);treeUri=Uri.parse(saved);
    Uri root=DocumentsContract.buildDocumentUriUsingTree(treeUri,DocumentsContract.getTreeDocumentId(treeUri));
    assertTrue("First page is bounded",rows()<=250);
    click("Load more entries");until("[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Showing 500 of'))");
    click("Load more entries");until("!"+button("Load more entries"));
    assertEquals("All entries reachable without exhausting the session map",FILES,rows());
    // Name sort is explicit and reflected by the menu state.
    click("View and sort");click("Name");until("document.querySelector('[data-alpha-subview=files-folder] button[aria-label^=\"Open file-\"]')?.getAttribute('aria-label')==='Open file-000.txt'");
    // Move three files in one batch.
    click("Select files");for(String name:new String[]{"file-001.txt","file-002.txt","file-003.txt"})click("Select "+name);
    click("Move selected");until("document.querySelector('[role=dialog]')");click("Move into Destination");
    until("document.querySelector('button[aria-label=\"Move here\"]')?.disabled===false");click("Move here");until("!document.querySelector('[role=dialog]')");
    Uri destination=child(resolver,treeUri,root,"Destination");assertNotNull(destination);
    assertTrue("Every moved file reached the destination",names(resolver,treeUri,destination).containsAll(List.of("file-001.txt","file-002.txt","file-003.txt")));
    assertFalse(names(resolver,treeUri,root).contains("file-001.txt"));
    // Share two files through one ACTION_SEND_MULTIPLE chooser; nothing is sent by the app.
    instrumentation.addMonitor(monitor);
    click("Select files");click("Select file-004.txt");click("Select file-005.txt");click("Share selected");
    long end=SystemClock.elapsedRealtime()+15000;while(chooser.get()==null&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(100);
    assertNotNull("Actual Android chooser launched",chooser.get());Intent send=chooser.get().getParcelableExtra(Intent.EXTRA_INTENT);assertNotNull(send);
    assertEquals(Intent.ACTION_SEND_MULTIPLE,send.getAction());ArrayList<Uri> streams=send.getParcelableArrayListExtra(Intent.EXTRA_STREAM);assertNotNull(streams);assertEquals(2,streams.size());
    assertTrue("Recipient gets read access",(send.getFlags()&Intent.FLAG_GRANT_READ_URI_PERMISSION)!=0);assertEquals("Never write access",0,send.getFlags()&Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
    assertEquals(2,send.getClipData().getItemCount());
    chooserForeground();WebViewTestDriver.pressBack();mainForeground();
    // Cancelling sharing preserves the selection; start the next operation explicitly.
    click("Exit selection");
    // Confirmed permanent delete of two files with per-item provider confirmation.
    click("Select files");click("Select file-006.txt");click("Select file-007.txt");click("Delete selected");
    until("document.querySelector('[role=dialog]')?.textContent.includes('cannot be undone')");click("Delete permanently");until("!document.querySelector('[role=dialog]')");
    List<String> remaining=names(resolver,treeUri,root);assertFalse(remaining.contains("file-006.txt"));assertFalse(remaining.contains("file-007.txt"));assertTrue(remaining.contains("file-008.txt"));
   }
  }finally{
   instrumentation.removeMonitor(monitor);
   // A grant saved before the test read it back is still this test's (the start asserted none existed).
   if(treeUri==null){String saved=context.getSharedPreferences("alpha-files-tree",0).getString("root",null);if(saved!=null)treeUri=Uri.parse(saved);}
   // Remove the whole test-owned AlphaTree root while the grant is still held,
   // only after verifying its random fixture name.
   if(treeUri!=null)try{Uri root=DocumentsContract.buildDocumentUriUsingTree(treeUri,DocumentsContract.getTreeDocumentId(treeUri));if(folder.equals(picker.name(resolver,root)))picker.removeFixture(resolver,treeUri,root);}catch(Exception|AssertionError ignored){}
   for(Uri uri:seeded)try{resolver.delete(uri,null,null);}catch(Exception ignored){}
   if(treeUri!=null)for(android.content.UriPermission p:resolver.getPersistedUriPermissions())if(treeUri.equals(p.getUri()))try{resolver.releasePersistableUriPermission(treeUri,(p.isReadPermission()?1:0)|(p.isWritePermission()?2:0));}catch(Exception ignored){}
   context.getSharedPreferences("alpha-files-tree",0).edit().remove("root").commit();
  }
 }
}
