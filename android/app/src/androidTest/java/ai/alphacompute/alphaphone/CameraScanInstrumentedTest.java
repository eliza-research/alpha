package ai.alphacompute.alphaphone;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Real CameraX scan capture (asked for through Alpha in Camera), real DocumentsUI image picker and real
 * SAF PDF export. Scan captures and picked pages never publish to Photos unless Keep photo is chosen. */
@RunWith(AndroidJUnit4.class)
public class CameraScanInstrumentedTest {
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private String eval(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js,long millis)throws Exception{
  long end=SystemClock.elapsedRealtime()+millis;while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+js+")")))return;SystemClock.sleep(150);}
  fail("Scan condition: "+js+"; dialogs="+eval("JSON.stringify([...document.querySelectorAll('dialog')].map(d=>({label:d.getAttribute('aria-label'),status:[...d.querySelectorAll('[role=status]')].map(e=>e.textContent.slice(0,200)),buttons:[...d.querySelectorAll('button')].map(b=>b.textContent+(b.disabled?' (disabled)':''))})))"));
 }
 private void until(String js)throws Exception{until(js,20000);}
 private void click(String label)throws Exception{String q="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";until(q+" && !("+q+").disabled");eval("("+q+").click()");}
 private void clickText(String text)throws Exception{String q="[...document.querySelectorAll('dialog button')].find(b=>b.textContent.trim()==="+JSONObject.quote(text)+"&&!b.disabled)";until(q,120000);eval("("+q+").click()");}
 /** The scan review's dismiss control reads Cancel scan until OCR finishes, then Close scan. */
 private void closeScan()throws Exception{String q="[...document.querySelectorAll('dialog button')].find(b=>['Cancel scan','Close scan'].includes(b.textContent.trim()))";until(q);eval("("+q+").click()");}
 private String dialog(String label){return "document.querySelector('dialog[aria-label="+JSONObject.quote(label).replace("\"","\\\"")+"]')";}
 private Set<Long> ownedImages(){
  Set<Long> ids=new HashSet<>();
  try(Cursor c=context().getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Images.Media._ID},MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=?",new String[]{context().getPackageName()},null)){
   assertNotNull("MediaStore returned a Photos cursor",c);
   while(c.moveToNext())ids.add(c.getLong(0));
  }
  return ids;
 }
 private byte[] page(String text)throws Exception{
  Bitmap bitmap=Bitmap.createBitmap(1200,900,Bitmap.Config.ARGB_8888);
  try{Canvas canvas=new Canvas(bitmap);canvas.drawColor(Color.WHITE);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);paint.setColor(Color.BLACK);paint.setTextSize(120);canvas.drawText(text,80,480,paint);
   ByteArrayOutputStream out=new ByteArrayOutputStream();assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,out));return out.toByteArray();}
  finally{bitmap.recycle();}
 }
 private void nativeSave()throws Exception{nativeSave(null);}
 private void nativeSave(String filename)throws Exception{
  long end=SystemClock.elapsedRealtime()+20000;
  boolean named=filename==null;
  while(SystemClock.elapsedRealtime()<end){
   AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   if(root!=null){
    ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);
    while(!queue.isEmpty()){
     AccessibilityNodeInfo node=queue.remove();
     if(node.isEnabled()&&String.valueOf(node.getPackageName()).contains("documentsui")){
      if(!named&&node.isEditable()&&String.valueOf(node.getViewIdResourceName()).endsWith(":id/title")){
       android.os.Bundle args=new android.os.Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,filename);
       assertTrue("Set the exact test filename in DocumentsUI",node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args));named=true;break;
      }
      if(named&&"save".equalsIgnoreCase(String.valueOf(node.getText()))){assertTrue("Actual DocumentsUI Save",node.performAction(AccessibilityNodeInfo.ACTION_CLICK));return;}
     }
     for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}
    }
   }
   SystemClock.sleep(100);
  }
  fail("DocumentsUI Save not exposed");
 }
 private String shell(String command)throws Exception{try(java.io.InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))){return new String(input.readAllBytes(),StandardCharsets.ISO_8859_1);}}
 /** Reviewed PDF exports in Downloads, one path per line. `?` stands for the spaces in the product's file name. */
 private String exports()throws Exception{return shell("find /sdcard/Download -maxdepth 1 -type f -name Alpha?searchable?document?*.pdf");}
 /** Scanning is not a camera mode: asking Alpha to scan in Camera captures one frame into scan review. */
 private void scan()throws Exception{
  eval(AppNavigation.request("Camera"));until(AppNavigation.selected("Camera"));until("document.querySelector('[data-alpha-camera-screen]')");
  eval(AppNavigation.type());until(AppNavigation.composer());
  eval("(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Scan this');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  click("Send");until(dialog("Review scanned text"));
 }

 private static View findCameraPreview(View view){
  if(view.getClass().getName().equals("androidx.camera.view.PreviewView"))return view;
  if(view instanceof ViewGroup group)for(int index=0;index<group.getChildCount();index++){
   View found=findCameraPreview(group.getChildAt(index));if(found!=null)return found;
  }
  return null;
 }
 private View streamingPreview()throws Exception{
  AtomicReference<View> streaming=new AtomicReference<>();
  long deadline=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<deadline){
   WebViewTestDriver.withActivity(MainActivity.class,activity->{
    View view=findCameraPreview(activity.getWindow().getDecorView());
    if(view==null)return;
    try{
     Object stream=view.getClass().getMethod("getPreviewStreamState").invoke(view);
     Object state=stream.getClass().getMethod("getValue").invoke(stream);
     if("STREAMING".equals(String.valueOf(state))&&view.isShown())streaming.set(view);
    }catch(ReflectiveOperationException error){throw new AssertionError("Cannot read CameraX preview state",error);}
   });
   if(streaming.get()!=null)return streaming.get();
   SystemClock.sleep(100);
  }
  throw new AssertionError("CameraX PreviewView did not stream");
 }
 private void captureScreen(String filename)throws Exception{
  Bitmap screenshot=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
  assertNotNull("Actual Android screen",screenshot);
  try(FileOutputStream output=new FileOutputStream(new File(context().getFilesDir(),filename))){
   assertTrue("Screenshot encoded",screenshot.compress(Bitmap.CompressFormat.PNG,100,output));
  }finally{screenshot.recycle();}
 }
 private void captureDocumentPage(String captureDialog)throws Exception{
  clickText("Capture page");
  until(captureDialog+"?.querySelector('img')?.naturalWidth>0");
  assertEquals("Captured JPEG keeps a bounded long edge","true",eval("(()=>{const img="+captureDialog+".querySelector('img');return img.naturalWidth<=2048&&img.naturalHeight>0&&img.naturalHeight<=2048})()"));
 }

 /** Fresh owned emulator user. The capture and PDF paths use CameraX and SAF end to end. */
 @Test public void directDocumentCameraRetakeDraftAndPdf()throws Exception{
  Assume.assumeTrue("Owned camera document campaign: -e cameraDocument 1","1".equals(InstrumentationRegistry.getArguments().getString("cameraDocument")));
  assertTrue("Disposable secondary user required",android.os.Process.myUid()/100000>0);
  AppNavigation.assumeNoRequiredSignIn("Camera document capture");
  assertEquals("Fixture Photos read permission",android.content.pm.PackageManager.PERMISSION_GRANTED,context().checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES));
  ContentResolver resolver=context().getContentResolver();
  Uri probe=new SelectedDocumentInstrumentedTest().fixtureBytes(resolver,"alpha-camera-photos-probe-"+UUID.randomUUID()+".png","image/png",page("PHOTOS PROBE"));
  assertTrue("Observer sees a real app-owned image",ownedImages().contains(ContentUris.parseId(probe)));
  assertEquals("Remove the positive control before scanning",1,resolver.delete(probe,null,null));
  Set<Long> before=ownedImages();
  String builder=dialog("Review scan document"),capture=dialog("Capture document page");
  String filename="alpha-document-test-"+UUID.randomUUID()+".pdf";
  File exported=new File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS),filename);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();eval(AppNavigation.request("Camera"));until(AppNavigation.selected("Camera"));AppNavigation.declineStartupAccess();
   View preview=streamingPreview();click("Scan document");until(builder);
   click("Capture new page");until(capture);
   until("getComputedStyle("+capture+").backgroundColor==='rgba(0, 0, 0, 0)'&&getComputedStyle("+builder+").visibility==='hidden'&&document.querySelector('[data-alpha-camera=\"viewfinder\"][data-alpha-camera-clear]')");
   assertSame("The scanner uses Camera's streaming preview",preview,streamingPreview());
   captureScreen("camera-document-viewfinder.png");
   captureDocumentPage(capture);clickText("Cancel capture");until("!"+capture);
   assertEquals("Cancelled page stays out of the document","0",eval(builder+".querySelectorAll('img').length"));

   click("Capture new page");captureDocumentPage(capture);clickText("Use captured page");until(builder+".querySelectorAll('img').length===1");
   click("Capture new page");captureDocumentPage(capture);clickText("Use captured page");until(builder+".querySelectorAll('img').length===2");
   String original=eval(builder+".querySelector('img').src");
   click("Retake page 1");captureDocumentPage(capture);clickText("Retake capture");captureDocumentPage(capture);
   captureScreen("camera-document-review.png");
   clickText("Use captured page");until(builder+".querySelectorAll('img').length===2&&"+builder+".querySelector('img').src!=="+original);
   assertEquals("Capture and retake publish no Photos rows",before,ownedImages());

   click("Close document");clickText("Keep draft");until("!"+builder);
   scenario.recreate();AppNavigation.liveMode();eval(AppNavigation.request("Camera"));until(AppNavigation.selected("Camera"));
   click("Scan document");
   until(builder+"?.querySelectorAll('img').length===0");
   click("Resume the saved draft");
   until(builder+".querySelectorAll('img').length===2 && "+builder+".textContent.includes('Draft loaded')");
   captureScreen("camera-document-draft.png");
   click("Save document PDF");nativeSave(filename);
   until(builder+".textContent.includes('Saved.')",60000);
   try(android.os.ParcelFileDescriptor fd=android.os.ParcelFileDescriptor.open(exported,android.os.ParcelFileDescriptor.MODE_READ_ONLY);
       android.graphics.pdf.PdfRenderer pdf=new android.graphics.pdf.PdfRenderer(fd)){
    assertEquals("Actual SAF PDF has the two reviewed pages",2,pdf.getPageCount());
   }
   assertEquals("Export publishes no Photos rows",before,ownedImages());
  }
  // The runner removes the disposable user and its files. Cleanup outside the
  // test process preserves the first failing assertion if MediaStore is unavailable.
 }

 @Test public void scanCaptureNeverPublishesToPhotosUnlessKept()throws Exception{
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(),Manifest.permission.CAMERA);
  ContentResolver resolver=context().getContentResolver();Set<Long> before=ownedImages(),created=new HashSet<>();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();until("document.documentElement.dataset.activeView");scan();
   until(dialog("Review scanned text")+".textContent.includes('not saved to Photos unless you choose Keep photo')");
   SystemClock.sleep(1500);assertEquals("Scan capture is held in memory only",before,ownedImages());
   clickText("Keep photo");until(dialog("Review scanned text")+".textContent.includes('Kept in Photos.')");
   created.addAll(ownedImages());created.removeAll(before);assertEquals("Keep photo publishes exactly one image",1,created.size());
   closeScan();until("!"+dialog("Review scanned text"));
  }finally{
   created.addAll(ownedImages());created.removeAll(before);for(long id:created)resolver.delete(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,id),null,null);
  }
 }

 /** Three pages: the scan capture plus two picked pages, reviewed as a searchable
  * PDF and written through the real Storage Access Framework destination. */
 @Test public void nativeThreePageSearchablePdfExportsThroughSaf()throws Exception{
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(),Manifest.permission.CAMERA);
  ContentResolver resolver=context().getContentResolver();String run=UUID.randomUUID().toString().substring(0,8);List<Uri> fixtures=new ArrayList<>();Set<Long> before=null;long started=System.currentTimeMillis();
  String listing="";Set<String> earlier=new TreeSet<>(Arrays.asList(exports().split("\n")));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   for(String text:new String[]{"PAGE TWO","PAGE THREE"})fixtures.add(new SelectedDocumentInstrumentedTest().fixtureBytes(resolver,"alpha-page-"+run+"-"+text.replace(' ','-')+".png","image/png",page(text)));
   // The fixture pages are PNGs this process wrote to Downloads; MediaStore lists them as images owned
   // by this package, so the baseline is taken once they exist.
   before=ownedImages();
   AppNavigation.liveMode();until("document.documentElement.dataset.activeView");scan();
   clickText("Build multi-page PDF");until(dialog("Review scan document")+"?.querySelectorAll('img').length===1");
   for(int i=0;i<2;i++){clickText("Add page");new SelectedDocumentInstrumentedTest().selectDocument("alpha-page-"+run+"-"+(i==0?"PAGE-TWO":"PAGE-THREE")+".png");until(dialog("Review scan document")+"?.querySelectorAll('img').length==="+(i+2),30000);}
   clickText("Save draft");until(dialog("Review scan document")+".textContent.includes('restored after Alpha restarts')");
   // Process death: the reviewed draft is restored from device storage.
   // The document review opens from a new scan; resuming the draft replaces that one page after a confirmation.
   scenario.recreate();AppNavigation.liveMode();until("document.documentElement.dataset.activeView");scan();
   clickText("Build multi-page PDF");until(dialog("Review scan document"));eval("window.confirm=()=>true");clickText("Resume draft");until(dialog("Review scan document")+"?.querySelectorAll('img').length===3",30000);
   clickText("Save searchable PDF");until(dialog("Review searchable PDF"));
   clickText("Save reviewed searchable PDF");nativeSave();
   // The loaded-draft status also says "saved"; wait for the provider's verified export receipt.
   until(dialog("Review scan document")+"?.textContent.includes('Saved.')",60000);
   assertEquals("No page was published to Photos",before,ownedImages());
   listing=exports();
  }finally{for(Uri uri:fixtures)resolver.delete(uri,null,null);}
  Set<String> created=new TreeSet<>(Arrays.asList(listing.split("\n")));created.removeAll(earlier);created.remove("");
  assertEquals("SAF wrote exactly one reviewed PDF to Downloads: "+listing,1,created.size());
  // The export's name contains spaces and executeShellCommand does not parse quotes, so the file is
  // addressed through find with its unique timestamp suffix (no whitespace) as the pattern.
  String exported=created.iterator().next(),stamp=exported.substring(exported.lastIndexOf(' ')+1);
  assertTrue("Export name: "+exported,exported.startsWith("/sdcard/Download/Alpha searchable document ")&&stamp.matches("[0-9TZ-]+\\.pdf"));
  String only="find /sdcard/Download -maxdepth 1 -type f -name *"+stamp;
  try{
   String pdf=shell(only+" -exec cat {} ;");assertTrue("Real PDF bytes",pdf.startsWith("%PDF-"));
   // The writer stores page objects and content in Flate streams, so the page count comes from
   // Android's own PDF renderer and the text layer from the inflated content streams.
   byte[] bytes=pdf.getBytes(StandardCharsets.ISO_8859_1);java.io.File copy=new java.io.File(context().getCacheDir(),"alpha-scan-export-"+run+".pdf");
   try{
    java.nio.file.Files.write(copy.toPath(),bytes);
    try(android.os.ParcelFileDescriptor fd=android.os.ParcelFileDescriptor.open(copy,android.os.ParcelFileDescriptor.MODE_READ_ONLY);android.graphics.pdf.PdfRenderer renderer=new android.graphics.pdf.PdfRenderer(fd)){assertEquals("Exactly three pages exported",3,renderer.getPageCount());}
   }finally{copy.delete();}
   StringBuilder content=new StringBuilder();Matcher streams=Pattern.compile("stream\\r?\\n",Pattern.DOTALL).matcher(pdf);
   while(streams.find()){
    int start=streams.end(),end=pdf.indexOf("endstream",start);if(end<0)break;
    java.util.zip.Inflater inflater=new java.util.zip.Inflater();inflater.setInput(bytes,start,end-start);byte[] buffer=new byte[65536];
    try{int total=0,n;while(total<(8<<20)&&(n=inflater.inflate(buffer))>0){content.append(new String(buffer,0,n,StandardCharsets.ISO_8859_1));total+=n;}}catch(java.util.zip.DataFormatException notFlate){/* An image or uncompressed stream. */}finally{inflater.end();}
   }
   assertTrue("Searchable PDF carries a text layer",Pattern.compile("\\b(Tj|TJ)\\b").matcher(content).find()&&content.indexOf("BT")>=0);
   assertTrue("Export is recent",Long.parseLong(shell(only+" -exec stat -c %Y {} ;").trim())*1000>=started-5000);
  }finally{shell(only+" -delete");}
 }
}
