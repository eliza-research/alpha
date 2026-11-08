package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import android.Manifest;
import android.content.Context;
import android.content.ContentUris;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import android.media.MediaMetadataRetriever;
import java.util.HashSet;
import java.util.Set;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Opt-in actual UI -> native HTTP -> forwarding observer -> real local agent. */
@RunWith(AndroidJUnit4.class)
public class AllViewAgentContextInstrumentedTest {
 private Uri capturedVideo;
 private long requestIntervalMs;
 private Context target(){return InstrumentationRegistry.getInstrumentation().getTargetContext();}
 private Set<Uri> ownedVideos(){
  Set<Uri> rows=new HashSet<>();
  try(Cursor c=target().getContentResolver().query(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,new String[]{"_id"},MediaStore.MediaColumns.OWNER_PACKAGE_NAME+"=? AND is_pending=0",new String[]{target().getPackageName()},null)){
   assertNotNull("Owned video catalog available",c);while(c.moveToNext())rows.add(ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI,c.getLong(0)));
  }return rows;
 }
 private void label(String label)throws Exception{
  String button="document.querySelector('button[aria-label='+"+JSONObject.quote(JSONObject.quote(label))+"+']')";
  until(button+" && !("+button+").disabled",30000);WebViewTestDriver.evaluate("("+button+").click()");
 }
 private void captureVideo(String marker)throws Exception{
  for(String permission:new String[]{Manifest.permission.CAMERA,Manifest.permission.RECORD_AUDIO})assertEquals("Grant camera and microphone only on the disposable test device before this opt-in flow",PackageManager.PERMISSION_GRANTED,target().checkSelfPermission(permission));
  Set<Uri> before=ownedVideos();
  WebViewTestDriver.evaluate(AppNavigation.request("Camera"));until(AppNavigation.selected("Camera"),30000);
  until("document.querySelector('[data-alpha-camera-screen]')",30000);click("Video");label("Start recording");
  until("document.querySelector('button[aria-label=\"Stop recording\"]')",30000);SystemClock.sleep(2500);label("Stop recording");
  // Camera shows no status line for a saved video: wait for the finalized MediaStore row.
  Set<Uri> created=new HashSet<>();
  for(int i=0;i<300&&created.isEmpty();i++){created=ownedVideos();created.removeAll(before);if(created.isEmpty())SystemClock.sleep(100);}
  assertEquals("Exactly one finalized owned asset; ambiguous concurrent captures are never deleted",1,created.size());capturedVideo=created.iterator().next();
  String revision;
  try(Cursor c=target().getContentResolver().query(capturedVideo,new String[]{MediaStore.MediaColumns.DATE_ADDED,MediaStore.MediaColumns.SIZE},null,null,null)){
   assertNotNull(c);assertTrue(c.moveToFirst());assertTrue("Finalized video bytes",c.getLong(1)>1000);revision=c.getLong(0)+":"+c.getLong(1);
  }
  MediaMetadataRetriever metadata=new MediaMetadataRetriever();
  try{metadata.setDataSource(target(),capturedVideo);assertTrue(Long.parseLong(metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION))>=1000);android.graphics.Bitmap frame=metadata.getFrameAtTime();assertNotNull("Actual captured frame decodes",frame);frame.recycle();}finally{metadata.release();}
  String id="native-camera-v:"+ContentUris.parseId(capturedVideo);
  JSONObject expected=new JSONObject().put("marker",marker).put("kind","video").put("id",id).put("revision",revision).put("decoded",true);
  try(java.io.OutputStream output=target().openFileOutput("agent-context-video.json",Context.MODE_PRIVATE)){output.write(expected.toString().getBytes(StandardCharsets.UTF_8));}
  label("Open last video");until(AppNavigation.selected("Photos"),30000);label("Play video");
  until("(()=>{const v=document.querySelector('video[data-alpha-captured-video]');return v&&v.dataset.alphaCapturedVideo==="+JSONObject.quote(id)+"&&v.videoWidth>0&&v.currentTime>0.2})()",30000);label("Pause video");
 }
 private void until(String expression,long timeout)throws Exception{
  long end=SystemClock.elapsedRealtime()+timeout;
  while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(100);}
  fail("Context flow did not reach its expected public UI state; controls="+WebViewTestDriver.evaluate("JSON.stringify({view:document.documentElement.dataset.activeView,controls:[...document.querySelectorAll('button[aria-label]')].filter(e=>e.getClientRects().length&&['Type','Ask Alpha about this','Ask Alpha about this photo','Send','Open conversation','Switch to keyboard','Close conversation','Resize chat','Take photo','Start recording','Stop recording','Switch camera'].includes(e.getAttribute('aria-label'))).slice(0,20).map(e=>({label:e.getAttribute('aria-label'),disabled:e.disabled})),composerPresent:Boolean("+AppNavigation.composer()+"),connectionOpen:Boolean(document.querySelector('.alpha-connection-scrim'))})"));
 }
 private void click(String text)throws Exception{
  String target="[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==="+JSONObject.quote(text)+"&&e.getClientRects().length&&!e.disabled)";
  until(target,15000);WebViewTestDriver.evaluate("("+target+").click()");
 }
 private void send(String marker,int base,int index,boolean blocked)throws Exception{
  if(index>0&&requestIntervalMs>0)SystemClock.sleep(requestIntervalMs);
  // Camera shows the general assistant pill (hidden only while recording).
  if("true".equals(WebViewTestDriver.evaluate("document.documentElement.dataset.activeView==='photos'&&!!document.querySelector('button[aria-label=\"Ask Alpha about this photo\"]')"))){
   label("Ask Alpha about this photo");
  }else WebViewTestDriver.evaluate(AppNavigation.type());
  until(AppNavigation.composer(),15000);
  String prompt="Context flow fixture "+marker+" case "+index+". Do not use tools or perform actions. What is "+(base+index)+" plus 1? Reply with only the integer.";
  WebViewTestDriver.evaluate("(()=>{const e=("+AppNavigation.composer()+");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,"+JSONObject.quote(prompt)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  until("document.querySelector('button[aria-label=Send]')&&!document.querySelector('button[aria-label=Send]').disabled",15000);
  String errors="[...document.querySelectorAll('[data-screen] *')].filter(e=>e.children.length===0&&(t=>t.startsWith('The AI request rate limit was reached.')||t.startsWith('Your plan')||t.startsWith('AI needs an active Eliza Cloud plan.')||t.startsWith('Eliza Cloud declined this AI request')||t==='The agent could not complete this response.')(e.textContent.trim())).length";
  String errorsBefore=WebViewTestDriver.evaluate(errors);
  WebViewTestDriver.evaluate("document.querySelector('button[aria-label=Send]').click()");
  String expected=blocked?"Agent observation is paused on this screen.":String.valueOf(base+index+1);
  String received="[...document.querySelectorAll('[data-screen] *')].some(e=>e.children.length===0&&e.textContent.trim()==="+JSONObject.quote(expected)+")";
  until("("+received+")||("+errors+")>"+errorsBefore,120000);
  assertEquals("Provider failure displayed; stop without retry or sending the next case","true",WebViewTestDriver.evaluate("Boolean("+received+")"));
 }
 @Test public void realRepliesCarryEveryMvpViewAndDeferredAppsAreAbsent()throws Exception{
  Assume.assumeTrue("Explicit real context matrix opt-in required","true".equals(InstrumentationRegistry.getArguments().getString("agentContext")));
  assertTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  File fixture=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(),"agent-context-pairing.json");
  JSONObject config=new JSONObject(new String(Files.readAllBytes(fixture.toPath()),StandardCharsets.UTF_8));
  assertEquals("http://10.0.2.2:47842",config.getString("origin"));
  assertTrue(config.getString("marker").matches("[a-f0-9-]{36}"));
  target().deleteFile("agent-context-video.json");
  requestIntervalMs=config.optLong("requestIntervalMs",10000);assertTrue(requestIntervalMs>=0&&requestIntervalMs<=60000);
  int base=config.getInt("base");assertTrue(base>=100000&&base<900000);
  Throwable primary=null;
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.querySelector('[data-screen]')",20000);
   String previous=WebViewTestDriver.evaluate("performance.timeOrigin");
   WebViewTestDriver.evaluate("localStorage.removeItem('alpha.connection.selection.v1');location.replace(location.origin+location.pathname)");
   until("performance.timeOrigin!=="+previous+"&&document.querySelector('.alpha-connection-scrim')",20000);
   WebViewTestDriver.evaluate("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Local development agent').click()");
   WebViewTestDriver.evaluateSensitive("(()=>{const d=[...document.querySelectorAll('.alpha-connection details')].find(e=>e.querySelector('summary')?.textContent==='Local development agent');const inputs=d.querySelectorAll('input');inputs[0].value="+JSONObject.quote(config.getString("origin"))+";inputs[1].value="+JSONObject.quote(config.getString("code"))+";})()");
   click("Connect local agent");until("!document.querySelector('.alpha-connection-scrim')",60000);
   // Select a newly created empty fixture through the existing authenticated
   // history UI; do not erase prior conversations or inject persistence state.
   assertTrue(config.getString("conversationId").matches("[A-Za-z0-9][A-Za-z0-9._:-]{0,255}"));
   assertEquals("Alpha context fixture "+config.getString("marker"),config.getString("conversationTitle"));
   WebViewTestDriver.evaluate(AppNavigation.request("Settings"));until(AppNavigation.selected("Settings"),30000);until("window.__alphaTestNavigation?.status==='complete'",15000);label("Agent connection");
   until("document.querySelector('.alpha-connection-scrim')",15000);
   String history="[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Conversation history')";
   until(history,15000);WebViewTestDriver.evaluate("("+history+").click()");click("Load conversations");
   String restore="[...document.querySelectorAll('.alpha-connection-agent')].find(e=>e.querySelector('strong')?.textContent==="+JSONObject.quote(config.getString("conversationTitle"))+")?.querySelector('button')";
   until(restore+" && !("+restore+").disabled",30000);WebViewTestDriver.evaluate("("+restore+").click()");
   until("!document.querySelector('.alpha-connection-scrim')",30000);
   String[] views={"Home","Inbox","Calendar","Browser","Camera","Photos","Maps","Notes","Files","Workflows","Settings"};
   for(int i=0;i<views.length;i++){
    WebViewTestDriver.evaluate(AppNavigation.request(views[i]));until(AppNavigation.selected(views[i]),30000);
    send(config.getString("marker"),base,i,false);
   }
   WebViewTestDriver.evaluate(AppNavigation.request("Workflows"));until(AppNavigation.selected("Workflows"),30000);
   String card="[...document.querySelectorAll('button')].find(e=>e.textContent.includes("+JSONObject.quote(config.getString("workflowTitle"))+")&&e.getClientRects().length)";
   until(card,30000);WebViewTestDriver.evaluate("("+card+").click()");
   until("document.querySelector('button[aria-label=\"Run now\"]')",30000);
   // Viewing the existing inactive fixture is read-only. Never run/enable it.
   send(config.getString("marker"),base,views.length,false);
   captureVideo(config.getString("marker"));send(config.getString("marker"),base,views.length+1,false);
   WebViewTestDriver.evaluate(AppNavigation.request("Home"));until(AppNavigation.selected("Home"),30000);
   for(String deferred:new String[]{"Phone","Messages","Contacts","Wallet"}){
    assertEquals("Deferred Home control absent: "+deferred,"true",WebViewTestDriver.evaluate("![...document.querySelectorAll('[data-screen] button')].some(e=>e.getAttribute('aria-label')==="+JSONObject.quote(deferred)+")"));
   }
   SystemClock.sleep(500); // Observer also rejects any unexpected extra request.
  }catch(Exception|AssertionError failure){primary=failure;throw failure;}
  finally{
   fixture.delete();
   if(capturedVideo!=null)try{
    boolean owned=false;
    try(Cursor c=target().getContentResolver().query(capturedVideo,new String[]{MediaStore.MediaColumns.OWNER_PACKAGE_NAME},null,null,null)){owned=c!=null&&c.moveToFirst()&&target().getPackageName().equals(c.getString(0));}
    assertTrue("Cleanup requires exact captured asset still owned by this app",owned);
    assertEquals("Delete only this captured fixture",1,target().getContentResolver().delete(capturedVideo,null,null));
    File expectedFile=new File(target().getFilesDir(),"agent-context-video.json");
    if(expectedFile.isFile()){
     JSONObject expected=new JSONObject(new String(Files.readAllBytes(expectedFile.toPath()),StandardCharsets.UTF_8)).put("cleaned",true);
     try(java.io.OutputStream output=target().openFileOutput("agent-context-video.json",Context.MODE_PRIVATE)){output.write(expected.toString().getBytes(StandardCharsets.UTF_8));}
    }
   }catch(Exception|AssertionError cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
  }
 }
}
