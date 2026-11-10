package ai.elizaresearch.notificationfixture;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.AtomicFile;
import android.widget.TextView;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.Executors;
import org.json.*;

/** Separate-UID synthetic media witness. Never shipped in the product APK.
 * Every mutation is constrained to this disposable user's exact private ledger. */
public final class MediaFixtureActivity extends Activity {
 private static final java.util.concurrent.ExecutorService WORK=Executors.newSingleThreadExecutor();
 private static final int MAX_ROWS=320, MAX_LEDGER=256*1024;
 @Override public void onCreate(Bundle state){super.onCreate(state);handle(getIntent());}
 @Override public void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);handle(intent);}
 private static String uuid(String value){if(value==null||!UUID.fromString(value).toString().equals(value))throw new IllegalArgumentException("UUID required");return value;}
 private File file(String run){return new File(getFilesDir(),"media-"+run+".json");}
 private JSONObject read(String run)throws Exception{File f=file(run);if(f.length()>MAX_LEDGER)throw new IOException("Ledger limit");try(InputStream in=new FileInputStream(f)){return new JSONObject(new String(readBounded(in,MAX_LEDGER),StandardCharsets.UTF_8));}}
 private void save(File file,JSONObject value)throws Exception{byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);if(bytes.length>MAX_LEDGER)throw new IOException("Ledger limit");AtomicFile atomic=new AtomicFile(file);FileOutputStream out=atomic.startWrite();try{out.write(bytes);atomic.finishWrite(out);}catch(Exception failure){atomic.failWrite(out);throw failure;}}
 private static byte[] readBounded(InputStream in,int limit)throws IOException{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[4096];int count;while((count=in.read(buffer))!=-1){if(out.size()+count>limit)throw new IOException("Fixture byte limit");out.write(buffer,0,count);}return out.toByteArray();}
 private static String sha(byte[] value)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value))out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
 private Uri owned(JSONObject row,String run)throws Exception{
  String raw=row.getString("uri"),kind=row.getString("kind"),prefix="content://media/external/"+(kind.equals("image")?"images/media/":kind.equals("video")?"video/media/":"invalid/");
  if(!raw.startsWith(prefix)||!raw.substring(prefix.length()).matches("[0-9]+")||!row.getString("name").startsWith("alpha-foreign-"+run+"-"))throw new IOException("Foreign ledger identity");
  Uri uri=Uri.parse(raw);try(android.database.Cursor cursor=getContentResolver().query(uri,new String[]{MediaStore.MediaColumns.DISPLAY_NAME,MediaStore.MediaColumns.OWNER_PACKAGE_NAME},null,null,null)){if(cursor==null)throw new IOException("No media query");if(cursor.moveToFirst()&&(!row.getString("name").equals(cursor.getString(0))||!getPackageName().equals(cursor.getString(1))))throw new IOException("Media row ownership changed");}
  return uri;
 }
 private byte[] bytes(String kind,int index)throws Exception{
  if(kind.equals("video")){try(InputStream in=getAssets().open("synthetic-blue.mp4")){byte[] value=readBounded(in,16384);if(value.length>16384)throw new IOException("Video fixture limit");return value;}}
  Bitmap bitmap=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888);try{bitmap.eraseColor(Color.rgb(index%256,(index*7)%256,(index*13)%256));ByteArrayOutputStream out=new ByteArrayOutputStream();if(!bitmap.compress(Bitmap.CompressFormat.JPEG,85,out))throw new IOException("JPEG encoding");return out.toByteArray();}finally{bitmap.recycle();}
 }
 private void handle(Intent intent){
  TextView view=new TextView(this);view.setText("Synthetic media witness");setContentView(view);
  final String run,request,operation;final int images,videos,index;
  try{run=uuid(intent.getStringExtra("run"));request=uuid(intent.getStringExtra("request"));operation=intent.getStringExtra("operation");images=intent.getIntExtra("images",3);videos=intent.getIntExtra("videos",1);index=intent.getIntExtra("index",0);
   int user=android.os.Process.myUid()/100000;if(user<=0||user!=intent.getIntExtra("user",-1)||!"owned-disposable-alpha-media".equals(intent.getStringExtra("ack")))throw new IllegalArgumentException("Disposable user acknowledgement required");
   if(images<0||videos<0||videos>4||images+videos<1||images+videos>MAX_ROWS)throw new IllegalArgumentException("Fixture row limit");
  }catch(Exception failure){view.setText("Synthetic media request rejected");return;}
  WORK.execute(()->{JSONObject result=new JSONObject();try{
   result.put("run",run).put("request",request).put("operation",operation).put("uid",android.os.Process.myUid()).put("user",android.os.Process.myUid()/100000);
   File receipt=new File(getFilesDir(),"media-"+run+"-"+request+".json");if(receipt.exists())return;save(receipt,new JSONObject(result.toString()).put("complete",false));
   JSONObject ledger;
   if("seed".equals(operation)){
    if(file(run).exists())throw new IOException("Run already seeded");ledger=new JSONObject().put("run",run).put("uid",android.os.Process.myUid()).put("rows",new JSONArray());save(file(run),ledger);
    for(int i=0;i<images+videos;i++){
     String kind=i<images?"image":"video",name="alpha-foreign-"+run+"-"+i+(kind.equals("image")?".jpg":".mp4");byte[] bytes=bytes(kind,i);ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);values.put(MediaStore.MediaColumns.MIME_TYPE,kind.equals("image")?"image/jpeg":"video/mp4");values.put(MediaStore.MediaColumns.RELATIVE_PATH,kind.equals("image")?"Pictures/AlphaForeignFixture/":"Movies/AlphaForeignFixture/");values.put(MediaStore.MediaColumns.IS_PENDING,1);
     Uri uri=getContentResolver().insert(kind.equals("image")?MediaStore.Images.Media.EXTERNAL_CONTENT_URI:MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new IOException("Insert returned no URI");JSONObject row=new JSONObject().put("uri",uri.toString()).put("kind",kind).put("name",name).put("sha256",sha(bytes)).put("size",bytes.length).put("deleted",false);ledger.getJSONArray("rows").put(row);
     try{save(file(run),ledger);}catch(Exception failure){getContentResolver().delete(uri,null,null);throw failure;}
     try(OutputStream out=getContentResolver().openOutputStream(uri)){if(out==null)throw new IOException("No output stream");out.write(bytes);}ContentValues published=new ContentValues();published.put(MediaStore.MediaColumns.IS_PENDING,0);if(getContentResolver().update(uri,published,null,null)!=1)throw new IOException("Publication changed");
    }
   }else{
    ledger=read(run);if(!run.equals(ledger.getString("run"))||ledger.getInt("uid")!=android.os.Process.myUid()||ledger.getJSONArray("rows").length()>MAX_ROWS)throw new IOException("Ledger owner mismatch");JSONArray rows=ledger.getJSONArray("rows");
    if("cleanup".equals(operation)){for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);Uri uri=owned(row,run);if(!row.optBoolean("deleted")){getContentResolver().delete(uri,null,null);row.put("deleted",true);save(file(run),ledger);}}}
    else if("rename".equals(operation)||"delete".equals(operation)){
     if(index<0||index>=rows.length())throw new IOException("Ledger index");JSONObject row=rows.getJSONObject(index);Uri uri=owned(row,run);if(row.optBoolean("deleted"))throw new IOException("Already deleted");
     if("delete".equals(operation)){if(getContentResolver().delete(uri,null,null)!=1)throw new IOException("Delete changed");row.put("deleted",true);}else{String name="alpha-foreign-"+run+"-changed-"+index+(row.getString("kind").equals("image")?".jpg":".mp4");ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);if(getContentResolver().update(uri,values,null,null)!=1)throw new IOException("Rename changed");row.put("name",name);}save(file(run),ledger);
    }else throw new IOException("Unsupported operation");
   }
   result.put("ledger",ledger).put("passed",true);
  }catch(Exception failure){try{result.put("passed",false).put("error",failure.toString());}catch(JSONException ignored){}}
   try{result.put("complete",true);save(new File(getFilesDir(),"media-"+run+"-"+request+".json"),result);}catch(Exception ignored){}
   runOnUiThread(()->view.setText("Synthetic media request completed: "+request));
  });
 }
}
