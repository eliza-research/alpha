package ai.alphacompute.alphaphone;

import ai.eliza.plugins.media.PermittedMediaCatalog;
import android.Manifest;
import android.content.*;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import java.io.OutputStream;
import java.util.*;
import org.json.JSONArray;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/**
 * The permitted catalog is one newest-first list by capture time (DATE_TAKEN), not by _id: a photo
 * taken long ago but inserted last pages after a newer one, and paging one row at a time never
 * repeats or reorders rows. Also proves MediaProvider accepts the catalog's sort expression. Two
 * uniquely named owned JPEGs (EXIF capture times 2010 and now), deleted afterwards; the search
 * term restricts the listing to them.
 */
@RunWith(AndroidJUnit4.class)
public final class PhotosCatalogOrderInstrumentedTest {
 private static Uri jpeg(ContentResolver r,String name,String exifTime)throws Exception{
  ContentValues values=new ContentValues();values.put("_display_name",name);values.put("mime_type","image/jpeg");values.put("relative_path","Pictures/AlphaPhone-tests/");values.put("is_pending",1);
  Uri uri=r.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values);assertNotNull(uri);
  Bitmap bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888);bitmap.eraseColor(0xff306090);
  try(OutputStream out=r.openOutputStream(uri)){assertNotNull(out);assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,90,out));}finally{bitmap.recycle();}
  try(ParcelFileDescriptor fd=r.openFileDescriptor(uri,"rw")){assertNotNull(fd);ExifInterface exif=new ExifInterface(fd.getFileDescriptor());exif.setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL,exifTime);exif.saveAttributes();}
  values.clear();values.put("is_pending",0);assertEquals(1,r.update(uri,values,null,null));return uri;
 }
 private static long taken(ContentResolver r,Uri uri){try(Cursor row=r.query(uri,new String[]{"datetaken"},null,null,null)){assertNotNull(row);assertTrue(row.moveToFirst());return row.isNull(0)?0:row.getLong(0);}}

 @Test public void anOldPhotoInsertedLastPagesAfterANewerOne()throws Exception{
  assertTrue("Disposable secondary user required",android.os.Process.myUid()/100000>0);
  assumeTrue(Build.VERSION.SDK_INT>=30);
  Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver r=c.getContentResolver();
  String permission=Build.VERSION.SDK_INT>=33?Manifest.permission.READ_MEDIA_IMAGES:Manifest.permission.READ_EXTERNAL_STORAGE;
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(c.getPackageName(),permission);
  String tag="alpha-order-"+UUID.randomUUID().toString().substring(0,8);
  String now=new java.text.SimpleDateFormat("yyyy:MM:dd HH:mm:ss",Locale.US).format(new Date());
  Uri newer=jpeg(r,tag+"-newer.jpg",now),older=jpeg(r,tag+"-older.jpg","2010:06:01 12:00:00");
  try{
   assertTrue("the older photo was inserted last",ContentUris.parseId(older)>ContentUris.parseId(newer));
   assumeTrue("MediaStore read the EXIF capture times",taken(r,older)>0&&taken(r,older)<taken(r,newer));
   List<String> ids=new ArrayList<>();
   try(PermittedMediaCatalog catalog=new PermittedMediaCatalog(c,()->{})){
    String cursor="";
    for(int page=0;page<4;page++){
     JSObject result=catalog.list(cursor,tag,"image",false,"all",0,Long.MAX_VALUE,1);
     JSONArray items=result.getJSONArray("items");
     for(int i=0;i<items.length();i++)ids.add(items.getJSONObject(i).getString("id"));
     cursor=result.getString("next");if(cursor==null||cursor.isEmpty())break;
    }
   }
   assertEquals("two rows, each once",2,ids.size());
   assertTrue("newest capture first: "+ids,ids.get(0).endsWith(":i:"+ContentUris.parseId(newer)));
   assertTrue(ids.get(1).endsWith(":i:"+ContentUris.parseId(older)));
  }finally{r.delete(newer,null,null);r.delete(older,null,null);}
 }
}
