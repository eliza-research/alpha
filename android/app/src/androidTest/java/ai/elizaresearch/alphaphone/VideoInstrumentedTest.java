package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.media.OwnedVideoPlayback;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.HashSet;
import java.util.Set;
import static org.junit.Assert.*;

/** Real CameraX MP4 -> owned MediaStore -> durable prototype library -> decoded playback. */
@RunWith(AndroidJUnit4.class)
public class VideoInstrumentedTest {
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private String eval(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js)throws Exception{
  long end=SystemClock.elapsedRealtime()+30000;
  while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+js+")")))return;SystemClock.sleep(100);}
  fail("Video condition: "+js+"; screen="+eval("document.body.innerText.slice(-1200)"));
 }
 private void click(String label)throws Exception{
  String selector="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";
  until(selector);eval("("+selector+").click()");
 }
 private void navigate(String label)throws Exception{until("document.documentElement.dataset.activeView");eval(AppNavigation.request(label));until(AppNavigation.selected(label));}
 private String playbackDiagnostics()throws Exception{
  java.util.concurrent.atomic.AtomicReference<String> result=new java.util.concurrent.atomic.AtomicReference<>("unavailable");
  WebViewTestDriver.withActivity(MainActivity.class,activity->{try{
   Object plugin=activity.getBridge().getPlugin("AlphaPhotos").getInstance();
   java.lang.reflect.Field field=ai.eliza.plugins.media.PhotosPlugin.class.getDeclaredField("playback");field.setAccessible(true);
   result.set(((OwnedVideoPlayback)field.get(plugin)).diagnostics());
  }catch(Exception error){result.set(error.getClass().getSimpleName());}});return result.get();
 }
 private Set<Uri> owned(){
  Set<Uri> result=new HashSet<>();
  try(Cursor c=context().getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,new String[]{"_id"},MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND is_pending=0",new String[]{context().getPackageName()},null)){
   if(c!=null)while(c.moveToNext())result.add(ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,c.getLong(0)));
  }return result;
 }
 private void permission(){
  for(String permission:new String[]{Manifest.permission.CAMERA,Manifest.permission.RECORD_AUDIO}) InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(),permission);
  if(android.os.Build.VERSION.SDK_INT>=33)InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(),Manifest.permission.POST_NOTIFICATIONS);
 }
 private void admitAccount()throws Exception{
  if(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS){AppNavigation.liveMode();return;}
  until("[...document.querySelectorAll('.alpha-connection button')].some(b=>b.textContent.trim()==='Sign in with Eliza Cloud'&&!b.disabled)");
  try(java.io.InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("video-account-fixture.js")){
   eval(new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8));
  }
  // Use the production control and identity/balance/provider binding path.
  // Only its account/runtime boundary is synthetic; Camera/Photos remain native.
  eval("[...document.querySelectorAll('.alpha-connection button')].find(b=>b.textContent.trim()==='Sign in with Eliza Cloud').click()");
  // In-app sign-in: the email code is entered on Alpha's own screen (the host is the fixture above).
  until("document.querySelector('.alpha-cloud-sign-in input[name=email]')");
  eval("(()=>{const toggle=document.getElementById('alpha-sign-in-other-methods')?.previousElementSibling;if(toggle?.getAttribute('aria-expanded')==='false')toggle.click();const field=document.querySelector('.alpha-cloud-sign-in input[name=email]');field.value='video-fixture@example.invalid';[...document.querySelectorAll('.alpha-cloud-sign-in button')].find(b=>b.textContent.trim()==='Email me a code').click();})()");
  until("document.querySelector('.alpha-cloud-sign-in input[name=one-time-code]')");
  eval("(()=>{const field=document.querySelector('.alpha-cloud-sign-in input[name=one-time-code]');field.value='123456';[...document.querySelectorAll('.alpha-cloud-sign-in button')].find(b=>b.textContent.trim()==='Verify').click();})()");
  until("!document.querySelector('.alpha-connection-scrim')");
  assertEquals("Production account admission reached native startup","true",eval("window.__alphaVideoAccount.calls.includes('/api/v1/user')&&window.__alphaVideoAccount.calls.includes('/api/v1/billing/limits')&&window.__alphaVideoAccount.calls.includes('configureCloudProvider')&&window.__alphaVideoAccount.calls.includes('start')"));
 }
 private void begin()throws Exception{
  navigate("Camera");until("document.querySelector('[data-alpha-camera-screen]')");
  until("[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Video')");
  eval("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Video').click()");
  click("Start recording");until("document.querySelector('button[aria-label=\"Stop recording\"]')");
  SystemClock.sleep(2500);
 }
 private void assertMedia(Uri uri)throws Exception{
  try(android.os.ParcelFileDescriptor file=context().getContentResolver().openFileDescriptor(uri,"r")){assertNotNull(file);assertTrue("Finalized MP4 contains actual bytes",file.getStatSize()>1000);}
  MediaMetadataRetriever metadata=new MediaMetadataRetriever();
  try{metadata.setDataSource(context(),uri);assertTrue("Actual recording duration",Long.parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))>=1000);assertTrue(Integer.parseInt(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH))>0);assertTrue(Integer.parseInt(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT))>0);android.graphics.Bitmap frame=metadata.getFrameAtTime();assertNotNull("Video decodes a real frame",frame);frame.recycle();}finally{metadata.release();}
 }
 @Test public void recordsDurableVideoAndPrototypeControlsDriveRealPlayback()throws Exception{
  permission();Set<Uri> before=owned();
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   admitAccount();begin();click("Stop recording");until("document.body.innerText.includes('Video saved to Android Photos.')");
   Set<Uri> created=owned();created.removeAll(before);assertEquals("One finalized video",1,created.size());assertMedia(created.iterator().next());
   click("Open last photo");until(AppNavigation.selected("Photos"));until("document.body.innerText.includes('Captured video')");
   click("Play video");until("(()=>{const v=document.querySelector('video[data-alpha-captured-video]');return v&&!v.paused&&v.currentTime>0.2&&v.videoWidth>0})()");
   click("Pause video");until("document.querySelector('video[data-alpha-captured-video]')?.paused && document.querySelector('button[aria-label=\"Play video\"]')");
   byte[] prefix;
   try(java.io.InputStream input=context().getContentResolver().openInputStream(created.iterator().next())){assertNotNull(input);prefix=input.readNBytes(32);}
   String rangeBaseline=playbackDiagnostics();
   eval("window.__videoRange={phase:'requesting',done:false};(async()=>{const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),8000);try{const video=document.querySelector('video[data-alpha-captured-video]');if(!video?.src)throw new Error('Video source unavailable');const source=new URL(video.src,location.href);window.__videoRange={...window.__videoRange,sameOrigin:source.origin===location.origin,protocol:source.protocol,documentProtocol:location.protocol,ownedPath:source.pathname.startsWith('/_alpha_owned_video/'),connected:video.isConnected,readyState:video.readyState,currentTime:video.currentTime};const r=await fetch(source.href,{headers:{Range:'bytes=16-31'},signal:abort.signal});window.__videoRange={phase:'reading',done:false,status:r.status,length:r.headers.get('content-length'),range:r.headers.get('content-range')};const bytes=new Uint8Array(await r.arrayBuffer());window.__videoRange={...window.__videoRange,phase:'complete',done:true,bytes:btoa(String.fromCharCode(...bytes))};}catch(error){window.__videoRange={...window.__videoRange,done:true,error:String(error?.name||'Error')+': '+String(error?.message||'Range request failed')};}finally{clearTimeout(timer);}})()");
   until("window.__videoRange?.done");assertEquals("Range fetch failed: "+eval("JSON.stringify(window.__videoRange)")+" nativeBefore="+rangeBaseline+" nativeAfter="+playbackDiagnostics(),"false",eval("!!window.__videoRange.error"));assertEquals("Real nonzero byte range", "206",eval("window.__videoRange.status"));assertArrayEquals("Exact selected byte range",java.util.Arrays.copyOfRange(prefix,16,32),android.util.Base64.decode((String)new org.json.JSONTokener(eval("window.__videoRange.bytes")).nextValue(),android.util.Base64.DEFAULT));assertEquals("\"16\"",eval("window.__videoRange.length"));
   click("Play video");until("!document.querySelector('video[data-alpha-captured-video]')?.paused");
   click("Back from photo");until("!document.querySelector('video[data-alpha-captured-video]')");
   navigate("Home");s.recreate();admitAccount();navigate("Photos");
   click("Albums");click("Videos");
   String savedVideoId="native-camera-v:"+ContentUris.parseId(created.iterator().next());
   String savedVideoSelector="document.querySelector('[data-owned-media-id=\""+savedVideoId+"\"]')";
   until(savedVideoSelector);eval(savedVideoSelector+".click()");click("Play video");
   until("(()=>{const v=document.querySelector('video[data-alpha-captured-video]');return v&&v.currentTime>0.2&&v.videoWidth>0})()");
   navigate("Home");until("!document.querySelector('video[data-alpha-captured-video]')");
  }finally{Set<Uri> created=owned();created.removeAll(before);for(Uri uri:created)context().getContentResolver().delete(uri,null,null);}
 }
 @Test public void leavingCameraFinalizesInsteadOfRecordingInBackground()throws Exception{
  permission();Set<Uri> before=owned();
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   admitAccount();begin();navigate("Home");until("!document.querySelector('[data-alpha-camera-screen]')");
   long end=SystemClock.elapsedRealtime()+30000;Set<Uri> created;
   do{created=owned();created.removeAll(before);if(!created.isEmpty())break;SystemClock.sleep(100);}while(SystemClock.elapsedRealtime()<end);
   assertEquals("Leaving finalizes one video",1,created.size());assertMedia(created.iterator().next());
   eval("window.__videoState=null;Capacitor.Plugins.ElizaCamera.getRecordingState().then(v=>window.__videoState=v)");
   until("window.__videoState && window.__videoState.isRecording===false");
   navigate("Camera");until("document.querySelector('[data-alpha-camera-screen]')");
   assertEquals("No recording resumes implicitly","false",eval("!!document.querySelector('button[aria-label=\"Stop recording\"]')"));
  }finally{Set<Uri> created=owned();created.removeAll(before);for(Uri uri:created)context().getContentResolver().delete(uri,null,null);}
 }
}
