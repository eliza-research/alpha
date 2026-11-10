package ai.elizaresearch.alphaphone;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Predicate;
import static org.junit.Assert.*;

/** Real MediaStore documents -> real DocumentsUI picker -> bundled React UI.
 * No bridge mocks, injected selection results, or arbitrary URI authorization. */
@RunWith(AndroidJUnit4.class)
public class SelectedDocumentInstrumentedTest {
 private String eval(BoundedActivityScenario<MainActivity> scenario, String script) throws Exception {
  return WebViewTestDriver.evaluate(script);
 }
 private void waitFor(BoundedActivityScenario<MainActivity> scenario, String condition) throws Exception {
  long deadline = SystemClock.elapsedRealtime() + 15000;
  while (SystemClock.elapsedRealtime() < deadline) {
   if ("true".equals(eval(scenario,"Boolean(" + condition + ")"))) return;
   SystemClock.sleep(100);
  }
  fail("Document flow condition timed out: " + condition);
 }
 private void click(BoundedActivityScenario<MainActivity> scenario, String label) throws Exception {
  String target = "[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===" + JSONObject.quote(label) + ")";
  waitFor(scenario, target + " && !(" + target + ").disabled");
  eval(scenario,"(" + target + ").click()");
 }
 Uri fixture(ContentResolver resolver, String name, String text) throws Exception {return fixtureBytes(resolver,name,"text/plain",text.getBytes(StandardCharsets.UTF_8));}
 Uri fixtureBytes(ContentResolver resolver,String name,String mime,byte[] bytes)throws Exception {
  ContentValues values = new ContentValues();
  values.put(MediaStore.Downloads.DISPLAY_NAME, name);
  values.put(MediaStore.Downloads.MIME_TYPE, mime);
  values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
  values.put(MediaStore.Downloads.IS_PENDING, 1);
  Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
  assertNotNull("Create scoped test document", uri);
  try {
   try (OutputStream output = resolver.openOutputStream(uri)) {
    assertNotNull(output); output.write(bytes);
   }
   ContentValues ready = new ContentValues(); ready.put(MediaStore.Downloads.IS_PENDING, 0);
   assertEquals("Publish only this test document",1,resolver.update(uri,ready,null,null));
   return uri;
  } catch (Exception | AssertionError error) { resolver.delete(uri,null,null); throw error; }
 }
 private String providerName(ContentResolver resolver,Uri uri,String expectedMime)throws Exception {
  try(android.database.Cursor cursor=resolver.query(uri,new String[]{MediaStore.Downloads.DISPLAY_NAME,MediaStore.Downloads.MIME_TYPE,MediaStore.Downloads.IS_PENDING},null,null,null)){
   assertNotNull("Published fixture metadata is readable",cursor);assertTrue("Published fixture exists",cursor.moveToFirst());
   assertEquals("Fixture MIME is correct from creation",expectedMime,cursor.getString(1));assertEquals("Fixture bytes were written before publication",0,cursor.getInt(2));
   String actual=cursor.getString(0);assertNotNull(actual);assertFalse(actual.isEmpty());return actual;
  }
 }
 private AccessibilityNodeInfo find(Predicate<AccessibilityNodeInfo> predicate) {
  AccessibilityNodeInfo root = InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
  if (root == null) return null;
  ArrayDeque<AccessibilityNodeInfo> queue = new ArrayDeque<>(); queue.add(root);
  while (!queue.isEmpty()) {
   AccessibilityNodeInfo node = queue.removeFirst();
   if (node.isVisibleToUser() && predicate.test(node)) return node;
   for (int i=0;i<node.getChildCount();i++) { AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child); }
  }
  return null;
 }
 private boolean press(AccessibilityNodeInfo node) {
  for (int i=0;node!=null&&i<5;i++,node=node.getParent())
   if(node.isEnabled()&&node.isClickable()&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return true;
  return false;
 }
 private boolean textEquals(AccessibilityNodeInfo node,String text) {
  return text.contentEquals(node.getText()==null?"":node.getText());
 }
 private String pickerDiagnostics(String filename) {
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
  if(root==null)return "no accessibility root";
  StringBuilder out=new StringBuilder("package="+root.getPackageName());ArrayDeque<AccessibilityNodeInfo> nodes=new ArrayDeque<>();nodes.add(root);int seen=0;
  while(!nodes.isEmpty()&&seen++<400&&out.length()<4000){AccessibilityNodeInfo n=nodes.removeFirst();
   if(n.isVisibleToUser()&&String.valueOf(n.getPackageName()).contains("documentsui")){
    String text=String.valueOf(n.getText()),desc=String.valueOf(n.getContentDescription()),id=String.valueOf(n.getViewIdResourceName());
    boolean known=text.equals(filename)||java.util.Set.of("Downloads","Download","Recent","Images","Documents","No items","No results","Search this phone").contains(text)||text.startsWith("AlphaTree-");
    if(known||id.contains("search")||id.contains("breadcrumb")||desc.equals("Show roots")||desc.equals("Show navigation drawer"))out.append(" [").append(id).append(" text=").append(known?text:"<other>").append(" desc=").append(desc.equals("Show roots")||desc.equals("Show navigation drawer")?desc:"<other>").append(" class=").append(n.getClassName()).append(" clickable=").append(n.isClickable()).append("]");
   }
   for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo c=n.getChild(i);if(c!=null)nodes.add(c);}
  }return out.toString();
 }
 void selectDocument(String filename) throws Exception {
  long deadline=SystemClock.elapsedRealtime()+30000;
  boolean drawerOpened=false,rootChosen=false,listMode=false,rewound=false,searchTried=false;int scrolls=0;
  while(SystemClock.elapsedRealtime()<deadline) {
   AccessibilityNodeInfo file=find(n->String.valueOf(n.getPackageName()).contains("documentsui")&&hasAncestorId(n,"dir_list")&&(textEquals(n,filename)||filename.contentEquals(n.getContentDescription()==null?"":n.getContentDescription())));
   if(file!=null&&press(file))return;
   // Navigate a real root first; Downloads breadcrumbs are not drawer entries.
   if(!drawerOpened){AccessibilityNodeInfo drawer=find(n->String.valueOf(n.getPackageName()).contains("documentsui")&&(String.valueOf(n.getContentDescription()).equals("Show roots")||String.valueOf(n.getContentDescription()).equals("Show navigation drawer")||("android.widget.ImageButton".equals(String.valueOf(n.getClassName()))&&n.getParent()!=null&&String.valueOf(n.getParent().getViewIdResourceName()).endsWith(":id/toolbar"))));if(drawer!=null&&press(drawer)){drawerOpened=true;SystemClock.sleep(200);continue;}}
   if(drawerOpened&&!rootChosen){AccessibilityNodeInfo downloads=find(n->String.valueOf(n.getPackageName()).contains("documentsui")&&textEquals(n,"Downloads")&&hasAncestorId(n,"roots_list"));if(downloads!=null&&press(downloads)){rootChosen=true;SystemClock.sleep(250);continue;}}
   if(!listMode){AccessibilityNodeInfo toggle=find(n->String.valueOf(n.getPackageName()).contains("documentsui")&&String.valueOf(n.getViewIdResourceName()).endsWith(":id/sub_menu_list"));if(toggle!=null&&press(toggle)){listMode=true;SystemClock.sleep(200);continue;}}
   if(rootChosen&&scrolls<35&&SystemClock.elapsedRealtime()<deadline-10000){
    AccessibilityNodeInfo list=find(n->String.valueOf(n.getPackageName()).contains("documentsui")&&n.isScrollable()&&String.valueOf(n.getViewIdResourceName()).endsWith(":id/dir_list"));
    if(list!=null){if(!rewound){if(!list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD))rewound=true;}else if(!list.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD))scrolls=35;scrolls++;SystemClock.sleep(150);continue;}
   }
   if(!searchTried&&SystemClock.elapsedRealtime()>deadline-10000) {
    AccessibilityNodeInfo search=find(n->String.valueOf(n.getPackageName()).contains("documentsui")&&(String.valueOf(n.getViewIdResourceName()).endsWith(":id/option_menu_search")||"Search".contentEquals(n.getContentDescription()==null?"":n.getContentDescription())));
    if(search!=null&&press(search)){
     SystemClock.sleep(200);AccessibilityNodeInfo field=find(n->String.valueOf(n.getPackageName()).contains("documentsui")&&String.valueOf(n.getViewIdResourceName()).endsWith(":id/search_src_text"));
     if(field!=null){Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,filename);assertTrue("Search actual DocumentsUI by exact fixture name",field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args));searchTried=true;}
    }
   }
   SystemClock.sleep(150);
  }
  fail("Real DocumentsUI did not expose fixture " + filename + ". Requires English AOSP DocumentsUI and MediaStore Downloads provider. " + pickerDiagnostics(filename));
 }
 private boolean hasAncestorId(AccessibilityNodeInfo node,String suffix){for(int depth=0;node!=null&&depth<12;depth++,node=node.getParent())if(String.valueOf(node.getViewIdResourceName()).endsWith(":id/"+suffix))return true;return false;}
 @Test public void selectingSecondRealDocumentClearsFirstPreview() throws Exception {
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  ContentResolver resolver=context.getContentResolver();
  String token=UUID.randomUUID().toString();
  String nameA="alpha-flow-A-"+token+".txt",nameB="alpha-flow-B-"+token+".txt";
  String textA="First private fixture "+token,textB="Second private fixture "+token;
  Uri a=null,b=null;
  try {
   a=fixture(resolver,nameA,textA);b=fixture(resolver,nameB,textB);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
    waitFor(scenario,"document.documentElement.dataset.activeView");
    eval(scenario,AppNavigation.request("Files"));
    waitFor(scenario,AppNavigation.selected("Files"));
    click(scenario,"Downloads");selectDocument(nameA);
    waitFor(scenario,"document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(nameA));
    waitFor(scenario,"document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(textA)+")");
    ShareFlowAssertions.opensExactItemAndCancels(()->click(scenario,"Share file"),textA.getBytes(StandardCharsets.UTF_8),"text/plain");
    waitFor(scenario,"document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(nameA));
    ShareFlowAssertions.receivesInSeparateApp(()->click(scenario,"Share file"),textA.getBytes(StandardCharsets.UTF_8));
    waitFor(scenario,"document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(nameA));
    click(scenario,"Ask Alpha");
    waitFor(scenario,"document.querySelector('dialog[aria-label=\"Ask about selected content\"][open]') && document.querySelector('textarea[aria-label=\"Content excerpt\"]').value==="+JSONObject.quote(textA));
    assertEquals("Review does not send the selected document", "true", eval(scenario,"document.querySelector('[data-alpha-layer=conversation]').getAttribute('aria-hidden') === 'true'"));
    eval(scenario,"[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Use in conversation').click()");
    waitFor(scenario,"document.querySelector('[data-alpha-layer=conversation]').getAttribute('aria-hidden') === 'false' && ("+AppNavigation.composer()+")?.value.includes("+JSONObject.quote(textA)+")");
    assertEquals("File remains the active agent view", "\"files\"", eval(scenario,"document.documentElement.dataset.activeView"));
    click(scenario,"Minimize chat");
    waitFor(scenario,"document.querySelector('[data-alpha-layer=conversation]').getAttribute('aria-hidden') === 'true'");
    assertEquals("Selected file survives the conversation", "true", eval(scenario,"document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(nameA)));
    click(scenario,"Back");
    waitFor(scenario,"!document.querySelector('button[aria-label=Rename]')");
    assertEquals("Closing A removes its private text","true",eval(scenario,"!document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(textA)+")"));
    click(scenario,"Downloads");selectDocument(nameB);
    waitFor(scenario,"document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(nameB));
    assertEquals("A is never shown under B's identity","true",eval(scenario,"!document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(textA)+")"));
    waitFor(scenario,"document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(textB)+")");
    assertEquals("B's actual private text replaces A","true",eval(scenario,"!document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(textA)+")"));
    click(scenario,"Back");
    waitFor(scenario,"!document.querySelector('button[aria-label=Rename]')");
    assertEquals("Closing B removes its private text","true",eval(scenario,"!document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(textB)+")"));
   }
  } finally {
   // Only URIs created by this run are removed; no directory or unrelated data cleanup.
   if(a!=null)resolver.delete(a,null,null);
   if(b!=null)resolver.delete(b,null,null);
  }
 }
 private void openFiles(BoundedActivityScenario<MainActivity> scenario)throws Exception{waitFor(scenario,"document.documentElement.dataset.activeView");eval(scenario,AppNavigation.request("Files"));waitFor(scenario,AppNavigation.selected("Files"));}
 private void preview(BoundedActivityScenario<MainActivity> scenario,String name,String text)throws Exception{waitFor(scenario,"document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(name));waitFor(scenario,"document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(text)+")");}
 @Test public void selectedGrantSurvivesActivityRecreationAndExplicitForgetReleasesIt()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();String name="alpha-grant-"+UUID.randomUUID()+".txt",text="Native persistent document lifecycle";Uri file=fixture(resolver,name,text);String selectedId=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   openFiles(scenario);click(scenario,"Downloads");selectDocument(name);preview(scenario,name,text);
   com.getcapacitor.JSObject selected=SelectedDocumentAccess.restore(context);selectedId=selected.getString("selectionId");assertNotNull(selectedId);Uri grant=Uri.parse(selected.getString("uri"));
   assertTrue("Real picker offered persisted read access",resolver.getPersistedUriPermissions().stream().anyMatch(g->g.getUri().equals(grant)&&g.isReadPermission()));
   scenario.recreate();openFiles(scenario);preview(scenario,name,text);
   click(scenario,"Move file");waitFor(scenario,"document.body.innerText.includes('source and destination folders')");preview(scenario,name,text);
   click(scenario,"Forget selected file");waitFor(scenario,"!document.querySelector('button[aria-label=Rename]')");
   long deadline=SystemClock.elapsedRealtime()+5000;while(SystemClock.elapsedRealtime()<deadline&&resolver.getPersistedUriPermissions().stream().anyMatch(g->g.getUri().equals(grant)))SystemClock.sleep(50);
   assertFalse("Explicit forget releases the exact offered grant",resolver.getPersistedUriPermissions().stream().anyMatch(g->g.getUri().equals(grant)));
   scenario.recreate();openFiles(scenario);assertEquals("Forgotten text is not restored","true",eval(scenario,"!document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(text)+")"));
  }finally{if(selectedId!=null)SelectedDocumentAccess.forget(selectedId);resolver.delete(file,null,null);}
 }

 @Test public void renameUsesRealProviderAndUserConfirmation()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();String name="alpha-rename-"+UUID.randomUUID()+".txt",renamed="renamed-"+name,text="Rename retains exact file bytes";Uri file=fixture(resolver,name,text);String selectionId=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   openFiles(scenario);click(scenario,"Downloads");selectDocument(name);preview(scenario,name,text);com.getcapacitor.JSObject selected=SelectedDocumentAccess.restore(context);selectionId=selected.getString("selectionId");boolean supported=selected.optBoolean("canRename");
   click(scenario,"Rename");eval(scenario,"(()=>{const input=document.querySelector('input[aria-label=\"File name\"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,"+JSONObject.quote(renamed)+");input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()");
   waitFor(scenario,"document.querySelector('input[aria-label=\"File name\"]')?.value==="+JSONObject.quote(renamed));
   assertEquals("Editing alone has no provider effect",name,SelectedDocumentAccess.restore(context).getString("name"));click(scenario,"Save name");
   if(supported){try{
    waitFor(scenario,"document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(renamed)+" || Boolean(document.querySelector('button[aria-label=\"Select renamed file\"]'))");
    if("true".equals(eval(scenario,"Boolean(document.querySelector('button[aria-label=\"Select renamed file\"]'))"))){
     assertEquals("A revoked rename grant cannot authorize more reads","unavailable",SelectedDocumentAccess.read(context,selectionId).getString("status"));
     click(scenario,"Select renamed file");selectDocument(renamed);
    }
    preview(scenario,renamed,text);selectionId=SelectedDocumentAccess.restore(context).getString("selectionId");assertEquals("Provider reports actual saved name",renamed,SelectedDocumentAccess.restore(context).getString("name"));}catch(AssertionError failure){
    JSONObject diagnostic=new JSONObject();com.getcapacitor.JSObject actual=SelectedDocumentAccess.restore(context);String actualName=actual.optString("name","");diagnostic.put("selectedStatus",actual.optString("status","")).put("sameSelection",selectionId.equals(actual.optString("selectionId",""))).put("selectedName",actualName.equals(name)?"original":actualName.equals(renamed)?"requested":"other-or-absent").put("canRename",actual.optBoolean("canRename"));
    try(android.database.Cursor row=resolver.query(MediaStore.Files.getContentUri("external"),new String[]{"_display_name"},"_id=? AND owner_package_name=?",new String[]{Long.toString(android.content.ContentUris.parseId(file)),context.getPackageName()},null)){if(row!=null&&row.moveToFirst()){String currentName=row.getString(0);diagnostic.put("fixtureProviderName",currentName.equals(name)?"original":currentName.equals(renamed)?"requested":"other");}else diagnostic.put("fixtureProviderName","absent");}
    diagnostic.put("renderer",eval(scenario,"JSON.stringify({renaming:!!document.querySelector('input[aria-label=\"File name\"]'),inputMatches:document.querySelector('input[aria-label=\"File name\"]')?.value==="+JSONObject.quote(renamed)+",titleOriginal:document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(name)+",titleRequested:document.querySelector('button[aria-label=Rename]')?.textContent==="+JSONObject.quote(renamed)+",permissionError:document.body.innerText.includes('did not grant rename access'),expired:document.body.innerText.includes('Access expired'),providerFailure:document.body.innerText.includes('could not confirm the rename'),emptyName:document.body.innerText.includes('Enter a file name')})"));
    throw new AssertionError("Exact fixture rename did not complete: "+diagnostic,failure);
   }}
   else {waitFor(scenario,"document.body.innerText.includes('did not grant rename access')");assertEquals("Unsupported rename preserves original name",name,SelectedDocumentAccess.restore(context).getString("name"));}
  }finally{if(selectionId!=null)SelectedDocumentAccess.forget(selectionId);resolver.delete(file,null,null);}
 }
 @Test public void realSelectedPdfRendersActualPagesAndRejectsMalformedBytes()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();String suffix=UUID.randomUUID().toString(),name="alpha-pages-"+suffix+".pdf",badName="alpha-invalid-"+suffix+".pdf";Uri file=null,bad=null;String selectionId=null;
  try{
   java.io.ByteArrayOutputStream pdfBytes=new java.io.ByteArrayOutputStream();
   android.graphics.pdf.PdfDocument document=new android.graphics.pdf.PdfDocument();
   try{
    for(int i=1;i<=2;i++){android.graphics.pdf.PdfDocument.Page page=document.startPage(new android.graphics.pdf.PdfDocument.PageInfo.Builder(300,400,i).create());android.graphics.Paint paint=new android.graphics.Paint();paint.setColor(android.graphics.Color.BLACK);paint.setTextSize(20);page.getCanvas().drawText("Real native PDF page "+i,20,60,paint);document.finishPage(page);}
    document.writeTo(pdfBytes);
   }finally{document.close();}
   file=fixtureBytes(resolver,name,"application/pdf",pdfBytes.toByteArray());
   bad=fixtureBytes(resolver,badName,"application/pdf","This is not a PDF".getBytes(StandardCharsets.UTF_8));
   name=providerName(resolver,file,"application/pdf");badName=providerName(resolver,bad,"application/pdf");
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    openFiles(scenario);click(scenario,"Downloads");selectDocument(name);waitFor(scenario,"document.querySelector('img[alt=\"Page 1 of 2\"]')?.naturalWidth > 0");selectionId=SelectedDocumentAccess.restore(context).getString("selectionId");
    click(scenario,"Next PDF page");waitFor(scenario,"document.querySelector('img[alt=\"Page 2 of 2\"]')?.naturalWidth > 0");click(scenario,"Previous PDF page");waitFor(scenario,"document.querySelector('img[alt=\"Page 1 of 2\"]')?.naturalWidth > 0");
    click(scenario,"Forget selected file");waitFor(scenario,"!document.querySelector('button[aria-label=Rename]')");
    long deadline=SystemClock.elapsedRealtime()+5000;java.io.File cached=new java.io.File(context.getCacheDir(),"document-"+selectionId+".png");while(cached.exists()&&SystemClock.elapsedRealtime()<deadline)SystemClock.sleep(50);assertFalse("Forgetting clears rendered document pixels",cached.exists());
    click(scenario,"Downloads");selectDocument(badName);waitFor(scenario,"document.querySelector('[data-screen]').textContent.includes('malformed, encrypted, or larger than 20 MiB')");assertEquals("Malformed PDF never uses simulated pages","true",eval(scenario,"!document.querySelector('img[alt^=\"Page \"]')"));selectionId=SelectedDocumentAccess.restore(context).getString("selectionId");click(scenario,"Forget selected file");
   }
  }finally{if(selectionId!=null)SelectedDocumentAccess.forget(selectionId);if(file!=null)resolver.delete(file,null,null);if(bad!=null)resolver.delete(bad,null,null);}
 }
 /** Invoked by test-native-restart.mjs document in separate instrumentation processes. */
 @Test public void documentProcessRestartPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("documentPhase");org.junit.Assume.assumeTrue("Explicit process-restart runner only",phase!=null);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();android.content.SharedPreferences fixture=context.getSharedPreferences("document-restart-fixture",0);
  if("cleanup".equals(phase)){
   String id=fixture.getString("selectionId",null),uri=fixture.getString("fixtureUri",null);if(id!=null){SelectedDocumentAccess.initialize(context);SelectedDocumentAccess.forget(id);}if(uri!=null)resolver.delete(Uri.parse(uri),null,null);assertTrue(fixture.edit().clear().commit());return;
  }
  if("prepare".equals(phase)){
   assertFalse("Prior restart fixture must be cleaned first",fixture.contains("fixtureUri"));String name="alpha-restart-"+UUID.randomUUID()+".txt",text="Process restart fixture "+UUID.randomUUID();Uri uri=fixture(resolver,name,text);
   assertTrue(fixture.edit().putString("fixtureUri",uri.toString()).putString("name",name).putString("text",text).putInt("pid",android.os.Process.myPid()).commit());
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    openFiles(scenario);click(scenario,"Downloads");selectDocument(name);preview(scenario,name,text);com.getcapacitor.JSObject selected=SelectedDocumentAccess.restore(context);assertEquals("selected",selected.getString("status"));assertTrue(fixture.edit().putString("selectionId",selected.getString("selectionId")).putString("grantUri",selected.getString("uri")).commit());
   }return;
  }
  assertEquals("verify",phase);assertTrue("Fixture setup completed",fixture.contains("selectionId"));assertNotEquals("Actual process restart, not Activity recreation",fixture.getInt("pid",-1),android.os.Process.myPid());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   openFiles(scenario);preview(scenario,fixture.getString("name",""),fixture.getString("text",""));
   Uri grant=Uri.parse(fixture.getString("grantUri",""));for(android.content.UriPermission permission:resolver.getPersistedUriPermissions())if(permission.getUri().equals(grant))resolver.releasePersistableUriPermission(grant,(permission.isReadPermission()?Intent.FLAG_GRANT_READ_URI_PERMISSION:0)|(permission.isWritePermission()?Intent.FLAG_GRANT_WRITE_URI_PERMISSION:0));
   scenario.recreate();openFiles(scenario);waitFor(scenario,"!document.querySelector('button[aria-label=Rename]')");
   assertNotEquals("Revoked grant is removed from native restoration",fixture.getString("selectionId",""),SelectedDocumentAccess.restore(context).optString("selectionId",""));
   assertEquals("Revoked document content is absent","true",eval(scenario,"!document.querySelector('[data-screen]').textContent.includes("+JSONObject.quote(fixture.getString("text",""))+")"));
  }
 }

 // J03 note source references: AlphaMailAttachments.retainSourceReference keeps a reference to a
 // document the owner selected in the real DocumentsUI (only while Android's persisted read grant
 // exists), and openSourceReference hands a viewer exactly the bytes that were reviewed, or nothing.
 private static String sha256(byte[] bytes)throws Exception{StringBuilder hex=new StringBuilder();for(byte b:java.security.MessageDigest.getInstance("SHA-256").digest(bytes))hex.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return hex.toString();}
 private JSONObject plugin(BoundedActivityScenario<MainActivity> scenario,String method,JSONObject args)throws Exception{
  eval(scenario,"window.__sourceReference=null;Capacitor.Plugins.AlphaMailAttachments."+method+"("+args+").then(v=>window.__sourceReference={ok:true,value:v??{}},e=>window.__sourceReference={ok:false,message:String(e?.message??'')})");
  waitFor(scenario,"window.__sourceReference!==null");
  return new JSONObject(eval(scenario,"window.__sourceReference"));
 }
 /** Opens the reference with an intercepted viewer and returns the bytes the viewer was given, or null when refused. */
 private byte[] openReference(BoundedActivityScenario<MainActivity> scenario,String reference,String sha,int size,String mime)throws Exception{
  android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();AtomicReference<Intent> viewer=new AtomicReference<>();
  android.app.Instrumentation.ActivityMonitor monitor=new android.app.Instrumentation.ActivityMonitor(){
   @Override public android.app.Instrumentation.ActivityResult onStartActivity(Intent intent){
    if(!Intent.ACTION_VIEW.equals(intent.getAction()))return null;
    viewer.set(new Intent(intent));return new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null);
   }
  };
  instrumentation.addMonitor(monitor);
  try{
   JSONObject result=plugin(scenario,"openSourceReference",new JSONObject().put("reference",reference).put("sha256",sha).put("size",size).put("mimeType",mime));
   if(!result.getBoolean("ok")){assertNull("A refused reference starts no viewer",viewer.get());return null;}
   assertNotNull("The viewer was started",viewer.get());
   Uri copy=viewer.get().getData();assertNotNull(copy);assertTrue("Read-only grant",(viewer.get().getFlags()&Intent.FLAG_GRANT_READ_URI_PERMISSION)!=0);assertEquals(mime,viewer.get().getType());
   try(java.io.InputStream in=InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver().openInputStream(copy)){assertNotNull(in);return in.readAllBytes();}
  }finally{instrumentation.removeMonitor(monitor);}
 }
 @Test public void sourceReferenceOpensExactBytesAndFailsClosedOnChangeDeletionOrReleasedGrant()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  String suffix=UUID.randomUUID().toString(),name="alpha-source-"+suffix+".txt",text="Reviewed note source "+suffix;byte[] bytes=text.getBytes(StandardCharsets.UTF_8);String sha=sha256(bytes);
  Uri file=fixture(resolver,name,text);String selectionId=null;boolean deleted=false;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   openFiles(scenario);click(scenario,"Downloads");selectDocument(name);preview(scenario,name,text);
   com.getcapacitor.JSObject selected=SelectedDocumentAccess.restore(context);selectionId=selected.getString("selectionId");Uri grant=Uri.parse(selected.getString("uri"));
   JSONObject retained=plugin(scenario,"retainSourceReference",new JSONObject().put("selectionId",selectionId).put("sha256",sha));
   assertTrue("Retained: "+retained.optString("message"),retained.getBoolean("ok"));
   String reference=retained.getJSONObject("value").optString("reference",null);
   assertNotNull("A persisted DocumentsUI grant yields a reference",reference);assertTrue(reference.matches("a1:[a-f0-9]{64}"));
   // A stale review (another hash) never retains a reference.
   assertFalse("Retaining with other bytes' hash is refused",plugin(scenario,"retainSourceReference",new JSONObject().put("selectionId",selectionId).put("sha256","0".repeat(64))).getBoolean("ok"));
   byte[] opened=openReference(scenario,reference,sha,bytes.length,"text/plain");
   assertNotNull("The linked source opens",opened);assertArrayEquals("The viewer receives exactly the reviewed bytes",bytes,opened);
   assertNull("A different expected hash is refused",openReference(scenario,reference,"f".repeat(64),bytes.length,"text/plain"));
   // Modified bytes fail closed.
   try(OutputStream out=resolver.openOutputStream(file,"wt")){assertNotNull(out);out.write((text+" changed").getBytes(StandardCharsets.UTF_8));}
   assertNull("Changed bytes fail closed",openReference(scenario,reference,sha,bytes.length,"text/plain"));
   try(OutputStream out=resolver.openOutputStream(file,"wt")){assertNotNull(out);out.write(bytes);}
   assertArrayEquals("Restored bytes open again",bytes,openReference(scenario,reference,sha,bytes.length,"text/plain"));
   // A released grant fails closed.
   resolver.releasePersistableUriPermission(grant,Intent.FLAG_GRANT_READ_URI_PERMISSION);
   assertNull("A released grant fails closed",openReference(scenario,reference,sha,bytes.length,"text/plain"));
   // A deleted file fails closed (a fresh selection and reference first, so only deletion differs).
   click(scenario,"Back");waitFor(scenario,"!document.querySelector('button[aria-label=Rename]')");
   click(scenario,"Downloads");selectDocument(name);preview(scenario,name,text);selectionId=SelectedDocumentAccess.restore(context).getString("selectionId");
   String second=plugin(scenario,"retainSourceReference",new JSONObject().put("selectionId",selectionId).put("sha256",sha)).getJSONObject("value").optString("reference",null);
   assertNotNull(second);assertArrayEquals(bytes,openReference(scenario,second,sha,bytes.length,"text/plain"));
   assertEquals(1,resolver.delete(file,null,null));deleted=true;
   assertNull("A deleted source fails closed",openReference(scenario,second,sha,bytes.length,"text/plain"));
  }finally{if(selectionId!=null)SelectedDocumentAccess.forget(selectionId);if(!deleted)resolver.delete(file,null,null);}
 }
 /** node scripts/test-native-restart.mjs source-reference: prepare retains a reference in one
  * process; verify (a new process) reopens exactly the same bytes through it; cleanup releases. */
 @Test public void sourceReferenceProcessRestartPhase()throws Exception{
  String phase=InstrumentationRegistry.getArguments().getString("sourceReferencePhase");
  org.junit.Assume.assumeTrue("Explicit process-restart runner only","prepare".equals(phase)||"verify".equals(phase)||"cleanup".equals(phase));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();android.content.SharedPreferences fixture=context.getSharedPreferences("source-reference-restart-fixture",0);
  if("cleanup".equals(phase)){
   String id=fixture.getString("selectionId",null),uri=fixture.getString("fixtureUri",null);if(id!=null){SelectedDocumentAccess.initialize(context);SelectedDocumentAccess.forget(id);}if(uri!=null)resolver.delete(Uri.parse(uri),null,null);assertTrue(fixture.edit().clear().commit());return;
  }
  if("prepare".equals(phase)){
   assertFalse("Prior restart fixture must be cleaned first",fixture.contains("fixtureUri"));String name="alpha-source-restart-"+UUID.randomUUID()+".txt",text="Source restart fixture "+UUID.randomUUID();Uri uri=fixture(resolver,name,text);
   assertTrue(fixture.edit().putString("fixtureUri",uri.toString()).putString("name",name).putString("text",text).putInt("pid",android.os.Process.myPid()).commit());
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    openFiles(scenario);click(scenario,"Downloads");selectDocument(name);preview(scenario,name,text);String id=SelectedDocumentAccess.restore(context).getString("selectionId");
    assertTrue(fixture.edit().putString("selectionId",id).commit());
    JSONObject retained=plugin(scenario,"retainSourceReference",new JSONObject().put("selectionId",id).put("sha256",sha256(text.getBytes(StandardCharsets.UTF_8))));
    String reference=retained.getJSONObject("value").optString("reference",null);assertNotNull("Reference retained",reference);
    assertTrue(fixture.edit().putString("reference",reference).commit());
   }return;
  }
  assertTrue("Fixture setup completed",fixture.contains("reference"));assertNotEquals("Actual process restart, not Activity recreation",fixture.getInt("pid",-1),android.os.Process.myPid());
  byte[] bytes=fixture.getString("text","").getBytes(StandardCharsets.UTF_8);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   waitFor(scenario,"window.Capacitor?.Plugins?.AlphaMailAttachments&&document.documentElement.dataset.activeView");
   assertArrayEquals("A new process reopens exactly the reviewed bytes",bytes,openReference(scenario,fixture.getString("reference",""),sha256(bytes),bytes.length,"text/plain"));
  }
 }
}
