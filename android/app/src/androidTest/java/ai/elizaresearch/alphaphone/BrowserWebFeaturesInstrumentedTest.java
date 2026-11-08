package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.browsersurface.BrowserSessionStore;

import ai.eliza.plugins.browsersurface.BrowserDownloadPolicy;
import android.content.Context;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real isolated child WebViews against a loopback fixture (cleartext exists only
 * in -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug builds): private-tab downloads stay out
 * of the persisted list, the sign-in cookie reaches only the same origin (also
 * when the app-fetched download is redirected to another origin),
 * page-created blob:/data: files are saved after review, HTTP authentication
 * uses a native prompt, site permissions are origin-labelled and stored only for
 * normal tabs, find-in-page and fullscreen with Back. All values are synthetic. */
@RunWith(AndroidJUnit4.class)
public final class BrowserWebFeaturesInstrumentedTest {
 private final BrowserFlowInstrumentedTest browser=new BrowserFlowInstrumentedTest();
 private final String token=UUID.randomUUID().toString().replace("-","");
 private final String authUser="alpha-fixture-user",authSecret="alpha-fixture-"+token;
 private final List<String> cookieRequests=Collections.synchronizedList(new ArrayList<>());
 private final java.util.concurrent.atomic.AtomicInteger hopRequests=new java.util.concurrent.atomic.AtomicInteger();
 private ServerSocket server,other;
 private ExecutorService workers;
 private String base;
 private final List<android.net.Uri> savedFiles=new ArrayList<>();

