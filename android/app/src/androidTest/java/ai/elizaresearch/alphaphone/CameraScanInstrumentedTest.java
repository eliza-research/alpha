package ai.elizaresearch.alphaphone;

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
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
  try(Cursor c=context().getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Images.Media._ID},MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=?",new String[]{context().getPackageName()},null)){if(c!=null)while(c.moveToNext())ids.add(c.getLong(0));}
  return ids;
 }
 private byte[] page(String text)throws Exception{
  Bitmap bitmap=Bitmap.createBitmap(1200,900,Bitmap.Config.ARGB_8888);
  try{Canvas canvas=new Canvas(bitmap);canvas.drawColor(Color.WHITE);Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);paint.setColor(Color.BLACK);paint.setTextSize(120);canvas.drawText(text,80,480,paint);
   ByteArrayOutputStream out=new ByteArrayOutputStream();assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,out));return out.toByteArray();}
  finally{bitmap.recycle();}
 }
 private void nativeSave()throws Exception{
  long end=SystemClock.elapsedRealtime()+20000;
  while(SystemClock.elapsedRealtime()<end){
   AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   if(root!=null){ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);while(!queue.isEmpty()){AccessibilityNodeInfo node=queue.remove();if(node.isEnabled()&&"save".equalsIgnoreCase(String.valueOf(node.getText()))&&String.valueOf(node.getPackageName()).contains("documentsui")){assertTrue("Actual DocumentsUI Save",node.performAction(AccessibilityNodeInfo.ACTION_CLICK));return;}for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}}}
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
   until(dialog("Review scan document")+"?.textContent.includes('exact bytes verified')",60000);
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
