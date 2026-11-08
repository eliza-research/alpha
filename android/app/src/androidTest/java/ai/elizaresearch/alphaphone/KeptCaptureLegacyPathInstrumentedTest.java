package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.OwnedCaptures;
import android.content.*;
import android.database.Cursor;
import android.graphics.*;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * A scan Keep reserved by an install that still kept captures in Pictures/ is resolved there after
 * the capture folder moved to DCIM/Camera/: a pending row is cleaned up and reported as such, a
 * published row with the same bytes is that keep's photo, and nothing is published a second time.
 * Each case uses its own operation identity and deletes its rows afterwards.
 */
@RunWith(AndroidJUnit4.class)
public final class KeptCaptureLegacyPathInstrumentedTest {
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private static byte[] jpeg(){
  Bitmap bitmap=Bitmap.createBitmap(64,48,Bitmap.Config.ARGB_8888);Random random=new Random(11);int[] pixels=new int[64*48];for(int i=0;i<pixels.length;i++)pixels[i]=0xff000000|random.nextInt(0x1000000);bitmap.setPixels(pixels,0,64,0,0,64,48);
  ByteArrayOutputStream out=new ByteArrayOutputStream();assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,90,out));bitmap.recycle();return out.toByteArray();
 }
 /** The receipt an interrupted keep of an older install left: reserved, bound to the page's bytes. */
 private void reserve(Context c,String operation,byte[] bytes)throws Exception{
  String digest=Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes));
  assertTrue(c.getSharedPreferences(AlphaMediaConfig.MEDIA.preferences("kept-captures"),0).edit().putString(operation,new JSONObject().put("status","reserved").put("sha256",digest).toString()).commit());
 }
 private Uri legacyRow(ContentResolver r,String operation,byte[] bytes,boolean publish)throws Exception{
  ContentValues values=new ContentValues();values.put("_display_name",AlphaMediaConfig.MEDIA.captureName(operation));values.put("mime_type","image/jpeg");values.put("relative_path","Pictures/");values.put("is_pending",1);
  Uri uri=r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);
  try(OutputStream out=r.openOutputStream(uri,"w")){assertNotNull(out);out.write(bytes);}
  if(publish){ContentValues published=new ContentValues();published.put("is_pending",0);assertEquals(1,r.update(uri,published,null,null));}
  return uri;
 }
 private int rows(ContentResolver r,String operation){
  Bundle query=new Bundle();query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,"_display_name=?");query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{AlphaMediaConfig.MEDIA.captureName(operation)});query.putInt(MediaStore.QUERY_ARG_MATCH_PENDING,MediaStore.MATCH_INCLUDE);
  try(Cursor row=r.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{"_id"},query,null)){assertNotNull(row);return row.getCount();}
 }
 private void cleanup(Context c,ContentResolver r,String operation){
  Bundle query=new Bundle();query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION,"_display_name=?");query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,new String[]{AlphaMediaConfig.MEDIA.captureName(operation)});query.putInt(MediaStore.QUERY_ARG_MATCH_PENDING,MediaStore.MATCH_INCLUDE);
  r.delete(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,query);
  c.getSharedPreferences(AlphaMediaConfig.MEDIA.preferences("kept-captures"),0).edit().remove(operation).commit();
 }

 @Test public void theOldCaptureFolderIsStillSearched(){
  assertEquals("DCIM/Camera/",AlphaMediaConfig.MEDIA.captureRelativePath);
  assertEquals(Collections.singletonList("Pictures/"),AlphaMediaConfig.MEDIA.legacyCaptureRelativePaths);
 }

 @Test public void aPendingKeepUnderPicturesIsCleanedUpNotLeftUnconfirmed()throws Exception{
  Context c=context();ContentResolver r=c.getContentResolver();String operation=UUID.randomUUID().toString();byte[] bytes=jpeg();
  try{
   reserve(c,operation,bytes);legacyRow(r,operation,bytes,false);
   OwnedCaptures.Result result=new OwnedCaptures(c,AlphaMediaConfig.MEDIA).keep(operation,Base64.getEncoder().encodeToString(bytes));
   assertFalse(result.saved);
   assertEquals("The unfinished capture was removed. Capture it again to retry.",result.message);
   assertEquals("the pending row in Pictures/ is gone and nothing was published in DCIM/Camera/",0,rows(r,operation));
  }finally{cleanup(c,r,operation);}
 }

 @Test public void aPublishedKeepUnderPicturesIsThatKeepsPhoto()throws Exception{
  Context c=context();ContentResolver r=c.getContentResolver();String operation=UUID.randomUUID().toString();byte[] bytes=jpeg();
  try{
   reserve(c,operation,bytes);Uri legacy=legacyRow(r,operation,bytes,true);
   OwnedCaptures.Result result=new OwnedCaptures(c,AlphaMediaConfig.MEDIA).keep(operation,Base64.getEncoder().encodeToString(bytes));
   assertTrue(result.message,result.saved);
   assertEquals(Long.toString(ContentUris.parseId(legacy)),result.id);
   assertEquals("no second copy",1,rows(r,operation));
  }finally{cleanup(c,r,operation);}
 }
}
