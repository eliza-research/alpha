package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.OwnedPhotoEdits;
import android.content.*;
import android.database.Cursor;
import android.graphics.*;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.util.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import static org.junit.Assume.assumeTrue;

/**
 * Replace never leaves the original damaged: a write that fails part way is undone from the
 * private backup, a write that cannot be undone yet keeps the backup and reports unknown until a
 * later result (a new process) restores it, and a write that completed before its error is the
 * saved edit. Each case uses its own uniquely named owned PNG, deleted afterwards.
 */
@RunWith(AndroidJUnit4.class)
public final class PhotoReplaceInstrumentedTest {
 /** Writes {@code limit} bytes, then fails the write (as a full disk does); or, with limit < 0, fails on close. */
 private static final class Faulty implements OwnedPhotoEdits.ReplaceOutput {
  final int limit,failures;int opened;
  /** Faults the first {@code failures} opens; later opens (the restore) write normally. */
  Faulty(int limit,int failures){this.limit=limit;this.failures=failures;}
  @Override public OutputStream open(ContentResolver r,Uri target)throws IOException{
   OutputStream out=r.openOutputStream(target,"wt");if(opened++>=failures)return out;
   return new FilterOutputStream(out){int written;
    @Override public void write(int b)throws IOException{if(limit>=0&&written>=limit)throw new IOException("No space left on device");written++;out.write(b);}
    @Override public void write(byte[] b,int off,int len)throws IOException{for(int i=0;i<len;i++)write(b[off+i]);}
    @Override public void close()throws IOException{super.close();if(limit<0)throw new IOException("close failed");}
   };
  }
 }
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private static byte[] read(ContentResolver r,Uri uri)throws Exception{try(InputStream in=r.openInputStream(uri);ByteArrayOutputStream out=new ByteArrayOutputStream()){assertNotNull(in);byte[] b=new byte[16384];int n;while((n=in.read(b))!=-1)out.write(b,0,n);return out.toByteArray();}}
 private static String revision(ContentResolver r,Uri uri){try(Cursor row=r.query(uri,new String[]{"date_added","_size","generation_modified","is_trashed"},null,null,null)){assertNotNull(row);assertTrue(row.moveToFirst());return row.getLong(0)+":"+row.getLong(1)+":"+row.getLong(2)+":"+row.getInt(3);}}
 private static String[] backups(Context c){String[] names=new File(c.getFilesDir(),"photo-replace-backups").list();return names==null?new String[0]:names;}
 /** A published owned 256x192 PNG of seeded noise (far larger than any fault limit below); a 90° rotation changes its bytes. */
 private Uri owned(ContentResolver r)throws Exception{
  ContentValues values=new ContentValues();values.put("_display_name","alpha-replace-"+UUID.randomUUID()+".png");values.put("mime_type","image/png");values.put("relative_path","Pictures/AlphaPhone-tests/");values.put("is_pending",1);
  Uri uri=r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);
  Bitmap bitmap=Bitmap.createBitmap(256,192,Bitmap.Config.ARGB_8888);Random random=new Random(7);int[] pixels=new int[256*192];for(int i=0;i<pixels.length;i++)pixels[i]=0xff000000|random.nextInt(0x1000000);bitmap.setPixels(pixels,0,256,0,0,256,192);
  try(OutputStream out=r.openOutputStream(uri)){assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG,100,out));}finally{bitmap.recycle();}
  ContentValues published=new ContentValues();published.put("is_pending",0);assertEquals(1,r.update(uri,published,null,null));return uri;
 }
 private String begin(OwnedPhotoEdits edits,ContentResolver r,Uri uri)throws Exception{
  JSONObject session=edits.begin(Long.toString(ContentUris.parseId(uri)),revision(r,uri));assertTrue(session.getBoolean("canReplace"));return session.getString("token");
 }

 @Test public void aWriteThatFailsPartWayIsUndoneFromTheBackup()throws Exception{
  assumeTrue(android.os.Build.VERSION.SDK_INT>=30);Context c=context();ContentResolver r=c.getContentResolver();Uri uri=owned(r);
  try{
   byte[] original=read(r,uri);Faulty faulty=new Faulty(1000,1);OwnedPhotoEdits edits=new OwnedPhotoEdits(c,AlphaPhotosPlugin.MEDIA_CONFIG,null,faulty);
   String token=begin(edits,r,uri);
   try{edits.replace(token,90,false,"none");fail("the injected write failure is reported");}catch(IOException expected){assertEquals("No space left on device",expected.getMessage());}
   assertEquals("the write and the restore both opened the original",2,faulty.opened);
   assertArrayEquals("the original holds its own bytes again",original,read(r,uri));
   assertEquals("failed",new OwnedPhotoEdits(c,AlphaPhotosPlugin.MEDIA_CONFIG).result(token).getString("status"));
   assertEquals("no backup is left once the original is restored",0,backups(c).length);
  }finally{r.delete(uri,null,null);}
 }

 @Test public void anUnrestoredWriteKeepsTheBackupUntilALaterResultRestoresIt()throws Exception{
  assumeTrue(android.os.Build.VERSION.SDK_INT>=30);Context c=context();ContentResolver r=c.getContentResolver();Uri uri=owned(r);
  try{
   byte[] original=read(r,uri);OwnedPhotoEdits edits=new OwnedPhotoEdits(c,AlphaPhotosPlugin.MEDIA_CONFIG,null,new Faulty(1000,Integer.MAX_VALUE));
   String token=begin(edits,r,uri);
   try{edits.replace(token,90,false,"none");fail("the injected write failure is reported");}catch(IOException expected){}
   assertFalse("the original is damaged while the restore keeps failing",Arrays.equals(original,read(r,uri)));
   assertEquals(1,backups(c).length);
   assertEquals("unknown",new OwnedPhotoEdits(c,AlphaPhotosPlugin.MEDIA_CONFIG,null,new Faulty(1000,Integer.MAX_VALUE)).result(token).getString("status"));
   assertEquals("the backup is still kept",1,backups(c).length);
   // As a new process would: the default writer restores the original from the backup.
   assertEquals("failed",new OwnedPhotoEdits(c,AlphaPhotosPlugin.MEDIA_CONFIG).result(token).getString("status"));
   assertArrayEquals(original,read(r,uri));
   assertEquals(0,backups(c).length);
   assertEquals("settled once","failed",new OwnedPhotoEdits(c,AlphaPhotosPlugin.MEDIA_CONFIG).result(token).getString("status"));
  }finally{r.delete(uri,null,null);}
 }

 @Test public void aWriteThatCompletedBeforeItsErrorIsTheSavedEdit()throws Exception{
  assumeTrue(android.os.Build.VERSION.SDK_INT>=30);Context c=context();ContentResolver r=c.getContentResolver();Uri uri=owned(r);
  try{
   byte[] original=read(r,uri);OwnedPhotoEdits edits=new OwnedPhotoEdits(c,AlphaPhotosPlugin.MEDIA_CONFIG,null,new Faulty(-1,1));
   String token=begin(edits,r,uri);
   JSONObject receipt=edits.replace(token,90,false,"none");
   assertEquals("saved",receipt.getString("status"));assertTrue(receipt.getBoolean("replaced"));
   byte[] now=read(r,uri);assertFalse(Arrays.equals(original,now));
   Bitmap rotated=BitmapFactory.decodeByteArray(now,0,now.length);assertNotNull(rotated);assertEquals(192,rotated.getWidth());assertEquals(256,rotated.getHeight());rotated.recycle();
   assertEquals(0,backups(c).length);
  }finally{r.delete(uri,null,null);}
 }
}
