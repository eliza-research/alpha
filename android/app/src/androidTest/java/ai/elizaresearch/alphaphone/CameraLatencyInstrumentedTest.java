package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import static org.junit.Assert.*;

/**
 * Camera start and shutter latency on a real device (view refresh PLAN section 1; targets measured
 * on the Pixel 10a). Not part of the default run: pass {@code -e cameraLatency 1}. With
 * {@code -e cameraLatencyAssert 1} the run also fails when a median misses its target.
 *
 * <ul>
 *   <li>First frame: from the navigation request until CameraX's PreviewView reports STREAMING,
 *       sampled on the main thread every 4 ms. The first open in the instrumentation process is
 *       the cold sample (the provider was prewarmed at plugin load); later opens from Home are warm.
 *       The patched native camera also marks the same span as the async trace section
 *       {@code alpha.camera.firstFrame}; record a Perfetto trace with the app's atrace category
 *       alongside this test to see it.</li>
 *   <li>Shutter to thumbnail: from the shutter click until the last-capture tile shows the new
 *       capture's thumbnail, both stamped in the page clock by a script this test injects; the
 *       photo must then exist in MediaStore.</li>
 * </ul>
 *
 * Results are sent as instrumentation status ({@code cameraLatency.*}) and logged under the tag
 * AlphaCameraLatency. Captures made by the test are deleted afterwards.
 */
@RunWith(AndroidJUnit4.class)
public class CameraLatencyInstrumentedTest {
 static final long COLD_FIRST_FRAME_MS = 400, WARM_FIRST_FRAME_MS = 200, SHUTTER_TO_THUMBNAIL_MS = 250;
 static final int WARM_OPENS = 5, SHOTS = 5;
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private String eval(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js,long millis)throws Exception{
  long end=SystemClock.elapsedRealtime()+millis;
  while(SystemClock.elapsedRealtime()<end){if("true".equals(eval("Boolean("+js+")")))return;SystemClock.sleep(20);}
  fail("Camera latency condition: "+js+"; view="+eval("document.documentElement.dataset.activeView"));
 }
 private static View previewView(View v){
  if(v.getClass().getName().equals("androidx.camera.view.PreviewView")&&v.getParent()!=null)return v;
  if(v instanceof ViewGroup){ViewGroup group=(ViewGroup)v;for(int i=0;i<group.getChildCount();i++){View found=previewView(group.getChildAt(i));if(found!=null)return found;}}
  return null;
 }
 /** PreviewView.getPreviewStreamState().getValue() is STREAMING once CameraX delivers frames. Read by
  * reflection: camera-view is the camera module's implementation dependency, not the app's. */
 private static boolean streaming(View preview){
  try{Object live=preview.getClass().getMethod("getPreviewStreamState").invoke(preview);Object state=live.getClass().getMethod("getValue").invoke(live);return state!=null&&"STREAMING".equals(state.toString());}
  catch(ReflectiveOperationException unavailable){throw new AssertionError("PreviewView stream state unavailable",unavailable);}
 }
 /** Sample the decor view on the main thread until a PreviewView streams; returns the uptime it was first seen. */
 private long awaitStreaming(long timeoutMs)throws Exception{
  AtomicLong seen=new AtomicLong(-1);long end=SystemClock.uptimeMillis()+timeoutMs;
  while(seen.get()<0&&SystemClock.uptimeMillis()<end){
   WebViewTestDriver.withActivity(MainActivity.class,a->{View preview=previewView(a.getWindow().getDecorView());if(preview!=null&&streaming(preview))seen.set(SystemClock.uptimeMillis());});
   if(seen.get()<0)SystemClock.sleep(4);
  }
  assertTrue("CameraX preview streamed within "+timeoutMs+" ms",seen.get()>=0);
  return seen.get();
 }
 private void awaitReleased()throws Exception{
  AtomicLong attached=new AtomicLong(1);
  for(int i=0;i<200&&attached.get()!=0;i++){WebViewTestDriver.withActivity(MainActivity.class,a->attached.set(previewView(a.getWindow().getDecorView())==null?0:1));if(attached.get()!=0)SystemClock.sleep(25);}
  assertEquals("Preview released after leaving Camera",0,attached.get());
 }
 private long openCamera()throws Exception{
  long requested=SystemClock.uptimeMillis();
  eval(AppNavigation.request("Camera"));
  long frame=awaitStreaming(5000);
  until(AppNavigation.selected("Camera"),5000);
  return frame-requested;
 }
 private Set<Long> ownedImages(){
  Set<Long> ids=new HashSet<>();
  try(Cursor c=context().getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Images.Media._ID},MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=?",new String[]{context().getPackageName()},null)){if(c!=null)while(c.moveToNext())ids.add(c.getLong(0));}
  return ids;
 }
 /** One shutter press, stamped in the page clock: the click and the tile's next thumbnail. */
 private long shutterToThumbnail()throws Exception{
  String tile="document.querySelector('button[aria-label=\"Open last photo\"] span')";
  String arm="(()=>{const shutter=document.querySelector('button[aria-label=\"Take photo\"]');if(!shutter)return 'no shutter';"
   +"const before=("+tile+")?.style.background||'';const run={t0:0,t1:0};window.__alphaShutterLatency=run;"
   +"const observer=new MutationObserver(()=>{const now=("+tile+")?.style.background||'';if(!run.t1&&now!==before&&now.includes('data:image/jpeg;base64,')){run.t1=performance.now();observer.disconnect();}});"
   +"observer.observe(document.querySelector('[data-screen]'),{subtree:true,childList:true,attributes:true,attributeFilter:['style']});"
   +"run.t0=performance.now();shutter.click();return 'armed';})()";
  assertEquals("\"armed\"",eval(arm));
  until("window.__alphaShutterLatency.t1>0",5000);
  return Math.round(Double.parseDouble(eval("window.__alphaShutterLatency.t1-window.__alphaShutterLatency.t0")));
 }
 private static long median(List<Long> values){List<Long> sorted=new ArrayList<>(values);Collections.sort(sorted);return sorted.get(sorted.size()/2);}
 private void report(String key,Object value){
  Log.i("AlphaCameraLatency",key+"="+value);
  Bundle status=new Bundle();status.putString("cameraLatency."+key,String.valueOf(value));InstrumentationRegistry.getInstrumentation().sendStatus(0,status);
 }

