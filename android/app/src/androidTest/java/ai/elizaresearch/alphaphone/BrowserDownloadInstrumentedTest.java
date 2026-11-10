package ai.elizaresearch.alphaphone;

import android.app.DownloadManager;
import android.database.Cursor;
import android.os.SystemClock;
import android.view.accessibility.AccessibilityNodeInfo;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual WebView attachment -> explicit native review -> DownloadProvider bytes.
 * Cleartext exists only on the existing debug loopback exception. */
@RunWith(AndroidJUnit4.class)
public final class BrowserDownloadInstrumentedTest {
 private final BrowserFlowInstrumentedTest browser=new BrowserFlowInstrumentedTest();
 private String host(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void ready(String predicate)throws Exception{for(int i=0;i<200;i++){if("true".equals(host("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Download browser control missing");}
 private void clickHost(String label)throws Exception{String expression="[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";ready(expression);host("("+expression+").click()");}
 private void address(String url)throws Exception{
  if("false".equals(host("!!document.querySelector('input[aria-label=Address]')")))clickHost("Edit address");
  ready("document.querySelector('input[aria-label=Address]')");
  host("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(url)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  ready("document.querySelector('input[aria-label=Address]').value==="+JSONObject.quote(url));
  host("document.querySelector('input[aria-label=Address]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void page()throws Exception{for(int i=0;i<200;i++){if("true".equals(browser.child("document.title==='Download fixture' && document.readyState==='complete' && typeof Capacitor==='undefined'")))return;SystemClock.sleep(100);}fail("Actual isolated download fixture did not load; "+browser.diagnostics());}
 private AccessibilityNodeInfo nativeNode(String text,boolean exact){
  // Android themes can expose transformed uppercase dialog button text. Search
  // a freshly obtained bounded tree, not the provider's case-sensitive index.
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root==null)return null;
  String expected=text.trim().toLowerCase(Locale.ROOT);ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);int visited=0;
  while(!queue.isEmpty()&&visited++<512){AccessibilityNodeInfo node=queue.remove();
   String actual=node.getText()==null?"":node.getText().toString().trim().toLowerCase(Locale.ROOT);
   if(node.isVisibleToUser()&&(exact?expected.equals(actual):actual.contains(expected)))return node;
   for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}
  }return null;
 }
 private String safeButtonDiagnostic(){
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root==null)return "no active accessibility root";
  StringBuilder result=new StringBuilder();ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);int visited=0;
  while(!queue.isEmpty()&&visited++<512){AccessibilityNodeInfo node=queue.remove();
   String label=node.getText()==null?"":node.getText().toString().trim();
   // Never dump arbitrary document/UI text. Only these static dialog controls
   // and their boolean accessibility state may appear in failure diagnostics.
   if(Arrays.asList("cancel","download","close","cancel download","remove entry").contains(label.toLowerCase(Locale.ROOT)))
    result.append('[').append(label).append(" visible=").append(node.isVisibleToUser()).append(" enabled=").append(node.isEnabled()).append(" clickable=").append(node.isClickable()).append(']');
   for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}
  }return result.length()==0?"no recognized dialog controls":result.toString();
 }
 private void nativeVisible(String text)throws Exception{for(int i=0;i<150;i++){if(nativeNode(text,false)!=null)return;SystemClock.sleep(100);}fail("Missing native download state: "+text);}
 private void nativeClick(String text)throws Exception{
  for(int i=0;i<150;i++){AccessibilityNodeInfo node=nativeNode(text,true);if(node!=null){while(node!=null&&!node.isClickable())node=node.getParent();if(node!=null&&node.refresh()&&node.isVisibleToUser()&&node.isEnabled()&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;}SystemClock.sleep(100);}fail("Native download control not clickable: "+text+"; "+safeButtonDiagnostic());
 }
 private void nativeClickDescription(String description)throws Exception{
  for(int i=0;i<150;i++){
   AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   if(root!=null){ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);while(!queue.isEmpty()){
    AccessibilityNodeInfo node=queue.remove();if(node.isVisibleToUser()&&description.contentEquals(node.getContentDescription()==null?"":node.getContentDescription())&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;
    for(int j=0;j<node.getChildCount();j++){AccessibilityNodeInfo child=node.getChild(j);if(child!=null)queue.add(child);}
   }}SystemClock.sleep(100);
  }fail("Missing fixture-owned native download control");
 }
 // Only capability booleans: never include network identifiers, addresses or exception text.
 private String networkState(android.content.Context context){
  try{
   android.net.ConnectivityManager connectivity=context.getSystemService(android.net.ConnectivityManager.class);
   if(connectivity==null)return "service-unavailable";
   android.net.Network active=connectivity.getActiveNetwork();
   android.net.NetworkCapabilities capabilities=active==null?null:connectivity.getNetworkCapabilities(active);
   return "active="+(active!=null)+",capabilitiesAvailable="+(capabilities!=null)+
    ",internet="+(capabilities!=null&&capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET))+
    ",validated="+(capabilities!=null&&capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED));
  }catch(SecurityException unavailable){return "permission-unavailable";}
   catch(RuntimeException unavailable){return "query-unavailable";}
 }
 private long find(DownloadManager manager,String name){
  try(Cursor cursor=manager.query(new DownloadManager.Query())){while(cursor!=null&&cursor.moveToNext())if(name.equals(cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE))))return cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));}return -1;
 }
 private long row(DownloadManager manager,String name)throws Exception{for(int i=0;i<150;i++){long id=find(manager,name);if(id>0)return id;SystemClock.sleep(100);}throw new AssertionError("Confirmed download has no actual provider row");}
 private void link(String id)throws Exception{page();assertEquals("true",browser.child("(()=>{document.querySelector('#"+id+"').click();return true})()"));nativeVisible("Download file?");}
 @Test public void explicitReviewExactBytesDenialAndCancellation()throws Exception{
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  String token=UUID.randomUUID().toString(),filename="alpha-download-"+token+".txt",slowname="alpha-slow-"+token+".bin",errorname="alpha-error-"+token+".txt";
  byte[] expected=("Synthetic browser download "+token+"\nExact bytes verified.\n").getBytes(StandardCharsets.UTF_8);
  ServerSocket server=new ServerSocket(0,16,InetAddress.getByName("127.0.0.1"));ExecutorService workers=Executors.newCachedThreadPool();CountDownLatch releaseSlow=new CountDownLatch(1);java.util.concurrent.atomic.AtomicInteger errorRequests=new java.util.concurrent.atomic.AtomicInteger(),fileRequests=new java.util.concurrent.atomic.AtomicInteger(),slowRequests=new java.util.concurrent.atomic.AtomicInteger();
  workers.submit(()->{while(!server.isClosed())try{Socket socket=server.accept();workers.submit(()->{try(socket){
   socket.setSoTimeout(10000);BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.US_ASCII));String request=reader.readLine(),line;while((line=reader.readLine())!=null&&!line.isEmpty()){}
   boolean file=request!=null&&request.startsWith("GET /file"),slow=request!=null&&request.startsWith("GET /slow"),error=request!=null&&request.startsWith("GET /error");
   // Count only this fixture's synthetic paths, without recording request/header content.
   if(file)fileRequests.incrementAndGet();if(slow)slowRequests.incrementAndGet();
   OutputStream output=socket.getOutputStream();
   if(error&&errorRequests.incrementAndGet()>1){output.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".getBytes(StandardCharsets.US_ASCII));output.flush();return;}
   if(file||slow||error){byte[] body=slow?new byte[128*1024]:expected;
    output.write(("HTTP/1.1 200 OK\r\nContent-Type: "+(slow?"application/octet-stream":"text/plain")+"\r\nContent-Disposition: attachment; filename=\""+(slow?slowname:error?errorname:filename)+"\"\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));output.flush();
    if(slow){output.write(body,0,1024);output.flush();if(!releaseSlow.await(45,TimeUnit.SECONDS))return;output.write(body,1024,body.length-1024);}else output.write(body);
   }else{byte[] body="<!doctype html><title>Download fixture</title><a id='file' href='/file'>Download synthetic text</a><br><a id='slow' href='/slow'>Download cancellable file</a><br><a id='error' href='/error'>Download unavailable file</a>".getBytes(StandardCharsets.UTF_8);output.write(("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));output.write(body);}output.flush();
  }catch(Exception cancelled){}});}catch(IOException closed){break;}});
  android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();DownloadManager manager=context.getSystemService(DownloadManager.class);List<Long> cleanup=new ArrayList<>();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();host(AppNavigation.request("Browser"));ready(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();String url="http://127.0.0.1:"+server.getLocalPort()+"/";address(url);page();
   link("file");nativeVisible("127.0.0.1");nativeVisible(filename);nativeVisible("Advertised size: "+expected.length+" bytes");
   assertEquals("No DownloadManager side effect before consent",-1,find(manager,filename));nativeClick("Cancel");assertEquals("Denied review queues nothing",-1,find(manager,filename));
   address(url);link("file");
   // The WebView already requested the attachment to display its review. Capture that
   // baseline so a later request can distinguish actual DownloadManager activity.
   int fileRequestsBeforeEnqueue=fileRequests.get();String networkBeforeEnqueue=networkState(context);
   nativeClick("Download");long id=row(manager,filename);cleanup.add(id);
   boolean complete=false;int downloadStatus=-1,downloadReason=-1;long received=-1;for(int i=0;i<300;i++){try(Cursor cursor=manager.query(new DownloadManager.Query().setFilterById(id))){if(cursor.moveToFirst()){downloadStatus=cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));downloadReason=cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));received=cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));if(downloadStatus==DownloadManager.STATUS_SUCCESSFUL){complete=true;break;}if(downloadStatus==DownloadManager.STATUS_FAILED)break;}}SystemClock.sleep(100);}assertTrue("Actual DownloadProvider completes; status="+downloadStatus+" reason="+downloadReason+" received="+received+
    "; networkBefore={"+networkBeforeEnqueue+"}; networkAfter={"+networkState(context)+"}"+
    "; fixtureRequests={fileBeforeEnqueue="+fileRequestsBeforeEnqueue+",file="+fileRequests.get()+",slow="+slowRequests.get()+",error="+errorRequests.get()+"}",complete);
   try(android.os.ParcelFileDescriptor descriptor=manager.openDownloadedFile(id);InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
    byte[] buffer=new byte[1024];int count;while((count=input.read(buffer))!=-1){assertTrue("Bounded fixture bytes",bytes.size()+count<4096);bytes.write(buffer,0,count);}assertArrayEquals("Exact downloaded file bytes",expected,bytes.toByteArray());
   }
   nativeVisible("Complete · "+expected.length+" bytes");nativeClick("Close");
   // Reopen through the product menu, with status read from the native provider.
   clickHost("Menu");clickHost("Downloads");nativeVisible(filename);nativeVisible("Complete · "+expected.length+" bytes");nativeClick("Close");
   address(url);link("slow");nativeClick("Download");long slowId=row(manager,slowname);cleanup.add(slowId);nativeVisible(slowname);nativeClickDescription("Cancel download "+slowname);
   boolean removed=false;for(int i=0;i<100;i++){try(Cursor cursor=manager.query(new DownloadManager.Query().setFilterById(slowId))){if(!cursor.moveToFirst()){removed=true;break;}}SystemClock.sleep(100);}assertTrue("Cancellation removes native transfer",removed);nativeClick("Close");
   address(url);link("error");nativeClick("Download");long errorId=row(manager,errorname);cleanup.add(errorId);
   boolean failed=false;for(int i=0;i<300;i++){try(Cursor cursor=manager.query(new DownloadManager.Query().setFilterById(errorId))){if(cursor.moveToFirst()&&cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))==DownloadManager.STATUS_FAILED){failed=true;break;}}SystemClock.sleep(100);}assertTrue("Native HTTP failure is not reported complete",failed);nativeVisible("Failed · Android reason");nativeClick("Close");
   address(url);page();assertEquals("Child download page retains no app bridge","true",browser.child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));
  }finally{
   releaseSlow.countDown();server.close();workers.shutdownNow();for(long id:cleanup)manager.remove(id);for(String name:new String[]{filename,slowname,errorname}){long id=find(manager,name);if(id>0)manager.remove(id);}
   // Clean only fixture-owned history entries, preserving all unrelated downloads.
   android.content.SharedPreferences preferences=context.getSharedPreferences("alpha-browser-downloads",android.content.Context.MODE_PRIVATE);org.json.JSONArray kept=new org.json.JSONArray(),all=new org.json.JSONArray(preferences.getString("owned","[]"));
   for(int i=0;i<all.length();i++){JSONObject item=all.getJSONObject(i);if(!filename.equals(item.optString("name"))&&!slowname.equals(item.optString("name"))&&!errorname.equals(item.optString("name")))kept.put(item);}preferences.edit().putString("owned",kept.toString()).commit();
  }
 }
}
