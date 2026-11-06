package ai.elizaresearch.alphaphone;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import static org.junit.Assert.*;

/** Real CameraX preview, permission UI and MediaStore capture; no camera mocks. */
@RunWith(AndroidJUnit4.class)
public class CameraFlowInstrumentedTest {
 private Context context(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private String eval(BoundedActivityScenario<MainActivity> s,String js)throws Exception{
  return WebViewTestDriver.evaluate(js);
 }
 private void until(BoundedActivityScenario<MainActivity>s,String js)throws Exception{
  for(int i=0;i<150;i++){if("true".equals(eval(s,"Boolean("+js+")")))return;SystemClock.sleep(100);}
  fail("Camera condition: "+js+"; screen="+eval(s,"document.body.innerText.slice(-1000)"));
 }
 private void click(BoundedActivityScenario<MainActivity>s,String label)throws Exception{
  String selector="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";
  until(s,selector);eval(s,"("+selector+").click()");
 }
 /** Buttons inside review dialogs and the access panel are named by their text. */
 private void clickText(BoundedActivityScenario<MainActivity>s,String text)throws Exception{
  String selector="[...document.querySelectorAll('dialog button,[data-alpha-camera-access] button')].find(b=>b.textContent.trim()==="+JSONObject.quote(text)+"&&!b.disabled)";
  until(s,selector);eval(s,"("+selector+").click()");
 }
 /** Camera's assistant pill opens the composer; a scan request is answered on this phone. */
 private void askAlpha(BoundedActivityScenario<MainActivity>s,String text)throws Exception{
  eval(s,AppNavigation.type());until(s,AppNavigation.composer());
  eval(s,"(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(text)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  click(s,"Send");
 }
 private void closeScan(BoundedActivityScenario<MainActivity>s)throws Exception{
  String selector="[...document.querySelectorAll('dialog button')].find(b=>['Cancel scan','Close scan'].includes(b.textContent.trim()))";
  until(s,selector);eval(s,"("+selector+").click()");
 }
 private void navigate(BoundedActivityScenario<MainActivity>s,String label)throws Exception{
  until(s,"document.documentElement.dataset.activeView");eval(s,AppNavigation.request(label));until(s,AppNavigation.selected(label));
 }
 private boolean preview(View v){
  if(v.getClass().getName().equals("androidx.camera.view.PreviewView")&&v.getParent()!=null)return true;
  if(v instanceof ViewGroup){ViewGroup group=(ViewGroup)v;for(int i=0;i<group.getChildCount();i++)if(preview(group.getChildAt(i)))return true;}return false;
 }
 private void nativePreview(BoundedActivityScenario<MainActivity>s,boolean expected)throws Exception{
  AtomicBoolean seen=new AtomicBoolean();for(int i=0;i<100;i++){WebViewTestDriver.withActivity(MainActivity.class, a->seen.set(preview(a.getWindow().getDecorView())));if(seen.get()==expected)return;SystemClock.sleep(100);}assertEquals("Native PreviewView attachment",expected,seen.get());
 }
 private Set<Uri> ownedImages(){
  Set<Uri> images=new HashSet<>();
  try(Cursor c=context().getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,new String[]{MediaStore.Images.Media._ID},MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=?",new String[]{context().getPackageName()},null)){
   if(c!=null)while(c.moveToNext())images.add(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,c.getLong(0)));
  }return images;
 }
 /** Run by the camera-capture campaign (scripts/test-native-permissions.mjs camera-capture), which grants CAMERA in a fresh user. */
 @Test public void photoCapturePublishesReadableImageAndShowsRealViewer()throws Exception{
  Assume.assumeTrue("Granted-camera campaign: -e cameraCapture 1", "1".equals(InstrumentationRegistry.getArguments().getString("cameraCapture")));
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context().getPackageName(),Manifest.permission.CAMERA);
  Set<Uri> before=ownedImages(),created=new HashSet<>();
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   navigate(s,"Camera");until(s,"document.querySelector('[data-alpha-camera-screen]')");nativePreview(s,true);
   // Asking Alpha to scan in Camera reviews one unsaved frame locally; nothing reaches Photos unless kept.
   Set<Uri> beforeScan=ownedImages();
   askAlpha(s,"Scan this");
   until(s,"document.querySelector('dialog[aria-label=\"Review scanned text\"]')");
   assertEquals("Scan frame is not published to Photos",beforeScan,ownedImages());
   closeScan(s);until(s,"!document.querySelector('dialog[aria-label=\"Review scanned text\"]')");nativePreview(s,true);
   click(s,"Take photo");
   for(int i=0;i<100&&created.isEmpty();i++){created.addAll(ownedImages());created.removeAll(before);if(created.isEmpty())SystemClock.sleep(100);}
   assertEquals("Exactly one owned image published",1,created.size());
   Uri uri=created.iterator().next();byte[] bytes;
   try(java.io.InputStream input=context().getContentResolver().openInputStream(uri)){assertNotNull(input);bytes=input.readAllBytes();}
   assertTrue("JPEG has real bytes",bytes.length>1000);assertEquals(255,bytes[0]&255);assertEquals(216,bytes[1]&255);
   BitmapFactory.Options dimensions=new BitmapFactory.Options();dimensions.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,dimensions);
   assertTrue("Captured pixels decode",dimensions.outWidth>0&&dimensions.outHeight>0);
   until(s,"document.querySelector('button[aria-label=\"Open last photo\"] span')?.style.background.includes('data:image/jpeg;base64,')");
   click(s,"Open last photo");until(s,AppNavigation.selected("Photos"));
   until(s,"document.body.innerText.includes('saved to Android Photos') && [...document.querySelectorAll('[style]')].some(e=>e.style.background.includes('data:image/jpeg;base64,'))");
   ShareFlowAssertions.opensExactItemAndCancels(()->click(s,"Share photo"),bytes,"image/jpeg");
   until(s,"document.body.innerText.includes('saved to Android Photos')");
   ShareFlowAssertions.receivesInSeparateApp(()->click(s,"Share photo"),bytes);
   until(s,"document.body.innerText.includes('saved to Android Photos')");
   click(s,"Ask Alpha about this photo");
   until(s,"document.querySelector('dialog[aria-label=\"Ask about selected content\"] img[alt=\"Image for question review\"]')?.naturalWidth>0");
   eval(s,"(()=>{const e=document.querySelector('dialog[aria-label=\"Ask about selected content\"] textarea[aria-label=\"Content excerpt\"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'A captured test frame');e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   clickText(s,"Use in conversation");
   until(s,"document.querySelector('[data-alpha-layer=conversation]').getAttribute('aria-hidden') === 'false' && "+AppNavigation.composer()+"?.value.includes('Source: Selected photo')");
   assertEquals("Production suggestions do not invent a contact", "false", eval(s,"document.querySelector('[data-alpha-layer=conversation]').textContent.includes('Maya')"));
   assertEquals("Photo remains the active agent view", "\"photos\"", eval(s,"document.documentElement.dataset.activeView"));
   click(s,"Minimize chat");
   until(s,"document.querySelector('[data-alpha-layer=conversation]').getAttribute('aria-hidden') === 'true' && document.body.innerText.includes('saved to Android Photos')");
   navigate(s,"Home");s.recreate();navigate(s,"Photos");
   until(s,"document.querySelector('button[aria-label^=\"Captured photo \"]')");
   eval(s,"document.querySelector('button[aria-label^=\"Captured photo \"]').click()");
   until(s,"document.body.innerText.includes('saved to Android Photos') && [...document.querySelectorAll('[style]')].some(e=>e.style.background.includes('data:image/jpeg;base64,'))");
   nativePreview(s,false);navigate(s,"Camera");until(s,"document.querySelector('[data-alpha-camera-screen]')");nativePreview(s,true);
   navigate(s,"Home");nativePreview(s,false);until(s,"!document.querySelector('[data-alpha-camera-screen]')");
  }finally{created.addAll(ownedImages());created.removeAll(before);for(Uri uri:created)context().getContentResolver().delete(uri,null,null);}
 }
 private void permissionButton(String suffix)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){
   AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();if(root!=null)queue.add(root);
   while(!queue.isEmpty()){
    AccessibilityNodeInfo n=queue.remove();String id=n.getViewIdResourceName();
    if(n.isVisibleToUser()&&id!=null&&id.endsWith(suffix)&&n.isClickable()){assertTrue(n.performAction(AccessibilityNodeInfo.ACTION_CLICK));return;}
    for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo child=n.getChild(i);if(child!=null)queue.add(child);}
   }SystemClock.sleep(100);
  }fail("Real Android permission button not found: "+suffix);
 }
 private String shell(String command)throws Exception{try(java.io.InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))){return new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}}
 private String resumed()throws Exception{return shell("dumpsys activity activities").lines().filter(line->line.contains("topResumedActivity")||line.contains("mResumedActivity")).findFirst().orElse("");}
 /** "Don't ask again": Android returns denial without a dialog. The panel opens the
  * real application details page; a grant there restarts the preview on return. */
 @Test public void cameraDeniedForeverRecoversThroughAndroidSettings()throws Exception{
  Assume.assumeTrue("Separate revoked-permission fixture: -e cameraPermissionTest true", "true".equals(InstrumentationRegistry.getArguments().getString("cameraPermissionTest")));
  String pkg=context().getPackageName();
  InstrumentationRegistry.getInstrumentation().getUiAutomation().revokeRuntimePermission(pkg,Manifest.permission.CAMERA);
  shell("pm set-permission-flags "+pkg+" "+Manifest.permission.CAMERA+" user-set user-fixed");
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   navigate(s,"Camera");
   until(s,"document.querySelector('[role=alert][aria-label=\"Camera access is off\"]')?.textContent.includes('Open settings')");nativePreview(s,false);
   clickText(s,"Open settings");
   long end=SystemClock.elapsedRealtime()+15000;while(SystemClock.elapsedRealtime()<end&&!resumed().contains("settings"))SystemClock.sleep(100);
   assertTrue("Application details settings is foreground: "+resumed(),resumed().contains("settings"));
   shell("pm clear-permission-flags "+pkg+" "+Manifest.permission.CAMERA+" user-set user-fixed");
   InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(pkg,Manifest.permission.CAMERA);
   WebViewTestDriver.pressBack();
   until(s,"document.querySelector('[data-alpha-camera-screen]') && !document.querySelector('[data-alpha-camera-access]')");nativePreview(s,true);
   navigate(s,"Home");nativePreview(s,false);
  }finally{shell("pm clear-permission-flags "+pkg+" "+Manifest.permission.CAMERA+" user-set user-fixed");}
 }
 @Test public void denyingCameraAllowsExplicitRetryWithoutFakePreview()throws Exception{
  Assume.assumeTrue("Separate revoked-permission fixture: -e cameraPermissionTest true", "true".equals(InstrumentationRegistry.getArguments().getString("cameraPermissionTest")));
  assertEquals("Revoke CAMERA before this instrumentation run",PackageManager.PERMISSION_DENIED,context().checkSelfPermission(Manifest.permission.CAMERA));
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   navigate(s,"Camera");permissionButton(":id/permission_deny_button");
   until(s,"document.querySelector('[role=alert][aria-label=\"Camera access is off\"]')");nativePreview(s,false);
   // Closing Android's dialog resumes the app. A denial must not be answered with a second dialog:
   // Alpha stays in front, still denied, until the owner retries.
   long quiet=SystemClock.elapsedRealtime()+4000;
   while(SystemClock.elapsedRealtime()<quiet){assertTrue("No permission dialog reopens after Don't allow: "+resumed(),resumed().contains(context().getPackageName()+"/")&&!resumed().contains("permissioncontroller"));SystemClock.sleep(250);}
   assertEquals(PackageManager.PERMISSION_DENIED,context().checkSelfPermission(Manifest.permission.CAMERA));
   until(s,"document.querySelector('[role=alert][aria-label=\"Camera access is off\"]')");
   click(s,"Take photo");permissionButton(":id/permission_allow_foreground_only_button");
   until(s,"document.querySelector('[data-alpha-camera-screen]')");nativePreview(s,true);
   assertEquals(PackageManager.PERMISSION_GRANTED,context().checkSelfPermission(Manifest.permission.CAMERA));
   navigate(s,"Home");nativePreview(s,false);
  }
 }
}
