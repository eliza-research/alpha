package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.VideoCopyEdits;

import static org.junit.Assert.*;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.media.MediaMetadataRetriever;
import android.media.MediaExtractor;
import android.media.MediaCodec;
import android.media.MediaFormat;
import android.media.AudioFormat;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Actual Android codec, MediaStore, durable copy/recovery and lifecycle execution.
 * Only the bridge response sink is observed; input and provider effects are real. */
@RunWith(AndroidJUnit4.class)
public final class VideoCopyInstrumentedTest {
 private final Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
 private final ArrayList<Uri> owned=new ArrayList<>();
 static final class Response extends PluginCall {
  final CountDownLatch done=new CountDownLatch(1);volatile JSObject value;volatile String error;
  Response(){super(null,"VideoFixture",UUID.randomUUID().toString(),"fixture",new JSObject());}
  @Override public void resolve(JSObject value){this.value=value;done.countDown();}
  @Override public void reject(String message){error=message;done.countDown();}
  JSObject await()throws Exception{assertTrue("Native callback timed out",done.await(45,TimeUnit.SECONDS));assertNull(error,error);assertNotNull(value);return value;}
 }
 private Uri source()throws Exception{return source("qa-source.mp4");}
 private Uri source(String asset)throws Exception {
  ContentValues values=new ContentValues();values.put("_display_name","AlphaVideo-QA-source-"+UUID.randomUUID()+".mp4");values.put("mime_type","video/mp4");values.put("relative_path","Movies/Alpha Video QA/");values.put("is_pending",1);
  Uri uri=context.getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(uri);owned.add(uri);
  try(InputStream input=context.getAssets().open(asset);OutputStream output=context.getContentResolver().openOutputStream(uri,"w")){assertNotNull(output);byte[] bytes=new byte[8192];int n;while((n=input.read(bytes))!=-1)output.write(bytes,0,n);}
  values.clear();values.put("is_pending",0);assertEquals(1,context.getContentResolver().update(uri,values,null,null));return uri;
 }
 private String revision(Uri uri)throws Exception {
  try(Cursor row=context.getContentResolver().query(uri,new String[]{"_size","date_modified","generation_modified","owner_package_name","is_pending","is_trashed"},null,null,null)){
   assertNotNull(row);assertTrue(row.moveToFirst());assertEquals(context.getPackageName(),row.getString(3));assertEquals(0,row.getInt(4));assertEquals(0,row.getInt(5));return row.getLong(0)+":"+row.getLong(1)+":"+row.getLong(2);
  }
 }
 private byte[] digest(Uri uri)throws Exception {MessageDigest hash=MessageDigest.getInstance("SHA-256");try(InputStream input=context.getContentResolver().openInputStream(uri)){assertNotNull(input);byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1)hash.update(buffer,0,n);}return hash.digest();}
 private Uri copy(JSObject receipt){assertEquals("saved",receipt.getString("status"));String id=receipt.getString("id");assertTrue(id.startsWith("v:"));Uri uri=ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,Long.parseLong(id.substring(2)));owned.add(uri);return uri;}
 private int copies(String token)throws Exception {try(Cursor rows=context.getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,new String[]{"_id"},"owner_package_name=? AND _display_name=?",new String[]{context.getPackageName(),"Alpha-video-edit-"+token.substring(6)+".mp4"},null)){assertNotNull(rows);return rows.getCount();}}
 private void near(int expected,int actual){assertTrue("Expected "+expected+", got "+actual,Math.abs(expected-actual)<=25);}
 private void color(int actual,int expected){near(Color.red(expected),Color.red(actual));near(Color.green(expected),Color.green(actual));near(Color.blue(expected),Color.blue(actual));}
 private Bitmap frame(MediaMetadataRetriever media,long micros)throws Exception{
  Bitmap bitmap=media.getFrameAtTime(micros,MediaMetadataRetriever.OPTION_CLOSEST);assertNotNull(bitmap);
  int rotation=Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION));
  int width=Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)),height=Integer.parseInt(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT));
  if(Math.floorMod(rotation,180)!=0&&bitmap.getWidth()==width&&bitmap.getHeight()==height){android.graphics.Matrix matrix=new android.graphics.Matrix();matrix.postRotate(rotation);Bitmap oriented=Bitmap.createBitmap(bitmap,0,0,width,height,matrix,true);bitmap.recycle();bitmap=oriented;}return bitmap;
 }
 private void inspect(Uri original,Uri uri)throws Exception {
  long duration;
  try(MediaMetadataRetriever media=new MediaMetadataRetriever();MediaMetadataRetriever source=new MediaMetadataRetriever()){
   source.setDataSource(context,original);
   media.setDataSource(context,uri);assertEquals("yes",media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO));duration=Long.parseLong(media.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION));assertTrue(duration>=1450&&duration<=1750);
   Bitmap first=frame(media,0);
   assertEquals(184,first.getWidth());assertEquals(246,first.getHeight());int w=first.getWidth(),h=first.getHeight();
   color(first.getPixel(w/4,h/4),Color.BLUE);color(first.getPixel(w*3/4,h/4),Color.RED);color(first.getPixel(w/4,h*3/4),Color.WHITE);color(first.getPixel(w*3/4,h*3/4),Color.GREEN);first.recycle();
   for(long time=0;time<duration-100;time+=100){Bitmap output=frame(media,time*1000),input=frame(source,(1200+time)*1000);int actual=output.getPixel(output.getWidth()/2,output.getHeight()/2),expected=input.getPixel(input.getWidth()/2,input.getHeight()/2);assertTrue("Trim timestamp marker changed at "+time,Math.abs(Color.red(actual)-Color.red(expected))<=7&&Math.abs(Color.green(actual)-Color.green(expected))<=7&&Math.abs(Color.blue(actual)-Color.blue(expected))<=7);output.recycle();input.recycle();}
  }
  MediaExtractor video=new MediaExtractor();try{video.setDataSource(context,uri,null);int track=-1;for(int i=0;i<video.getTrackCount();i++)if(video.getTrackFormat(i).getString(MediaFormat.KEY_MIME).startsWith("video/"))track=i;assertTrue(track>=0);video.selectTrack(track);int samples=0;long last=0;do{long pts=video.getSampleTime();assertTrue("Hidden video pre-roll",pts>=0);last=pts;samples++;}while(video.advance());assertTrue(samples>=40&&samples<=50);assertTrue(last<=1_650_000);}finally{video.release();}
  audio(uri,duration);
 }
 private void audio(Uri uri,long duration)throws Exception {
  MediaExtractor extractor=new MediaExtractor();MediaCodec decoder=null;
  try{
   extractor.setDataSource(context,uri,null);int track=-1;for(int i=0;i<extractor.getTrackCount();i++)if(extractor.getTrackFormat(i).getString(MediaFormat.KEY_MIME).startsWith("audio/"))track=i;assertTrue(track>=0);extractor.selectTrack(track);MediaFormat format=extractor.getTrackFormat(track);
   decoder=MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));decoder.configure(format,null,null,0);decoder.start();boolean inputEnded=false,outputEnded=false;int rate=48000,encoding=AudioFormat.ENCODING_PCM_16BIT;ByteArrayOutputStream pcm=new ByteArrayOutputStream();MediaCodec.BufferInfo info=new MediaCodec.BufferInfo();long deadline=android.os.SystemClock.elapsedRealtime()+15000;
   while(!outputEnded){assertTrue("Audio decode timed out",android.os.SystemClock.elapsedRealtime()<deadline);
    if(!inputEnded){int index=decoder.dequeueInputBuffer(1000);if(index>=0){ByteBuffer input=decoder.getInputBuffer(index);int size=extractor.readSampleData(input,0);if(size<0){decoder.queueInputBuffer(index,0,0,0,MediaCodec.BUFFER_FLAG_END_OF_STREAM);inputEnded=true;}else{decoder.queueInputBuffer(index,0,size,extractor.getSampleTime(),0);extractor.advance();}}}
    int index=decoder.dequeueOutputBuffer(info,1000);if(index==MediaCodec.INFO_OUTPUT_FORMAT_CHANGED){MediaFormat out=decoder.getOutputFormat();rate=out.getInteger(MediaFormat.KEY_SAMPLE_RATE);assertEquals(1,out.getInteger(MediaFormat.KEY_CHANNEL_COUNT));if(out.containsKey(MediaFormat.KEY_PCM_ENCODING))encoding=out.getInteger(MediaFormat.KEY_PCM_ENCODING);}
    else if(index>=0){ByteBuffer buffer=decoder.getOutputBuffer(index);if(info.size>0){byte[] bytes=new byte[info.size];buffer.position(info.offset);buffer.get(bytes);pcm.write(bytes);assertTrue(pcm.size()<2_000_000);}outputEnded=(info.flags&MediaCodec.BUFFER_FLAG_END_OF_STREAM)!=0;decoder.releaseOutputBuffer(index,false);}
   }
   ByteBuffer bytes=ByteBuffer.wrap(pcm.toByteArray()).order(ByteOrder.LITTLE_ENDIAN);assertTrue(encoding==AudioFormat.ENCODING_PCM_16BIT||encoding==AudioFormat.ENCODING_PCM_FLOAT);float[] values=new float[bytes.remaining()/(encoding==AudioFormat.ENCODING_PCM_FLOAT?4:2)];for(int i=0;i<values.length;i++)values[i]=encoding==AudioFormat.ENCODING_PCM_FLOAT?bytes.getFloat():bytes.getShort()/32768f;
   assertTone(values,rate,.1,.3,880);assertTone(values,rate,duration/1000d-.3,duration/1000d-.1,1320);
  }finally{if(decoder!=null){decoder.stop();decoder.release();}extractor.release();}
 }
 private void assertTone(float[] pcm,int rate,double start,double end,int expected){int begin=(int)(start*rate),finish=Math.min(pcm.length,(int)(end*rate)),crossings=0;assertTrue(finish>begin);double square=0;for(int i=begin;i<finish;i++){square+=pcm[i]*pcm[i];if(i>begin&&pcm[i-1]<=0&&pcm[i]>0)crossings++;}assertTrue("Audio was silent",Math.sqrt(square/(finish-begin))>.05);double frequency=crossings*rate/(double)(finish-begin);assertTrue("Wrong audio interval: "+frequency,Math.abs(frequency-expected)<=25);}
 @SuppressWarnings("deprecation")
 private void cleanup()throws Exception {for(Uri uri:owned){try(Cursor row=context.getContentResolver().query(MediaStore.setIncludePending(uri),new String[]{"owner_package_name"},null,null,null)){if(row!=null&&row.moveToFirst()){assertEquals(context.getPackageName(),row.getString(0));context.getContentResolver().delete(uri,null,null);}}}owned.clear();}

 @Test public void realTrimRotateCropAudioRecoveryCancellationAndOriginalPreservation()throws Exception {
  JSONObject report=new JSONObject().put("layer","physical native exporter component; not full Alpha UI acceptance").put("networkPermission",false).put("source","generated four-quadrant video with timestamp markers and four audio tones");
  boolean verified=false;
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertTrue("Unlock the device and leave the QA activity visible",activity.get().hasWindowFocus());
   Uri original=source();String initial=revision(original);byte[] originalBytes=digest(original);String sourceId=UUID.randomUUID().toString();
   VideoCopyEdits editor=new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,(id,expected)->{if(!activity.get().hasWindowFocus()||!id.equals(sourceId)||!revision(original).equals(expected))throw new IllegalStateException("Video source changed or activity left foreground");return new VideoCopyEdits.Source(original,expected);});activity.get().editor=editor;
   Response begin=new Response();editor.begin(sourceId,initial,begin);JSObject session=begin.await();String token=session.getString("sessionId");
   Response save=new Response();editor.save(token,1.2,2.8,90,true,save);JSObject saved=save.await();Uri result=copy(saved);inspect(original,result);assertArrayEquals(originalBytes,digest(original));assertEquals(initial,revision(original));assertEquals(1,copies(token));
   // Simulate only the missing post-publication journal update, after a real save.
   android.content.SharedPreferences journal=context.getSharedPreferences("alpha-video-copy-results-v1",0);JSONObject stale=new JSONObject(journal.getString(token,null));stale.put("status","exporting");stale.remove("id");assertTrue(journal.edit().putString(token,stale.toString()).commit());
   Response recovered=new Response();editor.result(token,recovered);assertEquals(saved.getString("id"),recovered.await().getString("id"));assertEquals(1,copies(token));
   Response duplicate=new Response();editor.save(token,1.2,2.8,90,true,duplicate);assertEquals(saved.getString("id"),duplicate.await().getString("id"));assertEquals(1,copies(token));
   Response changed=new Response();editor.save(token,1.3,2.8,90,true,changed);assertTrue(changed.done.await(10,TimeUnit.SECONDS));assertNotNull(changed.error);assertEquals(1,copies(token));
   Response again=new Response();editor.begin(sourceId,initial,again);String cancelled=again.await().getString("sessionId");editor.cancel(cancelled);Response cancellation=new Response();editor.result(cancelled,cancellation);assertEquals("not-started",cancellation.await().getString("status"));assertEquals(0,copies(cancelled));assertArrayEquals(originalBytes,digest(original));
   report.put("trimRotateCropAndAudioTrack",true).put("videoTimestampMarkersMatchOriginal",true).put("physicalVideoSampleCountAndNoPreRoll",true).put("decodedAudioTonesPreserved",true).put("originalBytesAndRevisionUnchanged",true).put("publishedCopyRecoveredWithoutDuplicate",true).put("duplicateSaveReturnedSameCopy",true).put("changedBindingRefused",true).put("cancelCreatedNoCopy",true).put("passed",true);verified=true;
  }finally{if(verified)cleanup();try(java.io.FileOutputStream out=context.openFileOutput("video-qa-result.json",Context.MODE_PRIVATE)){out.write(report.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
 }
 private void encoding(String token,Response save)throws Exception {
  java.io.File output=new java.io.File(context.getCacheDir(),"alpha-video-edits/"+token+"-output.mp4");long deadline=android.os.SystemClock.elapsedRealtime()+10000;
  while(output.length()==0&&save.done.getCount()!=0&&android.os.SystemClock.elapsedRealtime()<deadline)Thread.sleep(5);
  assertTrue("Export did not enter its real encoder",output.length()>0);assertEquals("Export finished before the lifecycle test",1,save.done.getCount());
 }
 @Test public void sourceChangeAndBackgroundDuringRealEncodingPublishNoStaleCopy()throws Exception {
  JSONObject report=new JSONObject().put("layer","physical exporter lifecycle component only");
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);InstrumentationRegistry.getInstrumentation().waitForIdleSync();assertTrue(activity.get().hasWindowFocus());
   Uri original=source("qa-long.mp4");byte[] originalBytes=digest(original);String id=UUID.randomUUID().toString();
   VideoCopyEdits editor=new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,(key,expected)->{if(!activity.get().hasWindowFocus()||!key.equals(id)||!revision(original).equals(expected))throw new IllegalStateException("Source changed or activity left foreground");return new VideoCopyEdits.Source(original,expected);});activity.get().editor=editor;
   Response open=new Response();editor.begin(id,revision(original),open);String changed=open.await().getString("sessionId");Response save=new Response();editor.save(changed,0,19.5,90,true,save);encoding(changed,save);
   ContentValues mutation=new ContentValues();mutation.put("_display_name","AlphaVideo-QA-mutated-"+UUID.randomUUID()+".mp4");assertEquals(1,context.getContentResolver().update(original,mutation,null,null));assertEquals("failed",save.await().getString("status"));assertEquals(0,copies(changed));assertArrayEquals(originalBytes,digest(original));
   Response next=new Response();editor.begin(id,revision(original),next);String background=next.await().getString("sessionId");Response pending=new Response();editor.save(background,0,19.5,90,true,pending);encoding(background,pending);
   scene.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);assertEquals("failed",pending.await().getString("status"));assertEquals(0,copies(background));assertArrayEquals(originalBytes,digest(original));
   report.put("sourceChangedDuringRealEncodingRefused",true).put("backgroundCancelledRealEncoding",true).put("noPublishedCopy",true).put("originalBytesUnchanged",true).put("passed",true);
  }finally{cleanup();try(java.io.FileOutputStream out=context.openFileOutput("video-qa-lifecycle.json",Context.MODE_PRIVATE)){out.write(report.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
 }
 @Test public void lateEncoderCallbackAfterWorkerShutdownRejectsAndKeepsRecovery()throws Exception {
  try(ActivityScenario<VideoFixtureActivity> scene=ActivityScenario.launch(VideoFixtureActivity.class)){
   AtomicReference<VideoFixtureActivity> activity=new AtomicReference<>();scene.onActivity(activity::set);InstrumentationRegistry.getInstrumentation().waitForIdleSync();
   Uri original=source();byte[] originalBytes=digest(original);String revision=revision(original),id=UUID.randomUUID().toString();
   VideoCopyEdits.Sources sources=(key,expected)->{if(!key.equals(id)||!revision(original).equals(expected))throw new IllegalStateException("Source changed");return new VideoCopyEdits.Source(original,expected);};
   VideoCopyEdits editor=new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,sources);activity.get().editor=editor;
   Response begin=new Response();editor.begin(id,revision,begin);String token=begin.await().getString("sessionId");
   java.lang.reflect.Field active=VideoCopyEdits.class.getDeclaredField("active");active.setAccessible(true);Object session=active.get(editor);assertNotNull(session);
   Response save=new Response();java.lang.reflect.Field call=session.getClass().getDeclaredField("saveCall");call.setAccessible(true);call.set(session,save);
   java.lang.reflect.Field worker=VideoCopyEdits.class.getDeclaredField("io");worker.setAccessible(true);((java.util.concurrent.ExecutorService)worker.get(editor)).shutdown();
   java.lang.reflect.Method callback=VideoCopyEdits.class.getDeclaredMethod("finish",session.getClass(),Exception.class);callback.setAccessible(true);callback.invoke(editor,session,null);
   assertTrue(save.done.await(2,TimeUnit.SECONDS));assertTrue(save.error.contains("outcome is unresolved"));assertEquals(0,copies(token));assertArrayEquals(originalBytes,digest(original));
   Response late=new Response();editor.result(token,late);assertTrue(late.done.await(2,TimeUnit.SECONDS));assertEquals("Video editor closed",late.error);editor.close();editor.close();
   VideoCopyEdits recovery=new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,sources);try{Response read=new Response();recovery.result(token,read);assertEquals("not-started",read.await().getString("status"));assertEquals(0,copies(token));}finally{recovery.close();}
  }finally{cleanup();}
 }

 @SuppressWarnings("deprecation")
 @Test public void failedReceiptRetainsPendingProviderOutput()throws Exception {
  String token="video-"+UUID.randomUUID();android.content.SharedPreferences journal=context.getSharedPreferences("alpha-video-copy-results-v1",0);
  VideoCopyEdits editor=new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,(id,revision)->{throw new AssertionError("Recovery must not open another source");});
  boolean verified=false;
  try{
   ContentValues values=new ContentValues();values.put("_display_name","Alpha-video-edit-"+token.substring(6)+".mp4");values.put("mime_type","video/mp4");values.put("relative_path","Movies/Alpha Video QA/");values.put("is_pending",1);
   Uri pending=context.getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(pending);owned.add(pending);
   try(InputStream input=context.getAssets().open("qa-source.mp4");OutputStream output=context.getContentResolver().openOutputStream(pending,"w")){assertNotNull(output);byte[] chunk=new byte[8192];int n;while((n=input.read(chunk))!=-1)output.write(chunk,0,n);}
   byte[] original=digest(pending);String record=new JSONObject().put("status","failed").put("createdAt",System.currentTimeMillis()).put("binding","1000:3000:90:false:240:320").toString();assertTrue(journal.edit().putString(token,record).commit());
   for(int attempt=0;attempt<2;attempt++){Response result=new Response();editor.result(token,result);assertTrue(result.done.await(10,TimeUnit.SECONDS));assertEquals("Pending video copy needs recovery review",result.error);assertNull(result.value);assertEquals(record,journal.getString(token,null));assertArrayEquals(original,digest(pending));}
   try(Cursor row=context.getContentResolver().query(MediaStore.setIncludePending(pending),new String[]{"_id","is_pending"},null,null,null)){assertNotNull(row);assertTrue(row.moveToFirst());assertEquals(ContentUris.parseId(pending),row.getLong(0));assertEquals(1,row.getInt(1));assertFalse(row.moveToNext());}verified=true;
  }finally{editor.close();if(verified){assertTrue(journal.edit().remove(token).commit());cleanup();}}
 }
 @Test public void recordedMissingPendingOutputCannotBecomeFalseFailure()throws Exception {
  String token="video-"+UUID.randomUUID();android.content.SharedPreferences journal=context.getSharedPreferences("alpha-video-copy-results-v1",0);
  VideoCopyEdits editor=new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,(id,revision)->{throw new AssertionError("Recovery must not open another source");});
  boolean verified=false;
  try{
   String record=new JSONObject().put("status","exporting").put("createdAt",System.currentTimeMillis()).put("pendingId","9223372036854775806").toString();assertTrue(journal.edit().putString(token,record).commit());
   Response result=new Response();editor.result(token,result);assertTrue(result.done.await(10,TimeUnit.SECONDS));assertEquals("Recorded video copy needs recovery review",result.error);assertNull(result.value);assertEquals(record,journal.getString(token,null));verified=true;
  }finally{editor.close();if(verified)assertTrue(journal.edit().remove(token).commit());}
 }

 @Test public void beginRetainsFailedMissingOrMismatchedOutputCustody()throws Exception {
  for(boolean mismatch:new boolean[]{false,true}){
   String token="video-"+UUID.randomUUID();android.content.SharedPreferences journal=context.getSharedPreferences("alpha-video-copy-results-v1",0);
   java.util.concurrent.atomic.AtomicBoolean sourceRead=new java.util.concurrent.atomic.AtomicBoolean();
   VideoCopyEdits editor=new VideoCopyEdits(context,AlphaMediaConfig.MEDIA,(id,revision)->{sourceRead.set(true);throw new AssertionError("Custody hold must happen before source read/export");});
   boolean verified=false;
   java.io.File directory=new java.io.File(context.getCacheDir(),"alpha-video-edits"),input=new java.io.File(directory,token+"-input.mp4"),output=new java.io.File(directory,token+"-output.mp4");
   if(!directory.isDirectory())assertTrue(directory.mkdirs());
   byte[] inputBytes=new byte[]{11,22,33,44},outputBytes=new byte[]{55,66,77,88};
   try{
    try(java.io.FileOutputStream f=new java.io.FileOutputStream(input)){f.write(inputBytes);}try(java.io.FileOutputStream f=new java.io.FileOutputStream(output)){f.write(outputBytes);}
    byte[] inputHash=MessageDigest.getInstance("SHA-256").digest(java.nio.file.Files.readAllBytes(input.toPath())),outputHash=MessageDigest.getInstance("SHA-256").digest(java.nio.file.Files.readAllBytes(output.toPath()));
    if(mismatch){ContentValues values=new ContentValues();values.put("_display_name","Alpha-video-edit-"+token.substring(6)+".mp4");values.put("mime_type","video/mp4");values.put("relative_path","Movies/Alpha Video QA/");values.put("is_pending",1);Uri found=context.getContentResolver().insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,values);assertNotNull(found);owned.add(found);assertNotEquals("9223372036854775806",Long.toString(ContentUris.parseId(found)));}
    String record=new JSONObject().put("status","failed").put("createdAt",System.currentTimeMillis()).put("pendingId","9223372036854775806").toString();assertTrue(journal.edit().putString(token,record).commit());
    Response begin=new Response();editor.begin("not-admitted-source","not-read",begin);assertTrue(begin.done.await(10,TimeUnit.SECONDS));assertEquals("Recorded video copy needs recovery review",begin.error);assertNull(begin.value);assertFalse(sourceRead.get());
    assertEquals(record,journal.getString(token,null));assertArrayEquals(inputHash,MessageDigest.getInstance("SHA-256").digest(java.nio.file.Files.readAllBytes(input.toPath())));assertArrayEquals(outputHash,MessageDigest.getInstance("SHA-256").digest(java.nio.file.Files.readAllBytes(output.toPath())));verified=true;
   }finally{editor.close();if(verified){assertTrue(journal.edit().remove(token).commit());if(input.exists())assertTrue(input.delete());if(output.exists())assertTrue(output.delete());cleanup();}}
  }
 }

}
