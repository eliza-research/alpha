package ai.elizaresearch.alphaphone;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * MVP-13 folder question on Android: a folder the owner granted through DocumentsUI's real tree
 * picker, browsed in Files, asked about with "Ask Alpha about this folder". The review names only
 * that folder's entries by name and type (no file bodies, no nested entries, no neighbouring
 * folder), the reviewed text is what reaches the conversation draft, and a delete or a revoked
 * grant during review adds nothing. Disposable Download/AlphaQuestion-<uuid> fixtures only; the
 * tree grant is released and the fixture removed afterwards. Emulator evidence only.
 */
@RunWith(AndroidJUnit4.class)
public class FilesFolderQuestionInstrumentedTest {
 private static final String REVIEW="document.querySelector('dialog[aria-label=\"Ask about selected content\"]')";
 private static final String EXCERPT=REVIEW+"?.querySelector('textarea[aria-label=\"Content excerpt\"]')";
 private final FilesTreeInstrumentedTest picker=new FilesTreeInstrumentedTest();
 private String eval(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js)throws Exception{long end=SystemClock.elapsedRealtime()+20000;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+js+")")))return;SystemClock.sleep(100);}fail("Folder question condition: "+js+"; UI="+eval("JSON.stringify({view:document.documentElement.dataset.activeView,dialog:"+REVIEW+"?.textContent?.slice(0,600),status:[...document.querySelectorAll('[role=status],[role=alert]')].map(e=>e.textContent).join(' | ').slice(0,600)})"));}
 private void click(String label)throws Exception{String q="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(q+" && !("+q+").disabled");eval("("+q+").click()");}
 /** Menu rows and review buttons are named by their text. */
 private void clickText(String text)throws Exception{String q="[...document.querySelectorAll('button,[role=menuitem],[role=button]')].find(b=>b.textContent.trim()==="+JSONObject.quote(text)+"&&!b.disabled&&b.getClientRects().length)";until(q);eval("("+q+").click()");}
 private void askFolder()throws Exception{click("View and sort");click("Ask Alpha about this folder");until(EXCERPT+"?.value.length>0");}
 private String excerpt()throws Exception{return new JSONObject("{\"v\":"+eval(EXCERPT+".value")+"}").getString("v");}
 private void editExcerpt(String value)throws Exception{eval("(()=>{const e="+EXCERPT+";Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");}
 private Uri seed(ContentResolver resolver,String relative,String name,String body)throws Exception{
  ContentValues values=new ContentValues();values.put(MediaStore.Downloads.DISPLAY_NAME,name);values.put(MediaStore.Downloads.MIME_TYPE,"text/plain");values.put(MediaStore.Downloads.RELATIVE_PATH,relative);values.put(MediaStore.Downloads.IS_PENDING,1);
  Uri uri=resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);
  try(java.io.OutputStream out=resolver.openOutputStream(uri)){assertNotNull(out);out.write(body.getBytes(StandardCharsets.UTF_8));}
  ContentValues published=new ContentValues();published.put(MediaStore.Downloads.IS_PENDING,0);resolver.update(uri,published,null,null);return uri;
 }
 private String name(ContentResolver resolver,Uri uri){try(Cursor c=resolver.query(uri,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){assertNotNull(c);assertTrue(c.moveToFirst());return c.getString(0);}}
 private List<Uri> children(ContentResolver resolver,Uri tree,Uri folder){List<Uri> values=new ArrayList<>();try(Cursor c=resolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getDocumentId(folder)),new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID},null,null,null)){if(c!=null)while(c.moveToNext())values.add(DocumentsContract.buildDocumentUriUsingTree(tree,c.getString(0)));}return values;}
 private void removeFixture(ContentResolver resolver,Uri tree,Uri item)throws Exception{if(DocumentsContract.Document.MIME_TYPE_DIR.equals(resolver.getType(item)))for(Uri child:children(resolver,tree,item))removeFixture(resolver,tree,child);DocumentsContract.deleteDocument(resolver,item);}
 private int grantFlags(ContentResolver resolver,Uri tree){for(UriPermission p:resolver.getPersistedUriPermissions())if(tree.equals(p.getUri()))return (p.isReadPermission()?Intent.FLAG_GRANT_READ_URI_PERMISSION:0)|(p.isWritePermission()?Intent.FLAG_GRANT_WRITE_URI_PERMISSION:0);return 0;}

 @Test public void folderQuestionReviewsOnlyThatFolderAndRefusesADeleteOrRevokeDuringReview()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  assertFalse("Use disposable app state: never replace an existing user-selected tree",context.getSharedPreferences("alpha-files-tree",0).contains("root"));
  String token=UUID.randomUUID().toString(),folder="AlphaQuestion-"+token,first="alpha-"+token+".txt",second="beta-"+token+".txt",nested="deep-"+token+".txt";
  String canary="PRIVATE_FILE_BODY_CANARY_"+token,nestedCanary="PRIVATE_NESTED_CANARY_"+token,neighbor="AlphaQuestionNeighbor-"+token;
  List<Uri> seeds=new ArrayList<>();Uri treeUri=null;
  try{
   seeds.add(seed(resolver,"Download/"+folder+"/",first,canary));
   seeds.add(seed(resolver,"Download/"+folder+"/",second,"two"));
   seeds.add(seed(resolver,"Download/"+folder+"/inner/",nested,nestedCanary));
   seeds.add(seed(resolver,"Download/"+neighbor+"/","neighbor.txt","n"));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();until("document.documentElement.dataset.activeView");eval(AppNavigation.request("Files"));until(AppNavigation.selected("Files"));
    click("Choose folder");picker.chooseFixtureFolder(folder);picker.pickerText("Use this folder");picker.pickerText("Allow");
    until("document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote("Open "+first))+"+']')");
    treeUri=Uri.parse(context.getSharedPreferences("alpha-files-tree",0).getString("root",null));
    Uri root=DocumentsContract.buildDocumentUriUsingTree(treeUri,DocumentsContract.getTreeDocumentId(treeUri));assertEquals(folder,name(resolver,root));

    // The review names this folder's entries only: no bodies, no nested entries, no neighbour.
    askFolder();
    assertEquals("folder "+folder,eval(REVIEW+".querySelector('[aria-label=\"Selected source\"]').textContent.trim()").replace("\"",""));
    String reviewed=excerpt();
    assertTrue(reviewed,reviewed.startsWith("Folder: "+folder+"\n3 entries listed by name and type. File contents and subfolder contents are not included."));
    assertTrue(reviewed,reviewed.contains("- "+first+" (Text)")&&reviewed.contains("- "+second+" (Text)")&&reviewed.contains("- inner (Folder)"));
    assertFalse("No file body, nested entry or neighbouring folder",reviewed.contains(canary)||reviewed.contains(nestedCanary)||reviewed.contains(nested)||reviewed.contains(neighbor));
    // The owner's edit is what reaches the draft.
    editExcerpt("Folder: "+folder+"\n- "+first+" (Text)");clickText("Use in conversation");
    until(AppNavigation.composer()+"?.value==="+JSONObject.quote("What is in this folder?\n\nSource: folder "+folder+"\n\nFolder: "+folder+"\n- "+first+" (Text)"));
    click("Minimize chat");until("document.documentElement.dataset.activeView==='files'");

    // A deleted entry during review adds nothing and the folder shows as it is now.
    askFolder();
    Uri deleted=null;for(Uri child:children(resolver,treeUri,root))if(second.equals(name(resolver,child)))deleted=child;
    assertNotNull(deleted);assertTrue(DocumentsContract.deleteDocument(resolver,deleted));
    clickText("Use in conversation");
    until("document.body.innerText.includes('Nothing was added to your conversation.')");
    until("!"+REVIEW);until("!document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote("Open "+second))+"+']')");

    // A revoked tree grant during review adds nothing and the folder access ends.
    askFolder();
    int flags=grantFlags(resolver,treeUri);assertTrue("Persisted grant before revoke",flags!=0);resolver.releasePersistableUriPermission(treeUri,flags);
    clickText("Use in conversation");
    until("document.body.innerText.includes('Nothing was added to your conversation.')");until("!"+REVIEW);
    until("!document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote("Open "+first))+"+']')");
    assertEquals("Neither refused review reached the conversation","false",eval("[...document.querySelectorAll('textarea[data-alpha-composer]')].some(e=>e.value.includes("+JSONObject.quote(second)+"))"));
    // Reauthorize only the same disposable root so cleanup can remove it without broad storage access.
    click("View and sort");click("Choose another folder");picker.chooseFixtureFolder(folder);picker.pickerText("Use this folder");picker.pickerText("Allow");
    until("document.querySelector('button[aria-label=\"View and sort\"]')");
   }
  }finally{
   if(treeUri!=null)try{Uri root=DocumentsContract.buildDocumentUriUsingTree(treeUri,DocumentsContract.getTreeDocumentId(treeUri));if(folder.equals(name(resolver,root)))removeFixture(resolver,treeUri,root);}catch(Exception ignored){}
   for(Uri seed:seeds)try{resolver.delete(seed,null,null);}catch(Exception ignored){}
   if(treeUri!=null){int flags=grantFlags(resolver,treeUri);if(flags!=0)try{resolver.releasePersistableUriPermission(treeUri,flags);}catch(Exception ignored){}}
   context.getSharedPreferences("alpha-files-tree",0).edit().remove("root").commit();
  }
 }
}
