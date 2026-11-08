package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.VideoCopyEdits;

import static org.junit.Assert.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.system.Os;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import ai.elizaresearch.alphaphone.VideoCopyInstrumentedTest.Response;

/** Real MediaStore rows in the dedicated offline fixture package. Successful
 * assertions clean only the new case's data; unexpected failures retain it. */
@RunWith(AndroidJUnit4.class)
public final class VideoCopyPreservationInstrumentedTest {
 private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
 private final android.content.SharedPreferences journal=context.getSharedPreferences("alpha-video-copy-results-v1",0);
 private static String hash(byte[] bytes)throws Exception{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return s.toString();}
 private static String recordHash(String value)throws Exception{return hash(value.getBytes(StandardCharsets.UTF_8));}
 private final class Pending {
  final String token="video-"+UUID.randomUUID();final Uri uri;final byte[] bytes;String record;
  Pending(byte[] bytes)throws Exception{
   this.bytes=bytes;android.util.Log.i("AlphaVideoPreservationQA","new-token="+token);ContentValues values=new ContentValues();values.put("_display_name","Alpha-video-edit-"+token.substring(6)+".mp4");values.put("mime_type","video/mp4");values.put("relative_path","Movies/Alpha Video QA/");values.put("is_pending",1);
   uri=context.getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);android.util.Log.i("AlphaVideoPreservationQA","new-token="+token+",row="+android.content.ContentUris.parseId(uri));
   try(OutputStream output=context.getContentResolver().openOutputStream(uri,"w")){assertNotNull(output);output.write(bytes);}
   setRecord(new JSONObject().put("status","failed").put("createdAt",System.currentTimeMillis()).put("pendingId",Long.toString(android.content.ContentUris.parseId(uri))));
  }
  void setRecord(JSONObject value){record=value.toString();assertTrue(journal.edit().putString(token,record).commit());}
  File directory()throws Exception{return new File(new File(context.getFilesDir().getCanonicalFile(),"video-copy-preservation-v1"),token);}
 }
 private static byte[] readAll(InputStream input)throws Exception{ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] chunk=new byte[8192];int n;while((n=input.read(chunk))!=-1){bytes.write(chunk,0,n);assertTrue(bytes.size()<=5*1024*1024);}return bytes.toByteArray();}
 private byte[] asset()throws Exception{try(InputStream input=context.getAssets().open("qa-source.mp4")){return readAll(input);}}
 private byte[] bytes(Uri uri)throws Exception{try(InputStream input=context.getContentResolver().openInputStream(uri)){assertNotNull(input);return readAll(input);}}
 @SuppressWarnings("deprecation")
 private String metadata(Uri uri)throws Exception{
  try(Cursor row=context.getContentResolver().query(MediaStore.setIncludePending(uri),new String[]{"_id","_display_name","owner_package_name","is_pending","is_trashed","generation_modified","_size"},null,null,null)){
   assertNotNull(row);assertTrue(row.moveToFirst());assertEquals(context.getPackageName(),row.getString(2));StringBuilder out=new StringBuilder();for(int i=0;i<row.getColumnCount();i++)out.append(row.isNull(i)?"NULL":row.getString(i)).append('|');assertFalse(row.moveToNext());return out.toString();
  }
 }
 private VideoCopyEdits editor(BooleanSupplier foreground)throws Exception{return new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,(id,revision)->{throw new AssertionError("Preservation must not read an editor source");},foreground);}
 private void refused(Response call)throws Exception{assertTrue(call.done.await(15,TimeUnit.SECONDS));assertNotNull(call.error);assertNull(call.value);}
 private void unchanged(Pending p,String before)throws Exception{assertEquals(p.record,journal.getString(p.token,null));assertEquals(before,metadata(p.uri));assertArrayEquals(p.bytes,bytes(p.uri));}
 private void noComplete(Pending p)throws Exception{assertFalse(new File(p.directory(),"COMPLETE.json").exists());}
 private void dispose(Pending p)throws Exception{
  assertTrue(p.token.matches("video-[a-f0-9-]{36}"));assertTrue(journal.edit().remove(p.token).commit());assertEquals(1,context.getContentResolver().delete(p.uri,"owner_package_name=?",new String[]{context.getPackageName()}));
  Path dir=p.directory().toPath();if(Files.exists(dir,LinkOption.NOFOLLOW_LINKS))try(java.util.stream.Stream<Path> paths=Files.walk(dir)){for(Path path:paths.sorted(Comparator.reverseOrder()).collect(java.util.stream.Collectors.toList()))Files.delete(path);}
 }
 private File privateRoot()throws Exception{File root=new File(context.getFilesDir().getCanonicalFile(),"video-copy-preservation-v1");if(!root.isDirectory())Os.mkdir(root.getAbsolutePath(),0700);return root;}
 @Test public void ownerPendingBytesAreEscrowedWithoutChangingProviderOrJournal()throws Exception{
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);assertTrue(activity.get().hasWindowFocus());
   for(byte[] fixture:List.of(asset(),new byte[0],new byte[]{1,2,3,4,5})){
   Pending p=new Pending(fixture);VideoCopyEdits editor=editor(()->activity.get().hasWindowFocus());boolean verified=false;
   try{String before=metadata(p.uri);Response call=new Response();editor.preserveClosedFailure(p.token,recordHash(p.record),call);com.getcapacitor.JSObject result=call.await();assertEquals("preserved",result.getString("status"));assertEquals(p.token,result.getString("artifactId"));assertEquals((long)p.bytes.length,result.getLong("bytes"));assertEquals(hash(p.bytes),result.getString("sha256"));assertFalse(result.has("path"));assertFalse(result.has("uri"));assertFalse(result.has("dataBase64"));
    assertArrayEquals(p.bytes,Files.readAllBytes(new File(p.directory(),"bytes.bin").toPath()));JSONObject manifest=new JSONObject(new String(Files.readAllBytes(new File(p.directory(),"COMPLETE.json").toPath()),StandardCharsets.UTF_8));assertTrue(manifest.getBoolean("forensicOnly"));assertEquals(manifest.getJSONObject("sourceBefore").toString(),manifest.getJSONObject("sourceAfter").toString());unchanged(p,before);
    byte[] completed=Files.readAllBytes(new File(p.directory(),"COMPLETE.json").toPath());assertArrayEquals(Files.readAllBytes(new File(p.directory(),"COMPLETION.pending").toPath()),completed);android.system.StructStat sealed=Os.lstat(new File(p.directory(),"COMPLETION.pending").getAbsolutePath()),published=Os.lstat(new File(p.directory(),"COMPLETE.json").getAbsolutePath());assertEquals(1,sealed.st_nlink);assertEquals(1,published.st_nlink);assertNotEquals(sealed.st_ino,published.st_ino);
    Response again=new Response();editor.preserveClosedFailure(p.token,recordHash(p.record),again);refused(again);assertArrayEquals(completed,Files.readAllBytes(new File(p.directory(),"COMPLETE.json").toPath()));unchanged(p,before);verified=true;
   }finally{editor.close();if(verified)dispose(p);}
   }
  }
 }
 @Test public void closedRecordIdentityCustodyAndForegroundDenialsCreateNoArchive()throws Exception{
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);
   for(String mode:List.of("missing","wrong-hash","not-failed","wrong-row","renamed","duplicate","retired","foreground-denied","owner-denied","private-storage-denied")){
    Pending p=new Pending(asset());File denied=null;Uri duplicate=null;Context owner=context;
    if(mode.equals("owner-denied"))owner=new ContextWrapper(context){@Override public Context getApplicationContext(){return this;}@Override public String getPackageName(){return "not-the-fixture-owner";}};
    if(mode.equals("private-storage-denied")){denied=new File(context.getFilesDir(),"QA-denied-private-"+UUID.randomUUID());Os.mkdir(denied.getAbsolutePath(),0000);final File deniedRoot=denied;owner=new ContextWrapper(context){@Override public Context getApplicationContext(){return this;}@Override public File getFilesDir(){return deniedRoot;}};}
    VideoCopyEdits editor=new VideoCopyEdits(owner,AlphaMediaConfig.MEDIA,(id,revision)->{throw new AssertionError("Preservation source callback is forbidden");},()->!mode.equals("foreground-denied")&&activity.get().hasWindowFocus());boolean verified=false;
    try{
     if(mode.equals("not-failed"))p.setRecord(new JSONObject(p.record).put("status","exporting"));
     if(mode.equals("wrong-row"))p.setRecord(new JSONObject(p.record).put("pendingId","9223372036854775806"));
     if(mode.equals("renamed")){ContentValues v=new ContentValues();v.put("_display_name","QA-renamed-"+UUID.randomUUID()+".mp4");assertEquals(1,context.getContentResolver().update(p.uri,v,null,null));}
     if(mode.equals("duplicate")){ContentValues values=new ContentValues();values.put("_display_name","Alpha-video-edit-"+p.token.substring(6)+".mp4");values.put("mime_type","video/mp4");values.put("relative_path","Movies/Alpha Video QA/Duplicate/");values.put("is_pending",1);duplicate=context.getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(duplicate);}
     if(mode.equals("retired"))editor.close();
     if(mode.equals("missing"))assertTrue(journal.edit().remove(p.token).commit());String record=journal.getString(p.token,null),before=metadata(p.uri);
     Response call=new Response();editor.preserveClosedFailure(p.token,mode.equals("wrong-hash")?String.format(java.util.Locale.ROOT,"%064d",0):recordHash(p.record),call);refused(call);if(mode.equals("private-storage-denied"))assertTrue(call.error.contains("ErrnoException"));assertFalse(p.directory().exists());assertEquals(record,journal.getString(p.token,null));assertEquals(before,metadata(p.uri));assertArrayEquals(p.bytes,bytes(p.uri));verified=true;
    }finally{editor.close();if(verified){dispose(p);if(denied!=null)Files.delete(denied.toPath());if(duplicate!=null)assertEquals(1,context.getContentResolver().delete(duplicate,"owner_package_name=?",new String[]{context.getPackageName()}));}}
   }
  }
 }
 @Test public void activeSameInstanceRefusesBeforePreservation()throws Exception{
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);
   // Begin first, before introducing the closed pending fixture; no export runs.
   ContentValues values=new ContentValues();values.put("_display_name","QA-active-source-"+UUID.randomUUID()+".mp4");values.put("mime_type","video/mp4");values.put("relative_path","Movies/Alpha Video QA/");values.put("is_pending",1);Uri source=context.getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(source);
   try(OutputStream output=context.getContentResolver().openOutputStream(source,"w")){output.write(asset());}values.clear();values.put("is_pending",0);assertEquals(1,context.getContentResolver().update(source,values,null,null));
   VideoCopyEdits editor=new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,(id,revision)->new VideoCopyEdits.Source(source,revision),()->activity.get().hasWindowFocus());String prepared=null;Pending p=null;boolean verified=false;
   try{Response begin=new Response();editor.begin("owned-source","fixture-revision",begin);prepared=begin.await().getString("sessionId");p=new Pending(asset());String before=metadata(p.uri);Response call=new Response();editor.preserveClosedFailure(p.token,recordHash(p.record),call);refused(call);assertFalse(p.directory().exists());unchanged(p,before);editor.cancel(prepared);Response cancel=new Response();editor.result(prepared,cancel);assertEquals("not-started",cancel.await().getString("status"));verified=true;
   }finally{editor.close();if(verified){dispose(p);assertEquals(1,context.getContentResolver().delete(source,"owner_package_name=?",new String[]{context.getPackageName()}));assertTrue(journal.edit().remove(prepared).commit());}}
  }
 }
 @Test public void oversizedAndUnsafeExistingArtifactsNeverCompleteOrOverwrite()throws Exception{
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);
   for(String mode:List.of("oversize","existing","symlink")){
    Pending p=new Pending(mode.equals("oversize")?new byte[4*1024*1024+1]:asset());VideoCopyEdits editor=editor(()->activity.get().hasWindowFocus());File sentinel=null;boolean verified=false;
    try{String before=metadata(p.uri);byte[] marker={9,8,7};
     if(mode.equals("existing")){privateRoot();Os.mkdir(p.directory().getAbsolutePath(),0700);Files.write(new File(p.directory(),"sentinel").toPath(),marker);}
     if(mode.equals("symlink")){privateRoot();sentinel=new File(context.getFilesDir(),"QA-recovery-sentinel-"+UUID.randomUUID());assertTrue(sentinel.mkdir());Files.write(new File(sentinel,"sentinel").toPath(),marker);Os.symlink(sentinel.getAbsolutePath(),p.directory().getAbsolutePath());}
     Response call=new Response();editor.preserveClosedFailure(p.token,recordHash(p.record),call);refused(call);noComplete(p);unchanged(p,before);
     if(mode.equals("existing"))assertArrayEquals(marker,Files.readAllBytes(new File(p.directory(),"sentinel").toPath()));
     if(mode.equals("symlink"))assertArrayEquals(marker,Files.readAllBytes(new File(sentinel,"sentinel").toPath()));
     if(mode.equals("oversize")){assertTrue(new File(p.directory(),"INCOMPLETE.json").isFile());assertTrue(new File(p.directory(),"bytes.bin").length()<=4*1024*1024);}
     verified=true;
    }finally{editor.close();if(verified){dispose(p);if(sentinel!=null){Files.delete(new File(sentinel,"sentinel").toPath());Files.delete(sentinel.toPath());}}}
   }
  }
 }
 @Test public void concurrentProviderBytesMetadataJournalAndForegroundChangesRemainIncomplete()throws Exception{
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);
   for(String mode:List.of("bytes","metadata","journal","foreground")){
    Pending p=new Pending(new byte[256*1024]);CountDownLatch copying=new CountDownLatch(1),release=new CountDownLatch(1);AtomicBoolean held=new AtomicBoolean();File copied=new File(p.directory(),"bytes.bin");
    VideoCopyEdits editor=editor(()->{if(copied.length()>0&&held.compareAndSet(false,true)){copying.countDown();try{if(!release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("Fixture actor did not release");}catch(InterruptedException e){Thread.currentThread().interrupt();return false;}}return activity.get().hasWindowFocus();});boolean verified=false;
    try{Response call=new Response();editor.preserveClosedFailure(p.token,recordHash(p.record),call);assertTrue(copying.await(10,TimeUnit.SECONDS));
     if(mode.equals("metadata")){ContentValues v=new ContentValues();v.put("_display_name","QA-raced-"+UUID.randomUUID()+".mp4");assertEquals(1,context.getContentResolver().update(p.uri,v,null,null));}
     if(mode.equals("bytes"))try(android.os.ParcelFileDescriptor fd=context.getContentResolver().openFileDescriptor(p.uri,"rw")){assertNotNull(fd);Os.pwrite(fd.getFileDescriptor(),new byte[]{77},0,1,0);Os.fsync(fd.getFileDescriptor());}
     if(mode.equals("journal"))p.setRecord(new JSONObject(p.record).put("reviewActor",true));
     if(mode.equals("foreground"))scene.moveToState(Lifecycle.State.CREATED);
     String actorMetadata=metadata(p.uri),actorRecord=journal.getString(p.token,null);byte[] actorBytes=bytes(p.uri);release.countDown();refused(call);noComplete(p);assertEquals(actorMetadata,metadata(p.uri));assertEquals(actorRecord,journal.getString(p.token,null));assertArrayEquals(actorBytes,bytes(p.uri));assertTrue(new File(p.directory(),"INCOMPLETE.json").isFile());verified=true;
    }finally{release.countDown();editor.close();if(verified)dispose(p);if(mode.equals("foreground"))scene.moveToState(Lifecycle.State.RESUMED);}
   }
  }
 }
 @Test public void postSealForegroundOrRecordChangeRefusesWithoutTreatingMarkerAsAcceptance()throws Exception{
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);
   for(String mode:List.of("foreground","record")){
    Pending p=new Pending(asset());File complete=new File(p.directory(),"COMPLETE.json");AtomicBoolean sawSeal=new AtomicBoolean();
    VideoCopyEdits editor=editor(()->{
     if(complete.exists()){
      if(mode.equals("foreground")){sawSeal.set(true);return false;}
      if(sawSeal.compareAndSet(false,true))try{p.setRecord(new JSONObject(p.record).put("postSealActor",true));}catch(Exception error){throw new IllegalStateException(error);}
     }
     return activity.get().hasWindowFocus();
    });boolean verified=false;
    try{
     String before=metadata(p.uri);Response call=new Response();editor.preserveClosedFailure(p.token,recordHash(p.record),call);refused(call);assertTrue("The final authority check must run after the sealed marker exists",sawSeal.get());assertTrue(complete.isFile());assertTrue(new File(p.directory(),"INCOMPLETE.json").isFile());assertNull("A sealed marker alone must not report success",call.value);
     assertEquals(p.record,journal.getString(p.token,null));assertEquals(before,metadata(p.uri));assertArrayEquals(p.bytes,bytes(p.uri));assertArrayEquals(p.bytes,Files.readAllBytes(new File(p.directory(),"bytes.bin").toPath()));verified=true;
    }finally{editor.close();if(verified)dispose(p);}
   }
  }
 }
 @Test public void exclusiveCompletionRefusesExistingFullAndPartialMarkers()throws Exception{
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);
   for(boolean partial:List.of(false,true)){
    Pending p=new Pending(asset());File sealed=new File(p.directory(),"COMPLETION.pending"),complete=new File(p.directory(),"COMPLETE.json");AtomicBoolean injected=new AtomicBoolean();AtomicReference<byte[]> sentinel=new AtomicReference<>();AtomicReference<Exception> actorError=new AtomicReference<>();
    VideoCopyEdits editor=editor(()->{
     if(sealed.exists()&&injected.compareAndSet(false,true))try{byte[] value=partial?"{\"operationId\":".getBytes(StandardCharsets.UTF_8):Files.readAllBytes(sealed.toPath());Files.write(complete.toPath(),value,StandardOpenOption.CREATE_NEW,StandardOpenOption.WRITE);sentinel.set(value);}catch(Exception error){actorError.set(error);}
     return activity.get().hasWindowFocus();
    });boolean verified=false;
    try{
     String before=metadata(p.uri);Response call=new Response();editor.preserveClosedFailure(p.token,recordHash(p.record),call);refused(call);assertTrue(injected.get());assertNull(actorError.get());assertNotNull(sentinel.get());assertTrue(call.error.contains("complete/ErrnoException"));assertArrayEquals(sentinel.get(),Files.readAllBytes(complete.toPath()));
     JSONObject incomplete=new JSONObject(new String(Files.readAllBytes(new File(p.directory(),"INCOMPLETE.json").toPath()),StandardCharsets.UTF_8));assertEquals(android.system.OsConstants.EEXIST,incomplete.getInt("errno"));assertNull("Existing full or partial filenames never authorize success",call.value);unchanged(p,before);verified=true;
    }finally{editor.close();if(verified)dispose(p);}
   }
  }
 }

}