 private String host(String script)throws Exception{return WebViewTestDriver.evaluate(script);}
 private void ready(String predicate)throws Exception{for(int i=0;i<200;i++){if("true".equals(host("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Browser control/state missing: "+predicate.substring(0,Math.min(160,predicate.length())));}
 private String button(String label){return "[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";}
 private void click(String label)throws Exception{ready(button(label));host("("+button(label)+").click()");}
 private void app(String label)throws Exception{host(AppNavigation.request(label));ready(AppNavigation.selected(label));}
 private void address(String value)throws Exception{
  if("false".equals(host("!!document.querySelector('input[aria-label=Address]')")))click("Edit address");
  ready("document.querySelector('input[aria-label=Address]')");
  host("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  ready("document.querySelector('input[aria-label=Address]').value==="+JSONObject.quote(value));
  host("document.querySelector('input[aria-label=Address]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void page(String title)throws Exception{for(int i=0;i<200;i++){if("true".equals(browser.child("document.title==="+JSONObject.quote(title)+" && document.readyState==='complete' && typeof Capacitor==='undefined'")))return;SystemClock.sleep(100);}fail("Fixture page did not load: "+title+"; "+browser.diagnostics());}
 private void childUntil(String predicate)throws Exception{for(int i=0;i<200;i++){if("true".equals(browser.child("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Child page state missing: "+predicate);}

 // ---- Native (non-renderer) dialogs through accessibility --------------------------
 private AccessibilityNodeInfo nativeNode(String text,boolean exact){
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root==null)return null;
  String expected=text.trim().toLowerCase(Locale.ROOT);ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);int visited=0;
  while(!queue.isEmpty()&&visited++<512){AccessibilityNodeInfo node=queue.remove();
   String actual=node.getText()==null?"":node.getText().toString().trim().toLowerCase(Locale.ROOT);
   if(node.isVisibleToUser()&&(exact?expected.equals(actual):actual.contains(expected)))return node;
   for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}
  }return null;
 }
 private AccessibilityNodeInfo hinted(String hint){
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root==null)return null;
  ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);int visited=0;
  while(!queue.isEmpty()&&visited++<512){AccessibilityNodeInfo node=queue.remove();
   if(node.isVisibleToUser()&&node.isEditable()&&node.getHintText()!=null&&hint.contentEquals(node.getHintText()))return node;
   for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}
  }return null;
 }
 private void nativeVisible(String text)throws Exception{for(int i=0;i<150;i++){if(nativeNode(text,false)!=null)return;SystemClock.sleep(100);}fail("Missing native state: "+text);}
 private void nativeAbsent(String text)throws Exception{SystemClock.sleep(1500);assertNull("Unexpected native prompt: "+text,nativeNode(text,false));}
 private void nativeClick(String text)throws Exception{
  for(int i=0;i<150;i++){AccessibilityNodeInfo node=nativeNode(text,true);if(node!=null){while(node!=null&&!node.isClickable())node=node.getParent();if(node!=null&&node.refresh()&&node.isVisibleToUser()&&node.isEnabled()&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;}SystemClock.sleep(100);}fail("Native control not clickable: "+text);
 }
 private void nativeType(String hint,String value)throws Exception{
  for(int i=0;i<150;i++){AccessibilityNodeInfo node=hinted(hint);if(node!=null){Bundle args=new Bundle();args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,value);if(node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT,args))return;}SystemClock.sleep(100);}fail("Native field missing: "+hint);
 }

 // ---- Plugin state through reflection (native witness, not renderer state) --------
 private Object plugin(MainActivity activity){return activity.getBridge().getPlugin("AlphaBrowser").getInstance();}
 /** A declared field of owner's class or a superclass (the shared BrowserTabHostPlugin holds the host state). */
 private Object field(Object owner,String name)throws Exception{for(Class<?> type=owner.getClass();type!=null;type=type.getSuperclass())try{java.lang.reflect.Field field=type.getDeclaredField(name);field.setAccessible(true);return field.get(owner);}catch(NoSuchFieldException next){/* superclass */}throw new NoSuchFieldException(name);}
 /** The shared download list (BrowserDownloadPolicy.History), as the persisted record keys plus the in-memory private and transfer state. */
 private List<JSONObject> downloadEntries()throws Exception{
  List<JSONObject> result=new ArrayList<>();AtomicReference<Exception> error=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,activity->{try{Object downloads=field(plugin(activity),"downloads");
   for(BrowserDownloadPolicy.Entry entry:((BrowserDownloadPolicy.History)field(downloads,"history")).all()){
    JSONObject item=new JSONObject().put("id",entry.id).put("name",entry.name).put("origin",entry.origin);
    if(entry.ephemeral)item.put("private",true).put("tab",entry.tab);if(entry.uri!=null)item.put("uri",entry.uri);if(entry.running)item.put("running",true);if(entry.failed)item.put("failed",true);
    result.add(item);
   }}catch(Exception failure){error.set(failure);}});
  if(error.get()!=null)throw error.get();return result;
 }
 private String pluginString(String name)throws Exception{AtomicReference<String> value=new AtomicReference<>();WebViewTestDriver.withActivity(MainActivity.class,activity->{try{value.set((String)field(plugin(activity),name));}catch(Exception failure){throw new AssertionError(failure);}});return value.get();}
 private boolean fullscreenActive()throws Exception{AtomicBoolean active=new AtomicBoolean();WebViewTestDriver.withActivity(MainActivity.class,activity->{try{active.set(field(plugin(activity),"customView")!=null);}catch(Exception failure){throw new AssertionError(failure);}});return active.get();}
 private String persistedDownloads(){return InstrumentationRegistry.getInstrumentation().getTargetContext().getSharedPreferences("alpha-browser-downloads",Context.MODE_PRIVATE).getString("owned","[]");}

 private void collect(View view,List<WebView> result,WebView hostView){if(view instanceof WebView&&view!=hostView)result.add((WebView)view);if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)collect(group.getChildAt(i),result,hostView);}}
 /** A real touch on an element of the visible child page: a user gesture. */
 private void tap(String selector)throws Exception{
  JSONArray bounds=new JSONArray(browser.child("(()=>{const r=document.querySelector("+JSONObject.quote(selector)+").getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,innerWidth]})()"));
  float[] point=new float[2];AtomicBoolean found=new AtomicBoolean();
  WebViewTestDriver.withActivity(MainActivity.class,main->{List<WebView> children=new ArrayList<>();collect(main.getWindow().getDecorView(),children,main.getBridge().getWebView());for(WebView web:children)if(web.isShown()){
   int[] location=new int[2];web.getLocationOnScreen(location);float scale=(float)(web.getWidth()/bounds.optDouble(2));point[0]=location[0]+(float)bounds.optDouble(0)*scale;point[1]=location[1]+(float)bounds.optDouble(1)*scale;found.set(true);break;
  }});assertTrue("Visible native browser page",found.get());long now=SystemClock.uptimeMillis();
  for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent event=MotionEvent.obtain(now,SystemClock.uptimeMillis(),action,point[0],point[1],0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);InstrumentationRegistry.getInstrumentation().sendPointerSync(event);event.recycle();}
 }

 // ---- Loopback fixture -------------------------------------------------------------
 private void respond(OutputStream output,String status,String type,byte[] body,String extra)throws IOException{
  output.write(("HTTP/1.1 "+status+"\r\nContent-Type: "+type+"\r\nContent-Length: "+body.length+"\r\n"+extra+"Connection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));output.write(body);output.flush();
 }
 private String fixturePage(){
  String data="data:text/plain;base64,"+android.util.Base64.encodeToString(("data bytes "+token).getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP);
  return "<!doctype html><meta name=viewport content='width=device-width'><title>Web features fixture</title>"
   +"<a id=same href='/file'>Same-origin file</a><br><a id=hop href='/hop'>Redirected file</a><br><a id=cross href='http://127.0.0.1:"+other.getLocalPort()+"/file'>Other-origin file</a><br>"
   +"<a id=data download='data-"+token+".txt' href='"+data+"'>Data file</a><br><a id=blob>Blob file</a><br>"
   +"<p>needle one</p><p>needle two</p><p>needle three</p>"
   +"<div id=fs style='width:200px;height:80px;background:#246'><button id=full style='font-size:28px;padding:16px'>Fullscreen</button></div>"
   +"<script>const b=new Blob(['blob bytes "+token+"'],{type:'text/plain'});const a=document.getElementById('blob');a.href=URL.createObjectURL(b);a.download='blob-"+token+".txt';"
   +"document.getElementById('full').onclick=()=>document.getElementById('fs').requestFullscreen();</script>";
 }
 @Before public void start()throws Exception{
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  server=new ServerSocket(0,16,InetAddress.getByName("127.0.0.1"));workers=Executors.newCachedThreadPool();base="http://127.0.0.1:"+server.getLocalPort()+"/";
  // Same host, different port: a different origin, although browsers send host cookies to every port.
  other=new ServerSocket(0,16,InetAddress.getByName("127.0.0.1"));
  String expectedAuth="Basic "+android.util.Base64.encodeToString((authUser+":"+authSecret).getBytes(StandardCharsets.UTF_8),android.util.Base64.NO_WRAP);
  for(ServerSocket listening:new ServerSocket[]{server,other})workers.submit(()->{while(!listening.isClosed())try{Socket socket=listening.accept();String tag=listening==server?"page":"other";workers.submit(()->{try(socket){
   socket.setSoTimeout(10000);BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.US_ASCII));String request=reader.readLine(),line,cookie="",auth="";
   while((line=reader.readLine())!=null&&!line.isEmpty()){String lower=line.toLowerCase(Locale.ROOT);if(lower.startsWith("cookie:"))cookie=line.substring(7).trim();if(lower.startsWith("authorization:"))auth=line.substring(14).trim();}
   OutputStream output=socket.getOutputStream();
   if(request!=null&&request.startsWith("GET /hop")&&listening==server){
    // The WebView's own request gets the file; the app's later fetch is redirected to the other origin.
    cookieRequests.add("hop="+cookie.contains("alpha_dl="+token));
    if(hopRequests.incrementAndGet()==1)respond(output,"200 OK","text/plain",("file bytes "+token).getBytes(StandardCharsets.UTF_8),"Content-Disposition: attachment; filename=\"alpha-"+token+".txt\"\r\n");
    else respond(output,"302 Found","text/plain",new byte[0],"Location: http://127.0.0.1:"+other.getLocalPort()+"/file\r\n");
   }else if(request!=null&&request.startsWith("GET /file")){
    // Record only whether this fixture's own synthetic cookie arrived, per listening origin.
    cookieRequests.add(tag+"="+cookie.contains("alpha_dl="+token));
    respond(output,"200 OK","text/plain",("file bytes "+token).getBytes(StandardCharsets.UTF_8),"Content-Disposition: attachment; filename=\"alpha-"+token+".txt\"\r\n");
   }else if(request!=null&&request.startsWith("GET /auth")){
    if(expectedAuth.equals(auth))respond(output,"200 OK","text/html",("<!doctype html><title>Auth fixture ok</title>Signed in").getBytes(StandardCharsets.UTF_8),"");
    else respond(output,"401 Unauthorized","text/html","<!doctype html><title>Auth required</title>".getBytes(StandardCharsets.UTF_8),"WWW-Authenticate: Basic realm=\"Alpha fixture\"\r\n");
   }else respond(output,"200 OK","text/html",fixturePage().getBytes(StandardCharsets.UTF_8),"");
  }catch(Exception cancelled){}});}catch(IOException closed){break;}});
 }
 @After public void stop()throws Exception{
  if(server!=null)server.close();if(other!=null)other.close();if(workers!=null)workers.shutdownNow();
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  for(android.net.Uri uri:savedFiles)try{context.getContentResolver().delete(uri,null,null);}catch(Exception ignored){}
  android.app.DownloadManager manager=context.getSystemService(android.app.DownloadManager.class);
  try(android.database.Cursor cursor=manager.query(new android.app.DownloadManager.Query())){while(cursor!=null&&cursor.moveToNext())if(("alpha-"+token+".txt").equals(cursor.getString(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_TITLE))))manager.remove(cursor.getLong(cursor.getColumnIndexOrThrow(android.app.DownloadManager.COLUMN_ID)));}catch(Exception ignored){}
  // Remove only fixture-owned download history and permission decisions.
  android.content.SharedPreferences preferences=context.getSharedPreferences("alpha-browser-downloads",Context.MODE_PRIVATE);JSONArray kept=new JSONArray(),all=new JSONArray(preferences.getString("owned","[]"));
  for(int i=0;i<all.length();i++){JSONObject item=all.getJSONObject(i);if(!item.toString().contains(token)&&!item.optString("origin").contains(":"+(server==null?"":String.valueOf(server.getLocalPort()))))kept.put(item);}preferences.edit().putString("owned",kept.toString()).commit();
  if(server!=null)AlphaBrowserStores.session(context).clearPermissionsForSite("127.0.0.1");
 }
 private void openFixture()throws Exception{address(base);page("Web features fixture");}
 private byte[] read(android.net.Uri uri)throws Exception{
  try(InputStream input=InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver().openInputStream(uri);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] buffer=new byte[1024];int count;while((count=input.read(buffer))!=-1){assertTrue("Bounded fixture bytes",bytes.size()+count<4096);bytes.write(buffer,0,count);}return bytes.toByteArray();}
 }
 private android.net.Uri savedCapture(int before)throws Exception{
  for(int i=0;i<150;i++){List<JSONObject> entries=downloadEntries();for(JSONObject entry:entries)if(entry.getLong("id")<0&&entry.has("uri")){android.net.Uri uri=android.net.Uri.parse(entry.getString("uri"));if(!savedFiles.contains(uri)&&entries.size()>before){savedFiles.add(uri);return uri;}}SystemClock.sleep(100);}
  throw new AssertionError("Captured file was not saved to Downloads");
 }

 @Test public void privateDownloadsStayOutOfPersistedHistoryAndCookiesStaySameOrigin()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");openFixture();
   browser.child("document.cookie='alpha_dl="+token+"; Path=/; Max-Age=600';true");
   // Same-origin download from a normal tab carries the tab's own sign-in cookie.
   browser.child("document.querySelector('#same').click();true");nativeVisible("Download file?");nativeVisible("Your sign-in for this site is used");
   // The WebView's own request already happened; only the app's fetch is counted from here.
   int before=downloadEntries().size();
   cookieRequests.clear();nativeClick("Download");for(int i=0;i<150&&!cookieRequests.contains("page=true");i++)SystemClock.sleep(100);
   assertTrue("Same-origin download received the tab's cookie: "+cookieRequests,cookieRequests.contains("page=true"));
   assertArrayEquals("Signed-in download saved exactly",("file bytes "+token).getBytes(StandardCharsets.UTF_8),read(savedCapture(before)));nativeClick("Close");
   assertFalse("The cookie is never written to the persisted download list",persistedDownloads().contains("alpha_dl"));
   // A signed-in download redirected to another origin: the cookie goes to the page origin only.
   openFixture();browser.child("document.querySelector('#hop').click();true");nativeVisible("Download file?");nativeVisible("Your sign-in for this site is used");
   before=downloadEntries().size();cookieRequests.clear();nativeClick("Download");
   for(int i=0;i<150&&cookieRequests.stream().noneMatch(r->r.startsWith("other="));i++)SystemClock.sleep(100);
   assertTrue("The app's fetch of the page-origin URL carried the cookie: "+cookieRequests,cookieRequests.contains("hop=true"));
   assertTrue("The redirect target was requested: "+cookieRequests,cookieRequests.contains("other=false"));
   assertFalse("The redirect target never received the cookie: "+cookieRequests,cookieRequests.contains("other=true"));
   assertArrayEquals("Redirected download saved exactly",("file bytes "+token).getBytes(StandardCharsets.UTF_8),read(savedCapture(before)));nativeClick("Close");
   // A different origin (another port on the same host) never receives it from Alpha.
   openFixture();browser.child("document.querySelector('#cross').click();true");nativeVisible("Download file?");nativeVisible("Website sign-in is not shared");
   cookieRequests.clear();nativeClick("Download");for(int i=0;i<150&&cookieRequests.stream().noneMatch(r->r.startsWith("other="));i++)SystemClock.sleep(100);
   assertFalse("Other-origin download did not receive the cookie: "+cookieRequests,cookieRequests.contains("other=true"));assertTrue(cookieRequests.contains("other=false"));nativeClick("Close");
   int normalEntries=new JSONArray(persistedDownloads()).length();
   // Private tab: reviewed, saved, shown in the list, never persisted.
   click("Menu");click("New private tab");openFixture();ready("document.querySelector('[aria-label=\"Private tab\"]')");
   assertEquals("Private tab has no normal cookie","false",browser.child("document.cookie.includes('alpha_dl=')"));
   browser.child("document.querySelector('#same').click();true");nativeVisible("Download file?");nativeVisible("Private tab: the file stays in Downloads");
   nativeClick("Download");nativeVisible("Private tab");
   assertTrue("Private entry visible in memory",downloadEntries().stream().anyMatch(entry->entry.optBoolean("private")));
   String persisted=persistedDownloads();
   assertEquals("No private entry was persisted",normalEntries,new JSONArray(persisted).length());
   assertFalse("SharedPreferences hold no private-origin entry",persisted.contains("\"private\""));nativeClick("Close");
   // Closing the private tab forgets its in-memory entries; the file stays with Android.
   click("Tabs");click("Close private tab");
   for(int i=0;i<50&&downloadEntries().stream().anyMatch(entry->entry.optBoolean("private"));i++)SystemClock.sleep(100);
   assertFalse("Private entries forgotten on tab close",downloadEntries().stream().anyMatch(entry->entry.optBoolean("private")));
   // Clear browsing data clears the download list.
   click("Menu");click("Clear browsing data");ready("document.querySelector('dialog.alpha-operation-review')");
   host("[...document.querySelectorAll('dialog.alpha-operation-review button')].find(b=>b.textContent==='Clear data').click()");ready("document.body.innerText.includes('Browsing data cleared')");
   assertEquals("Download list cleared","[]",persistedDownloads());assertTrue(downloadEntries().isEmpty());
  }
 }

 @Test public void pageCreatedBlobAndDataFilesAreSavedAfterReview()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");openFixture();
   int before=downloadEntries().size();
   browser.child("document.querySelector('#data').click();true");nativeVisible("file created by the page");
   nativeClick("Cancel");SystemClock.sleep(500);assertEquals("Cancelled capture saves nothing",before,downloadEntries().size());
   openFixture();browser.child("document.querySelector('#data').click();true");nativeVisible("file created by the page");nativeClick("Download");
   android.net.Uri data=savedCapture(before);assertArrayEquals("Exact data: bytes",("data bytes "+token).getBytes(StandardCharsets.UTF_8),read(data));nativeClick("Close");
   openFixture();browser.child("document.querySelector('#blob').click();true");nativeVisible("file created by the page");nativeClick("Download");
   android.net.Uri blob=savedCapture(before+1);assertArrayEquals("Exact blob: bytes",("blob bytes "+token).getBytes(StandardCharsets.UTF_8),read(blob));nativeClick("Close");
   File[] left=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir(),"browser-captures").listFiles();
   assertTrue("App-owned capture files are removed after saving",left==null||left.length==0);
   // The capture and login-field channels exist only in their isolated worlds (BrowserBlobCapture, BrowserLoginFields).
   assertEquals("Child page retains no app bridge","true",browser.child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined' && typeof __elizaBrowserCapture==='undefined' && typeof __elizaLoginFields==='undefined'"));
  }
 }

 @Test public void httpAuthenticationUsesANativePrompt()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");address(base+"auth");
   nativeVisible("127.0.0.1 asks you to sign in.");nativeVisible("Alpha fixture");
   nativeClick("Cancel");nativeVisible("Sign-in was cancelled");
   address(base+"auth?again");nativeVisible("asks you to sign in.");
   nativeType("Username",authUser);nativeType("Password","wrong-"+token);nativeClick("Sign in");
   nativeVisible("The previous sign-in was not accepted.");
   nativeType("Username",authUser);nativeType("Password",authSecret);nativeClick("Sign in");
   page("Auth fixture ok");
  }
 }

 @Test public void sitePermissionsAreOriginLabelledStoredPerProfileAndRevocable()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();BrowserSessionStore store=AlphaBrowserStores.session(context);
  // Pre-grant the Android runtime permission so only the site prompt is under test.
  InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.CAMERA);
  String origin=base.substring(0,base.length()-1),request="(()=>{window.__perm='pending';navigator.mediaDevices.getUserMedia({video:true}).then(s=>{s.getTracks().forEach(t=>t.stop());window.__perm='granted'},e=>{window.__perm=e.name});return true})()";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");openFixture();
   browser.child(request);nativeVisible("Allow camera?");nativeVisible("127.0.0.1 wants to use your camera.");
   nativeClick("Don't allow");childUntil("window.__perm==='NotAllowedError'");
   assertEquals("Normal-tab denial is stored for the origin",Boolean.FALSE,store.permission(origin,"camera"));
   browser.child(request);nativeAbsent("Allow camera?");childUntil("window.__perm==='NotAllowedError'");
   // Geolocation: never granted silently. Without a declared Android location permission it is refused with a notice.
   String[] requested=context.getPackageManager().getPackageInfo(context.getPackageName(),android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions;
   List<String> declared=requested==null?Collections.emptyList():Arrays.asList(requested);
   boolean location=declared.contains(android.Manifest.permission.ACCESS_FINE_LOCATION)||declared.contains(android.Manifest.permission.ACCESS_COARSE_LOCATION);
   browser.child("(()=>{window.__geo='pending';navigator.geolocation.getCurrentPosition(()=>{window.__geo='granted'},e=>{window.__geo=e.code});return true})()");
   if(location){nativeVisible("Allow location?");nativeClick("Don't allow");}else ready("document.body.innerText.includes('Websites cannot use your location in this app.')");
   childUntil("window.__geo===1");
   // Clear data for this site revokes the stored decision.
   click("Menu");click("Clear data for this site");ready("document.querySelector('dialog.alpha-operation-review')");
   host("[...document.querySelectorAll('dialog.alpha-operation-review button')].find(b=>b.textContent==='Clear data').click()");ready("document.body.innerText.includes('Cleared data for')");
   assertNull("Clear data for this site revoked the decision",store.permission(origin,"camera"));
   openFixture();browser.child(request);nativeVisible("Allow camera?");nativeClick("Allow");
   childUntil("window.__perm!=='pending'");assertNotEquals("Allowed request is not refused by Alpha","\"NotAllowedError\"",browser.child("window.__perm"));
   assertEquals("Normal-tab grant is stored",Boolean.TRUE,store.permission(origin,"camera"));
   store.clearPermissionsForSite("127.0.0.1");
   // Private tabs ask every time and never store a decision.
   click("Menu");click("New private tab");openFixture();ready("document.querySelector('[aria-label=\"Private tab\"]')");
   browser.child(request);nativeVisible("Private tab: this choice is not remembered.");nativeClick("Allow");childUntil("window.__perm!=='pending'");
   assertNull("Private-tab decision not stored",store.permission(origin,"camera"));
   browser.child(request);nativeVisible("Allow camera?");nativeClick("Don't allow");childUntil("window.__perm==='NotAllowedError'");
   assertNull("Private-tab denial not stored",store.permission(origin,"camera"));
  }
 }

 @Test public void findInPageCountsStepsAndClearsOnNavigation()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");openFixture();
   String session=pluginString("session"),id=pluginString("presentedId");assertNotNull(session);assertNotNull(id);
   String args="{session:"+JSONObject.quote(session)+",id:"+JSONObject.quote(id);
   host("(()=>{window.__find=[];Capacitor.nativeCallback('AlphaBrowser','addListener',{eventName:'findResult'},e=>window.__find.push(e));return true})()");
   host("(()=>{Capacitor.nativePromise('AlphaBrowser','find',"+args+",query:'needle'}).catch(e=>window.__findError=String(e));return true})()");
   ready("window.__find.some(e=>e.done&&e.count===3&&e.index===1)");
   host("(()=>{Capacitor.nativePromise('AlphaBrowser','findNext',"+args+",forward:true});return true})()");ready("window.__find.some(e=>e.count===3&&e.index===2)");
   host("(()=>{Capacitor.nativePromise('AlphaBrowser','findNext',"+args+",forward:false});return true})()");ready("window.__find.filter(e=>e.count===3&&e.index===1).length>=2");
   // Navigation clears the search natively and reports it.
   address(base+"?next");page("Web features fixture");ready("window.__find.some(e=>e.cleared)");
   host("(()=>{window.__find=[];Capacitor.nativePromise('AlphaBrowser','find',"+args+",query:'absent-"+token+"'});return true})()");ready("window.__find.some(e=>e.done&&e.count===0)");
  }
 }

 @Test public void fullscreenOpensFromAGestureAndBackExits()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();app("Browser");openFixture();
   tap("#full");for(int i=0;i<100&&!fullscreenActive();i++)SystemClock.sleep(100);
   assertTrue("Page fullscreen shown as a native custom view",fullscreenActive());
   InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
   for(int i=0;i<100&&fullscreenActive();i++)SystemClock.sleep(100);
   assertFalse("Back leaves fullscreen first",fullscreenActive());
   childUntil("document.fullscreenElement===null");
   ready(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
  }
 }
}
