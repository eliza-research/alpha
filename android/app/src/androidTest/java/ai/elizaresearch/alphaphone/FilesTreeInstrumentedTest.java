package ai.elizaresearch.alphaphone;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.provider.*;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.*;
import java.util.function.Predicate;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual DocumentsUI tree grant + provider files. Never seeds existing folders. */
@RunWith(AndroidJUnit4.class)
public class FilesTreeInstrumentedTest {
 private String eval(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+js+")")))return;SystemClock.sleep(100);}fail("Files condition: "+js+"; UI="+eval("JSON.stringify({view:document.documentElement.dataset.activeView,dialog:[...document.querySelectorAll('[role=dialog] h2,[role=dialog] p')].map(e=>e.textContent.slice(0,200)),buttons:[...document.querySelectorAll('[role=dialog] button')].slice(0,30).map(e=>({label:e.getAttribute('aria-label'),disabled:e.disabled})),status:[...document.querySelectorAll('[role=status]')].slice(0,10).map(e=>e.textContent.slice(0,200))})"));}
 private void click(String label)throws Exception{String q="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(q+" && !("+q+").disabled");eval("("+q+").click()");}
 /**
  * The open folder's title. The adapter ignores Back, Refresh, a row tap and a new dialog while a
  * folder operation is in flight, and the confirmation dialog closes before the listing that
  * follows a create, rename or delete has returned. The title changes only when that listing is
  * applied, and the adapter stops being busy in the same turn, so a step that depends on the
  * operation being over waits for the title, not for the dialog to go.
  */
 private static final String FOLDER_TITLE="document.querySelector('[data-alpha-subview=\"files-folder\"] [data-alpha-app-title]')?.textContent";
 private void untilFolder(String name)throws Exception{until(FOLDER_TITLE+"==="+JSONObject.quote(name));}
 private void input(String value)throws Exception{eval("(()=>{const e=document.querySelector('input[aria-label=\"Folder or file name\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");}
 private AccessibilityNodeInfo find(Predicate<AccessibilityNodeInfo> predicate){AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root==null)return null;ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);while(!queue.isEmpty()){AccessibilityNodeInfo n=queue.removeFirst();if(n.isVisibleToUser()&&predicate.test(n))return n;for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo c=n.getChild(i);if(c!=null)queue.add(c);}}return null;}
 private boolean press(AccessibilityNodeInfo n){for(int i=0;n!=null&&i<5;i++,n=n.getParent())if(n.isEnabled()&&n.isClickable()&&n.performAction(AccessibilityNodeInfo.ACTION_CLICK))return true;return false;}
 private String pickerState(){
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root==null)return "no accessibility root";
  StringBuilder out=new StringBuilder();ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);int visited=0;
  while(!queue.isEmpty()&&visited++<350&&out.length()<4500){AccessibilityNodeInfo n=queue.removeFirst();
   if(n.isVisibleToUser()&&String.valueOf(n.getPackageName()).contains("documentsui")){
    String text=String.valueOf(n.getText()),description=String.valueOf(n.getContentDescription());
    if(!text.equals("null")||!description.equals("null"))out.append(" [").append(n.getViewIdResourceName()).append(" text=").append(text.substring(0,Math.min(100,text.length()))).append(" description=").append(description.substring(0,Math.min(100,description.length()))).append(" enabled=").append(n.isEnabled()).append(" clickable=").append(n.isClickable()).append("]");
   }
   for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo c=n.getChild(i);if(c!=null)queue.add(c);}
  }return out.toString();
 }
 private boolean documentsNode(AccessibilityNodeInfo n){return String.valueOf(n.getPackageName()).contains("documentsui");}
 private boolean atFolder(String folder){
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root==null)return false;
  ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);String current="";
  while(!queue.isEmpty()){AccessibilityNodeInfo node=queue.removeFirst();if(node.isVisibleToUser()&&documentsNode(node)&&String.valueOf(node.getViewIdResourceName()).endsWith(":id/breadcrumb_text"))current=String.valueOf(node.getText());for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}}
  // Build61's compact DocumentsUI omits breadcrumbs but exposes this exact header.
  if(current.isEmpty())return find(n->documentsNode(n)&&String.valueOf(n.getViewIdResourceName()).endsWith(":id/header_title")&&("Files in "+folder).equals(String.valueOf(n.getText())))!=null;
  return folder.equals(current); // Last breadcrumb is current; ancestors are not.
 }
 private boolean scrollPicker(int action){
  AccessibilityNodeInfo list=find(n->documentsNode(n)&&n.isScrollable()&&String.valueOf(n.getViewIdResourceName()).endsWith(":id/dir_list"));
  return list!=null&&list.performAction(action);
 }
 void chooseFixtureFolder(String folder)throws Exception{
  // ACTION_OPEN_DOCUMENT_TREE exposes real storage directories. The virtual
  // Downloads shortcut used by the single-document picker is not this path.
  // Build47's actual AOSP hierarchy exposes android:id/title = Download.
  long deadline=SystemClock.elapsedRealtime()+30000;boolean resetScroll=false;int scrolls=0;boolean listMode=false,drawerTried=false,storageChosen=false;
  // ExternalStorageProvider titles the primary root with the device name (the emulator's is its model),
  // falling back to the volume description only when no device name is set.
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  String deviceName=Settings.Global.getString(context.getContentResolver(),Settings.Global.DEVICE_NAME);
  String storageRoot=deviceName!=null&&!deviceName.isEmpty()?deviceName:context.getSystemService(android.os.storage.StorageManager.class).getPrimaryStorageVolume().getDescription(context);
  while(SystemClock.elapsedRealtime()<deadline){
   if(atFolder(folder)){
    AccessibilityNodeInfo grant=find(n->documentsNode(n)&&"android:id/button1".equals(n.getViewIdResourceName())&&"USE THIS FOLDER".equalsIgnoreCase(String.valueOf(n.getText())));
    if(grant!=null&&grant.isEnabled())return;
   }
   if(!listMode){AccessibilityNodeInfo toggle=find(n->documentsNode(n)&&String.valueOf(n.getViewIdResourceName()).endsWith(":id/sub_menu_list"));if(toggle!=null&&press(toggle)){listMode=true;SystemClock.sleep(200);continue;}}
   if(!atFolder("Download")&&!atFolder(folder)){
    AccessibilityNodeInfo ancestor=find(n->documentsNode(n)&&String.valueOf(n.getViewIdResourceName()).endsWith(":id/breadcrumb_text")&&"Download".equals(String.valueOf(n.getText())));
    if(ancestor!=null&&press(ancestor)){resetScroll=false;scrolls=0;SystemClock.sleep(250);continue;}
    AccessibilityNodeInfo stale=find(n->documentsNode(n)&&String.valueOf(n.getViewIdResourceName()).endsWith(":id/header_title")&&String.valueOf(n.getText()).startsWith("Files in AlphaTree-")&&!String.valueOf(n.getText()).equals("Files in "+folder));
    if(stale!=null){WebViewTestDriver.pressBack();SystemClock.sleep(500);continue;}
   }
   AccessibilityNodeInfo fixture=find(n->documentsNode(n)&&"android:id/title".equals(n.getViewIdResourceName())&&folder.equals(String.valueOf(n.getText())));
   if(fixture!=null&&press(fixture)){SystemClock.sleep(200);continue;}
   if(!atFolder("Download")){
    AccessibilityNodeInfo download=find(n->documentsNode(n)&&"android:id/title".equals(n.getViewIdResourceName())&&"Download".equals(String.valueOf(n.getText())));
    if(download!=null&&press(download)){resetScroll=false;scrolls=0;SystemClock.sleep(250);continue;}
   }else if(scrolls<60){
    // A restored picker can retain a previous scroll position. Rewind before
    // scanning forward; match only the exact disposable folder row.
    if(!resetScroll){if(!scrollPicker(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD))resetScroll=true;}
    else scrollPicker(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD);
    scrolls++;SystemClock.sleep(200);continue;
   }
   if(!drawerTried){
    AccessibilityNodeInfo drawer=find(n->documentsNode(n)&&(java.util.Set.of("Show roots","Show navigation drawer").contains(String.valueOf(n.getContentDescription()))||("android.widget.ImageButton".equals(String.valueOf(n.getClassName()))&&n.getParent()!=null&&String.valueOf(n.getParent().getViewIdResourceName()).endsWith(":id/toolbar"))));
    if(drawer!=null&&press(drawer)){drawerTried=true;SystemClock.sleep(200);continue;}
   }
   if(drawerTried&&!storageChosen){
    AccessibilityNodeInfo storage=find(n->documentsNode(n)&&storageRoot.equals(String.valueOf(n.getText())));
    if(storage!=null&&press(storage)){storageChosen=true;resetScroll=false;scrolls=0;SystemClock.sleep(250);continue;}
   }
   SystemClock.sleep(150);
  }
  fail("Tree picker could not enter exact fixture "+folder+" through Download"+(drawerTried&&!storageChosen?"; drawer has no storage root named "+JSONObject.quote(storageRoot):"")+"; DocumentsUI="+pickerState());
 }
 void pickerText(String text)throws Exception{long deadline=SystemClock.elapsedRealtime()+15000;while(SystemClock.elapsedRealtime()<deadline){AccessibilityNodeInfo node=find(n->text.equalsIgnoreCase(String.valueOf(n.getText())));if(node!=null&&press(node))return;SystemClock.sleep(100);}fail("DocumentsUI did not expose "+text+"; "+pickerState());}
 private List<Uri> children(ContentResolver resolver,Uri tree,Uri folder)throws Exception{List<Uri> values=new ArrayList<>();Uri query=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(folder));try(Cursor c=resolver.query(query,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID},null,null,null)){assertNotNull(c);while(c.moveToNext())values.add(DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0)));}return values;}
 String name(ContentResolver resolver,Uri uri){try(Cursor c=resolver.query(uri,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){assertNotNull(c);assertTrue(c.moveToFirst());return c.getString(0);}}
 void removeFixture(ContentResolver resolver,Uri tree,Uri item)throws Exception{String mime=resolver.getType(item);if(DocumentsContract.Document.MIME_TYPE_DIR.equals(mime))for(Uri child:children(resolver,tree,item))removeFixture(resolver,tree,child);DocumentsContract.deleteDocument(resolver,item);}
 @Test public void actualTreeCreateMoveDeleteCancelRestoreAndRevoke()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  assertFalse("Use disposable app state: never replace an existing user-selected tree",context.getSharedPreferences("alpha-files-tree",0).contains("root"));
  String folder="AlphaTree-"+UUID.randomUUID(),file="source-"+UUID.randomUUID()+".txt",text="Tree fixture bytes "+UUID.randomUUID(),destination="Destination",renamed="Renamed destination";
  ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,file);values.put(MediaStore.Downloads.MIME_TYPE,"text/plain");values.put(MediaStore.Downloads.RELATIVE_PATH,"Download/"+folder+"/");values.put(MediaStore.Downloads.IS_PENDING,1);
  Uri seed=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);assertNotNull(seed);Uri treeUri=null;
  try{
   try(java.io.OutputStream out=resolver.openOutputStream(seed)){assertNotNull(out);out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));}ContentValues published=new ContentValues();published.put(MediaStore.Downloads.IS_PENDING,0);resolver.update(seed,published,null,null);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();until("document.documentElement.dataset.activeView");eval(AppNavigation.request("Files"));until(AppNavigation.selected("Files"));
    click("Choose folder");chooseFixtureFolder(folder);pickerText("Use this folder");pickerText("Allow");
    until("document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote("Open "+file))+"+']')");
    String saved=context.getSharedPreferences("alpha-files-tree",0).getString("root",null);assertNotNull("Actual picker persisted its tree grant",saved);treeUri=Uri.parse(saved);Uri root=DocumentsContract.buildDocumentUriUsingTree(treeUri,DocumentsContract.getTreeDocumentId(treeUri));assertEquals(folder,name(resolver,root));
    click("View and sort");click("New folder");input(destination);click("Create folder");until("!document.querySelector('[role=dialog]')");click("Open "+destination);untilFolder(destination);
    click("View and sort");click("Rename folder");input(renamed);click("Rename");until("!document.querySelector('[role=dialog]')");untilFolder(renamed);click("Back to files");
    until("document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote("Open "+renamed))+"+']')");
    click("Open "+file);until("document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(text)+")");
    click("Delete file");until("document.querySelector('[role=dialog]')?.textContent.includes('cannot be undone')");click("Cancel file operation");assertEquals("Cancelling deletion preserves root file",2,children(resolver,treeUri,root).size());
    click("Move file");until("document.querySelector('[role=dialog]')");click("Move into "+renamed);until("[...document.querySelectorAll('[role=dialog] p')].some(e=>e.textContent==="+JSONObject.quote("Destination: "+renamed)+") && document.querySelector('button[aria-label=\"Move here\"]')?.disabled===false");click("Move here");until("!document.querySelector('[role=dialog]')");
    until("!document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote("Open "+file))+"+']')");
    click("Open "+renamed);click("Open "+file);until("document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(text)+")");click("Back");
    scenario.recreate();until("document.documentElement.dataset.activeView==='home'");eval(AppNavigation.request("Files"));until(AppNavigation.selected("Files"));click("Saved folder");click("Open "+renamed);click("Open "+file);until("document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(text)+")");
    click("Delete file");click("Delete permanently");until("!document.querySelector('[role=dialog]')");until("!document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote("Open "+file))+"+']')");
    List<Uri> roots=children(resolver,treeUri,root);assertEquals(1,roots.size());assertEquals(renamed,name(resolver,roots.get(0)));assertTrue("Explicit deletion removes provider bytes",children(resolver,treeUri,roots.get(0)).isEmpty());
    click("View and sort");click("Delete empty folder");click("Delete permanently");until("!document.querySelector('[role=dialog]')");assertTrue(children(resolver,treeUri,root).isEmpty());
    // The listing of the parent has been applied: the refresh below is not dropped as busy, and no read made before the revocation is still on its way.
    until(FOLDER_TITLE+" && "+FOLDER_TITLE+"!=="+JSONObject.quote(renamed));
    // Revoke the actual system grant; renderer refresh must not retain authority.
    int flags=0;for(android.content.UriPermission p:resolver.getPersistedUriPermissions())if(treeUri.equals(p.getUri()))flags=(p.isReadPermission()?1:0)|(p.isWritePermission()?2:0);
    assertTrue(flags!=0);resolver.releasePersistableUriPermission(treeUri,flags);
    click("View and sort");click("Refresh folder");until("document.querySelector('[role=status]')?.textContent.includes('access expired')");
    assertEquals("Revoked state never claims a successful refresh","false",eval("document.querySelector('[role=status]')?.textContent.includes('loaded')===true"));
    // Reauthorize only the same disposable root through the picker so cleanup
    // can remove its empty directory without broad filesystem permission.
    click("View and sort");click("Choose another folder");chooseFixtureFolder(folder);pickerText("Use this folder");pickerText("Allow");until("document.querySelector('button[aria-label=\"View and sort\"]')");

   }
  }finally{
   // This unique test-owned tree contains no user data. If a grant remains,
   // remove only that exact root after verifying its random fixture name.
   if(treeUri!=null)try{Uri root=DocumentsContract.buildDocumentUriUsingTree(treeUri,DocumentsContract.getTreeDocumentId(treeUri));if(folder.equals(name(resolver,root)))removeFixture(resolver,treeUri,root);}catch(Exception ignored){}
   try{resolver.delete(seed,null,null);}catch(Exception ignored){}
   if(treeUri!=null)for(android.content.UriPermission p:resolver.getPersistedUriPermissions())if(treeUri.equals(p.getUri()))try{resolver.releasePersistableUriPermission(treeUri,(p.isReadPermission()?1:0)|(p.isWritePermission()?2:0));}catch(Exception ignored){}
   context.getSharedPreferences("alpha-files-tree",0).edit().remove("root").commit();
  }
 }
}