 @Test public void firstFrameAndShutterToThumbnail()throws Exception{
  Bundle arguments=InstrumentationRegistry.getArguments();
  Assume.assumeTrue("Device latency run: -e cameraLatency 1","1".equals(InstrumentationRegistry.getArguments().getString("cameraLatency")));
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(),Manifest.permission.CAMERA);
  Set<Long> before=ownedImages(),created=new HashSet<>();
  List<Long> warm=new ArrayList<>(),shots=new ArrayList<>();long cold;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();until("document.documentElement.dataset.activeView",30000);
   cold=openCamera();report("coldFirstFrameMs",cold);
   for(int i=0;i<WARM_OPENS;i++){
    eval(AppNavigation.request("Home"));until(AppNavigation.selected("Home"),5000);awaitReleased();
    long ms=openCamera();warm.add(ms);report("warmFirstFrameMs."+i,ms);
   }
   until("document.querySelector('button[aria-label=\"Take photo\"]')",5000);
   for(int i=0;i<SHOTS;i++){
    long ms=shutterToThumbnail();shots.add(ms);report("shutterToThumbnailMs."+i,ms);
    // The next shot starts once this one is written, so each sample measures one capture.
    long end=SystemClock.elapsedRealtime()+5000;
    while(SystemClock.elapsedRealtime()<end){Set<Long> now=ownedImages();now.removeAll(before);if(now.size()>i)break;SystemClock.sleep(20);}
   }
   created.addAll(ownedImages());created.removeAll(before);
   assertEquals("Each shutter press published one photo",SHOTS,created.size());
  }finally{
   created.addAll(ownedImages());created.removeAll(before);
   for(long id:created)context().getContentResolver().delete(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,id),null,null);
  }
  long warmMedian=median(warm),shotMedian=median(shots);
  report("warmFirstFrameMedianMs",warmMedian);report("shutterToThumbnailMedianMs",shotMedian);
  report("summary",new JSONObject().put("coldFirstFrameMs",cold).put("warmFirstFrameMs",warm.toString()).put("shutterToThumbnailMs",shots.toString())
   .put("targets",new JSONObject().put("cold",COLD_FIRST_FRAME_MS).put("warm",WARM_FIRST_FRAME_MS).put("shutter",SHUTTER_TO_THUMBNAIL_MS)).toString());
  if("1".equals(arguments.getString("cameraLatencyAssert"))){
   assertTrue("Cold first frame "+cold+" ms (target < "+COLD_FIRST_FRAME_MS+")",cold<COLD_FIRST_FRAME_MS);
   assertTrue("Warm first frame median "+warmMedian+" ms (target < "+WARM_FIRST_FRAME_MS+")",warmMedian<WARM_FIRST_FRAME_MS);
   assertTrue("Shutter to thumbnail median "+shotMedian+" ms (target < "+SHUTTER_TO_THUMBNAIL_MS+")",shotMedian<SHUTTER_TO_THUMBNAIL_MS);
  }
 }
}
