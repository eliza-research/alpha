package ai.elizaresearch.alphaphone;
import android.content.*;
import android.database.Cursor;
import android.graphics.*;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.util.*;
import org.json.*;
import org.junit.Assume;
import org.junit.Test;
import static org.junit.Assert.*;
/** Real native image edit via prototype UI; only synthetic owned pixels. */
public final class PhotoEditInstrumentedTest {
 private String js(String s)throws Exception{return WebViewTestDriver.evaluate(s);}
 private void until(String s)throws Exception{for(int i=0;i<250;i++){if("true".equals(js("Boolean("+s+")")))return;SystemClock.sleep(100);}fail("Photo edit condition: "+s);}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('button')].find(e=>e.getClientRects().length&&!e.disabled&&e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(q);js("("+q+").click()");}
 private JSONObject call(String method,JSONObject args)throws Exception{js("window.__editResult=null;Capacitor.nativePromise('AlphaPhotos',"+JSONObject.quote(method)+","+args+").then(v=>{v=v||{};delete v.image;window.__editResult=v},()=>window.__editResult={rejected:true})");until("window.__editResult!==null");return new JSONObject(js("window.__editResult"));}
 private byte[] bytes(ContentResolver r,Uri uri)throws Exception{try(InputStream in=r.openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){assertNotNull(in);byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){assertTrue(out.size()+n<1024*1024);out.write(b,0,n);}return out.toByteArray();}}
 private List<Uri> copies(ContentResolver r,String token)throws Exception{ArrayList<Uri> out=new ArrayList<>();try(Cursor rows=r.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{"_id"},"owner_package_name=? AND _display_name=?",new String[]{InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(),"Alpha-edit-"+token+".png"},null)){assertNotNull(rows);while(rows.moveToNext())out.add(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,rows.getLong(0)));}return out;}
 @Test public void copyPreviewGeometryCancelReconciliationAndOriginalPreservation()throws Exception{
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver r=c.getContentResolver();Uri original=null;String copiedId=null;Set<String> tokens=new HashSet<>();
  try{
   ContentValues v=new ContentValues();v.put("_display_name","alpha-edit-fixture-"+UUID.randomUUID()+".png");v.put("mime_type","image/png");v.put("relative_path","Pictures/AlphaPhone-tests/");v.put("is_pending",1);original=r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,v);assertNotNull(original);
   Bitmap fixture=Bitmap.createBitmap(120,80,Bitmap.Config.ARGB_8888);for(int y=0;y<80;y++)for(int x=0;x<120;x++)fixture.setPixel(x,y,y<40?(x<60?Color.RED:Color.GREEN):(x<60?Color.BLUE:Color.YELLOW));try(OutputStream out=r.openOutputStream(original)){assertNotNull(out);assertTrue(fixture.compress(Bitmap.CompressFormat.PNG,100,out));}finally{fixture.recycle();}v.clear();v.put("is_pending",0);r.update(original,v,null,null);byte[] before=bytes(r,original);String id=Long.toString(ContentUris.parseId(original));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();assertEquals("No prior uncertain photo save may be disturbed","null",js("localStorage.getItem('alpha.photos.pending-copy.v1')"));js(AppNavigation.request("Photos"));until(AppNavigation.selected("Photos"));until("document.querySelector('[data-owned-media-id=\"native-camera-"+id+"\"]')");js("document.querySelector('[data-owned-media-id=\"native-camera-"+id+"\"]').click()");
    // Observe only edit IDs/geometry; never expose preview/base64 in diagnostics.
    js("window.__editNative=Capacitor.nativePromise;window.__editMeta=null;window.__dropCopyReceipt=false;Capacitor.nativePromise=function(p,m,a){return window.__editNative.apply(this,arguments).then(v=>{if(p==='AlphaPhotos'&&(m==='beginEdit'||m==='previewEdit'))window.__editMeta={sessionId:v.sessionId,width:v.width,height:v.height,filter:v.filter};if(p==='AlphaPhotos'&&m==='saveEdit'&&window.__holdCopyReceipt){window.__holdCopyReceipt=false;return new Promise(resolve=>window.__releaseCopyReceipt=()=>{window.__releaseCopyReceipt=null;resolve(v);});}if(p==='AlphaPhotos'&&m==='saveEdit'&&window.__dropCopyReceipt){window.__dropCopyReceipt=false;throw Error('Controlled lost response after native save');}return v;});}");
    try{
     click("Edit photo");until("window.__editMeta&&document.querySelector('[aria-label=\"Cancel edit\"]')");String cancelled=new JSONObject(js("window.__editMeta")).getString("sessionId");tokens.add(cancelled);click("Rotate");until("window.__editMeta.width===80");click("Cancel edit");until("!document.querySelector('[aria-label=\"Cancel edit\"]')");assertEquals(0,copies(r,cancelled).size());assertArrayEquals(before,bytes(r,original));
     js("window.__editMeta=null");click("Edit photo");until("window.__editMeta");String saved=new JSONObject(js("window.__editMeta")).getString("sessionId");tokens.add(saved);click("Rotate");until("window.__editMeta.width===80&&window.__editMeta.height===120");click("Crop");until("window.__editMeta.width===61&&window.__editMeta.height===92");
     js("window.__dropCopyReceipt=true");click("Save edit");until("!document.querySelector('[aria-label=\"Cancel edit\"]')&&localStorage.getItem('alpha.photos.pending-copy.v1')===null");List<Uri> found=copies(r,saved);assertEquals("Lost-response reconciliation must produce exactly one published copy",1,found.size());Uri copy=found.get(0);copiedId=Long.toString(ContentUris.parseId(copy));assertArrayEquals("Original byte hash input stays exact",before,bytes(r,original));
     byte[] exported=bytes(r,copy);Bitmap edited=BitmapFactory.decodeByteArray(exported,0,exported.length);assertNotNull(edited);try{assertEquals(61,edited.getWidth());assertEquals(92,edited.getHeight());assertEquals(Color.BLUE,edited.getPixel(5,5));assertEquals(Color.RED,edited.getPixel(55,5));assertEquals(Color.YELLOW,edited.getPixel(5,86));assertEquals(Color.GREEN,edited.getPixel(55,86));}finally{edited.recycle();}
     // Emulate only the interrupted receipt projection after real publication.
     // Reconciliation must durably terminalize it so bounded history can reclaim it.
     android.content.SharedPreferences receipts=c.getSharedPreferences("alpha-photo-edit-results",0);JSONObject interrupted=new JSONObject(receipts.getString(saved,"{}"));interrupted.put("status","incomplete");assertTrue(receipts.edit().putString(saved,interrupted.toString()).commit());
     assertEquals("saved",call("editResult",new JSONObject().put("operationId",saved)).getString("status"));assertEquals("saved",new JSONObject(receipts.getString(saved,"{}")).getString("status"));assertEquals(1,copies(r,saved).size());
     // Actual native previews for every reference filter control; then hold a
     // genuine successful save response until the user has left Photos.
     js("window.__editMeta=null");click("Edit photo");until("window.__editMeta");String late=new JSONObject(js("window.__editMeta")).getString("sessionId");tokens.add(late);
     String[][] controls={{"Vivid","vivid"},{"Warm","warm"},{"Cool","cool"},{"Mono","mono"},{"Fade","fade"},{"Noir","noir"},{"Original","none"}};
     for(String[] control:controls){click(control[0]+" filter");until("window.__editMeta.filter==="+JSONObject.quote(control[1]));}
     click("Rotate");until("window.__editMeta.width===92&&window.__editMeta.height===61");js("window.__holdCopyReceipt=true");click("Save edit");until("typeof window.__releaseCopyReceipt==='function'");assertEquals(1,copies(r,late).size());click("Cancel edit");js(AppNavigation.request("Home"));until(AppNavigation.selected("Home"));js("window.__releaseCopyReceipt()");until("localStorage.getItem('alpha.photos.pending-copy.v1')===null");assertEquals("Late save cannot navigate away from the newer Home view","true",js(AppNavigation.selected("Home")));
    }finally{js("if(window.__releaseCopyReceipt)window.__releaseCopyReceipt();if(window.__editNative){Capacitor.nativePromise=window.__editNative;delete window.__editNative;}");}
    scenario.recreate();AppNavigation.liveMode();js(AppNavigation.request("Photos"));until(AppNavigation.selected("Photos"));assertNotNull(copiedId);until("document.querySelector('[data-owned-media-id=\"native-camera-"+copiedId+"\"]')");js("document.querySelector('[data-owned-media-id=\"native-camera-"+copiedId+"\"]').click()");until("document.body.innerText.includes('61 × 92')");assertArrayEquals(before,bytes(r,original));
    JSONObject metadata=call("read",new JSONObject().put("id",id)),session=call("beginEdit",new JSONObject().put("id",id).put("revision",metadata.getString("mutationRevision")));String stale=session.getString("sessionId");tokens.add(stale);
    v.clear();v.put("is_trashed",1);assertEquals(1,r.update(original,v,null,null));assertTrue("Trashed source cannot export a stale snapshot",call("saveEdit",new JSONObject().put("sessionId",stale).put("rotation",90).put("crop",false)).optBoolean("rejected"));assertEquals(0,copies(r,stale).size());call("cancelEdit",new JSONObject().put("sessionId",stale));v.clear();v.put("is_trashed",0);r.update(original,v,null,null);assertArrayEquals(before,bytes(r,original));
   }
  }finally{for(String token:tokens){for(Uri copy:copies(r,token))r.delete(copy,null,null);c.getSharedPreferences("alpha-photo-edit-results",0).edit().remove(token).commit();}if(original!=null)r.delete(original,null,null);}
 }
 /** With Photos access granted the grid watches MediaStore, and the save's own copy row notifies it.
  * The save must still publish one copy, open the viewer on it and say so. Granting is not undone
  * here (revoking kills the process): run it as its own fixture with -e photoLibraryGrantTest true. */
 @Test public void grantedLibrarySaveOpensTheCopyAndConfirms()throws Exception{
  Assume.assumeTrue("Separate granted-library fixture: -e photoLibraryGrantTest true","true".equals(InstrumentationRegistry.getArguments().getString("photoLibraryGrantTest")));
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver r=c.getContentResolver();Uri original=null;String token=null;
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(c.getPackageName(),android.Manifest.permission.READ_MEDIA_IMAGES);
  try{
   ContentValues v=new ContentValues();v.put("_display_name","alpha-edit-granted-"+UUID.randomUUID()+".png");v.put("mime_type","image/png");v.put("relative_path","Pictures/AlphaPhone-tests/");v.put("is_pending",1);original=r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,v);assertNotNull(original);
   Bitmap fixture=Bitmap.createBitmap(120,80,Bitmap.Config.ARGB_8888);fixture.eraseColor(Color.RED);try(OutputStream out=r.openOutputStream(original)){assertNotNull(out);assertTrue(fixture.compress(Bitmap.CompressFormat.PNG,100,out));}finally{fixture.recycle();}v.clear();v.put("is_pending",0);r.update(original,v,null,null);byte[] before=bytes(r,original);String id=Long.toString(ContentUris.parseId(original));
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();js(AppNavigation.request("Photos"));until(AppNavigation.selected("Photos"));
    // The permitted library names items by volume and kind: m:<volume>:i:<id>.
    String tile="document.querySelector('[data-owned-media-id$=\":i:"+id+"\"]')";until(tile);js(tile+".click()");
    js("window.__editNative=Capacitor.nativePromise;window.__editMeta=null;Capacitor.nativePromise=function(p,m,a){return window.__editNative.apply(this,arguments).then(v=>{if(p==='AlphaPhotos'&&m==='beginEdit')window.__editMeta={sessionId:v.sessionId};return v;});}");
    try{
     click("Edit photo");until("window.__editMeta&&document.querySelector('[aria-label=\"Cancel edit\"]')");token=new JSONObject(js("window.__editMeta")).getString("sessionId");
     click("Rotate");click("Save edit");
     until("document.querySelector('[data-alpha-toast]')?.textContent.includes('Copy saved.')");
     assertEquals("The save's own MediaStore notification must not cancel it",1,copies(r,token).size());
     until("!document.querySelector('[aria-label=\"Cancel edit\"]')&&document.querySelector('[aria-label=\"Back from photo\"]')&&document.body.innerText.includes('80 × 120')");
     assertArrayEquals(before,bytes(r,original));
    }finally{js("if(window.__editNative){Capacitor.nativePromise=window.__editNative;delete window.__editNative;}");}
   }
  }finally{if(token!=null){for(Uri copy:copies(r,token))r.delete(copy,null,null);c.getSharedPreferences("alpha-photo-edit-results",0).edit().remove(token).commit();}if(original!=null)r.delete(original,null,null);}
 }
}
