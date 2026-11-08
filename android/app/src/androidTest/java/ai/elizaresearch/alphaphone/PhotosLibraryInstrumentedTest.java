package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.PermittedMediaCatalog;

import android.content.*;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Owned synthetic MediaStore fixture. No existing media is read or changed. */
@RunWith(AndroidJUnit4.class)
public class PhotosLibraryInstrumentedTest {
 @Test public void catalogFenceDetectsProviderMutationBeforeObserverDelivery()throws Exception{
  org.junit.Assume.assumeTrue("Explicit disposable Photos library fixture","1".equals(InstrumentationRegistry.getArguments().getString("photosLibrary")));
  assertTrue("Disposable secondary user required",android.os.Process.myUid()/100000>0);assertTrue(Build.VERSION.SDK_INT>=30);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver resolver=context.getContentResolver();
  String name="alpha-library-fence-"+UUID.randomUUID()+".jpg";ContentValues values=new ContentValues();values.put("_display_name",name);values.put("mime_type","image/jpeg");values.put("relative_path","Pictures/AlphaPhone-tests");values.put("is_pending",1);
  Uri uri=resolver.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),values);assertNotNull(uri);
  Throwable primary=null;
  try{
   Bitmap bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888);bitmap.eraseColor(0xff306090);
   try(java.io.OutputStream output=resolver.openOutputStream(uri)){assertNotNull(output);assertTrue(bitmap.compress(Bitmap.CompressFormat.JPEG,90,output));}finally{bitmap.recycle();}
   values.clear();values.put("is_pending",0);assertEquals(1,resolver.update(uri,values,null,null));
   AtomicReference<Throwable> failure=new AtomicReference<>();AtomicInteger callbacks=new AtomicInteger();
   InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{
    try(PermittedMediaCatalog catalog=new PermittedMediaCatalog(context,callbacks::incrementAndGet)){
     PermittedMediaCatalog.Fence before=catalog.fence();String cursor=before.cursorIdentity();
     String databaseVersion=MediaStore.getVersion(context,MediaStore.VOLUME_EXTERNAL_PRIMARY);long generation=MediaStore.getGeneration(context,MediaStore.VOLUME_EXTERNAL_PRIMARY);
     ContentValues rename=new ContentValues();rename.put("_display_name","changed-"+name);assertEquals(1,resolver.update(uri,rename,null,null));
     assertTrue("Real provider generation advanced",MediaStore.getGeneration(context,MediaStore.VOLUME_EXTERNAL_PRIMARY)>generation);
     assertEquals("An ordinary rename does not rebuild the database",databaseVersion,MediaStore.getVersion(context,MediaStore.VOLUME_EXTERNAL_PRIMARY));
     assertTrue("The assertion must exercise generation, not deadline expiry",android.os.SystemClock.elapsedRealtime()<before.until);
     assertEquals("Main-thread observer callbacks cannot run until this block returns",0,callbacks.get());
     boolean rejected=false;try{catalog.requireCurrent(before);}catch(IllegalStateException changed){rejected=true;}
     assertTrue("A stale page must fail even before observer delivery",rejected);
     assertNotEquals("Album cursor binds provider mutations, not only database rebuilds",cursor,catalog.fence().cursorIdentity());
    }catch(Throwable error){failure.set(error);}
   });
   if(failure.get()!=null)throw new AssertionError("Provider generation fence failed",failure.get());
  }catch(Exception|AssertionError error){primary=error;throw error;}
  finally{try{assertEquals("Delete only this exact synthetic fixture",1,resolver.delete(uri,null,null));}catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}}
 }
}
