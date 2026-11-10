package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.OwnedPhotoEdits;
import android.content.*;
import android.database.Cursor;
import android.graphics.*;
import android.net.Uri;
import android.provider.MediaStore;
import android.util.Base64;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.util.*;
import org.json.*;
import org.junit.Test;
import static org.junit.Assert.*;
/** Real Android decoding/filter/PNG/MediaStore against measured Chromium CSS pixels. */
public final class PhotoFilterInstrumentedTest {
 private byte[] bytes(InputStream input)throws Exception{try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){assertNotNull(in);byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){assertTrue(out.size()+n<1024*1024);out.write(b,0,n);}return out.toByteArray();}}
 private String revision(ContentResolver r,Uri uri)throws Exception{try(Cursor row=r.query(uri,new String[]{"date_added","_size","generation_modified","is_trashed"},null,null,null)){assertNotNull(row);assertTrue(row.moveToFirst());return row.getLong(0)+":"+row.getLong(1)+":"+row.getLong(2)+":"+row.getInt(3);}}
 private void chart(Bitmap bitmap,JSONArray samples,String filter)throws Exception{assertEquals(samples.length()*10,bitmap.getWidth());assertEquals(10,bitmap.getHeight());for(int i=0;i<samples.length();i++){JSONArray rgba=samples.getJSONObject(i).getJSONArray("actual");int color=bitmap.getPixel(bitmap.getWidth()-1-(i*10+5),4),alpha=color>>>24;assertEquals(filter+" alpha "+i,rgba.getInt(3),alpha);if(alpha==0)continue;for(int channel=0;channel<3;channel++){int observed=(color>>>(16-channel*8))&255,expected=rgba.getInt(channel);String label=filter+" sample "+i+" channel "+channel+" expected="+expected+" observed="+observed;if(alpha==255)assertEquals(label,expected,observed);else{
   // Straight RGB is amplified by unpremultiplication at low alpha. Compare
   // the stored/composited contribution, with exact alpha and opaque pixels.
   int a=(int)Math.round(observed*alpha/255d),b=(int)Math.round(expected*alpha/255d);assertTrue(label+" premultiplied",Math.abs(a-b)<=1);

  }}}
  for(int background:new int[]{0,255}){Bitmap composite=Bitmap.createBitmap(bitmap.getWidth(),bitmap.getHeight(),Bitmap.Config.ARGB_8888);try{Canvas canvas=new Canvas(composite);canvas.drawColor(Color.rgb(background,background,background));canvas.drawBitmap(bitmap,0,0,null);for(int i=0;i<samples.length();i++){JSONArray rgba=samples.getJSONObject(i).getJSONArray("actual");int alpha=rgba.getInt(3),color=composite.getPixel(bitmap.getWidth()-1-(i*10+5),4);assertEquals(255,color>>>24);for(int channel=0;channel<3;channel++){int observed=(color>>>(16-channel*8))&255,expected=(int)Math.round(rgba.getInt(channel)*alpha/255d)+background*(255-alpha)/255;assertTrue(filter+" composite background="+background+" sample="+i+" channel="+channel+" expected="+expected+" observed="+observed,Math.abs(observed-expected)<=(alpha==255?0:1));}}}finally{composite.recycle();}}
 }
 @Test public void sevenFiltersMatchBrowserChartInPreviewAndExportWithImmutableIdentity()throws Exception{
  assertTrue(android.os.Build.VERSION.SDK_INT>=30);Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();ContentResolver r=c.getContentResolver();JSONObject golden=new JSONObject(new String(bytes(InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("photo-filter-goldens.json")),java.nio.charset.StandardCharsets.UTF_8));JSONArray filters=golden.getJSONArray("results");JSONArray samples=filters.getJSONObject(0).getJSONArray("samples");
  Uri original=null;List<Uri> copies=new ArrayList<>();List<String> tokens=new ArrayList<>();OwnedPhotoEdits edits=new OwnedPhotoEdits(c, AlphaPhotosPlugin.MEDIA_CONFIG);
  try{
   ContentValues values=new ContentValues();values.put("_display_name","alpha-filter-chart-"+UUID.randomUUID()+".png");values.put("mime_type","image/png");values.put("relative_path","Pictures/AlphaPhone-tests/");values.put("is_pending",1);original=r.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(original);
   byte[] canonical=bytes(InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("photo-filter-source.png"));byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(canonical);StringBuilder digest=new StringBuilder();for(byte value:hash)digest.append(String.format(java.util.Locale.ROOT,"%02x",value&255));assertEquals("Browser/native source PNG must be byte-identical",golden.getString("sourceSha256"),digest.toString());try(OutputStream out=r.openOutputStream(original)){assertNotNull(out);out.write(canonical);}values.clear();values.put("is_pending",0);r.update(original,values,null,null);byte[] before=bytes(r.openInputStream(original));String id=Long.toString(ContentUris.parseId(original));
   for(int f=0;f<filters.length();f++){
    JSONObject reference=filters.getJSONObject(f);String filter=reference.getString("key"),token=edits.begin(id,revision(r,original)).getString("sessionId");tokens.add(token);
    JSONObject preview=edits.preview(token,180,false,filter);byte[] png=Base64.decode(preview.getString("image").split(",",2)[1],Base64.DEFAULT);int[] previewPixels=new int[6500];Bitmap rendered=BitmapFactory.decodeByteArray(png,0,png.length);assertNotNull(rendered);try{chart(rendered,reference.getJSONArray("samples"),filter+" preview");rendered.getPixels(previewPixels,0,650,0,0,650,10);}finally{rendered.recycle();}
    JSONObject saved=edits.save(token,180,false,filter);assertEquals("saved",saved.getString("status"));Uri copy=ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,Long.parseLong(saved.getString("id")));copies.add(copy);byte[] exported=bytes(r.openInputStream(copy));Bitmap pixels=BitmapFactory.decodeByteArray(exported,0,exported.length);assertNotNull(pixels);try{chart(pixels,reference.getJSONArray("samples"),filter+" export");int[] exportedPixels=new int[6500];pixels.getPixels(exportedPixels,0,650,0,0,650,10);assertArrayEquals("Native preview and export pixels match",previewPixels,exportedPixels);}finally{pixels.recycle();}
    assertEquals(saved.getString("id"),edits.save(token,180,false,filter).getString("id"));assertArrayEquals(before,bytes(r.openInputStream(original)));
    try{edits.save(token,180,false,filter.equals("none")?"vivid":"none");fail("Reserved save filter cannot change");}catch(IllegalArgumentException expected){}
    edits.cancel(token);edits.releaseCancelled();
   }
  }finally{edits.close();for(Uri copy:copies)r.delete(copy,null,null);for(String token:tokens)c.getSharedPreferences("alpha-photo-edit-results",0).edit().remove(token).commit();if(original!=null)r.delete(original,null,null);}
 }
}
