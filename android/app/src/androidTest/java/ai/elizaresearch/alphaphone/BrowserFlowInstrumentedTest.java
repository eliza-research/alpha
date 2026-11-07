package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.os.*;
import android.view.*;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.runner.lifecycle.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Public HTTPS flow with real child WebViews. TLS verification is never bypassed. */
@RunWith(AndroidJUnit4.class)
public class BrowserFlowInstrumentedTest {
 @org.junit.Before public void requireSignedInViews() throws Exception {
  AppNavigation.assumeNoRequiredSignIn("BrowserFlow journey");
 }
 private String host(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void until(String js)throws Exception{for(int i=0;i<150;i++){if("true".equals(host("Boolean("+js+")")))return;SystemClock.sleep(100);}fail("Browser control missing: "+js);}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";until(q);host("("+q+").click()");}
 private void address(String value)throws Exception{
  if("false".equals(host("!!document.querySelector('input[aria-label=Address]')")))click("Edit address");
  until("document.querySelector('input[aria-label=Address]')");
  host("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  until("document.querySelector('input[aria-label=Address]').value==="+JSONObject.quote(value));
  host("document.querySelector('input[aria-label=Address]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void collect(View view,List<WebView> result,WebView host){if(view instanceof WebView&&view!=host)result.add((WebView)view);if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)collect(group.getChildAt(i),result,host);}}
 String child(String js)throws Exception{
  CountDownLatch done=new CountDownLatch(1);AtomicReference<String> answer=new AtomicReference<>("null");AtomicReference<Throwable> error=new AtomicReference<>();java.util.concurrent.atomic.AtomicBoolean shown=new java.util.concurrent.atomic.AtomicBoolean();
  TestUiDispatch dispatch=TestUiDispatch.post(()->{try{
   for(Activity a:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED))if(a instanceof MainActivity){MainActivity main=(MainActivity)a;List<WebView> views=new ArrayList<>();collect(main.getWindow().getDecorView(),views,main.getBridge().getWebView());
    for(WebView web:views)if(web.isShown()){shown.set(true);web.evaluateJavascript(js,v->{answer.set(v);done.countDown();});return;}}
   done.countDown();
  }catch(Throwable e){error.set(e);done.countDown();}});
  dispatch.await(done,"Child browser callback");if(error.get()!=null)throw new AssertionError(error.get());
  // No page is shown while a modal host panel is open: the product withdraws the native page under
  // it. On a fresh install that is the first-run access panel, which opens some seconds after
  // launch; answer it with its own "Not now" (nothing is granted), as an owner would, so the next
  // look finds the page. Callers poll, and a page that never shows still fails them.
  if(!shown.get())WebViewTestDriver.evaluate("(()=>{const b=[...document.querySelectorAll('dialog.alpha-startup-permissions[open] button')].find(b=>b.textContent.trim()==='Not now');if(b)b.click();return !!b})()");
  return answer.get();
 }
 /** Failure-only structural diagnostics: no page text, URLs, cookies or credentials. */
 String diagnostics(){
  StringBuilder evidence=new StringBuilder();
  try{
   WebViewTestDriver.withActivity(MainActivity.class,main->{
    android.content.pm.PackageInfo provider=WebView.getCurrentWebViewPackage();
    evidence.append("provider=").append(provider==null?"null":provider.packageName+"@"+provider.versionName);
    for(String feature:new String[]{androidx.webkit.WebViewFeature.MULTI_PROFILE,androidx.webkit.WebViewFeature.GET_WEB_VIEW_RENDERER,androidx.webkit.WebViewFeature.DELETE_BROWSING_DATA,androidx.webkit.WebViewFeature.MULTI_PROCESS,androidx.webkit.WebViewFeature.JS_INJECTION_IN_FRAME_AND_WORLD}){
     try{evidence.append(",").append(feature).append("=").append(androidx.webkit.WebViewFeature.isFeatureSupported(feature));}
     catch(Throwable error){evidence.append(",").append(feature).append("=unavailable:").append(error.getClass().getSimpleName());}
    }
    try{if(androidx.webkit.WebViewFeature.isFeatureSupported(androidx.webkit.WebViewFeature.MULTI_PROCESS))evidence.append(",multiProcessEnabled=").append(androidx.webkit.WebViewCompat.isMultiProcessEnabled());}
    catch(Throwable error){evidence.append(",multiProcessEnabled=unavailable:").append(error.getClass().getSimpleName());}
    List<WebView> children=new ArrayList<>();collect(main.getWindow().getDecorView(),children,main.getBridge().getWebView());
    int shown=0;for(WebView child:children)if(child.isShown())shown++;
    evidence.append(",children=").append(children.size()).append(",shown=").append(shown);
   });
  }catch(Throwable error){evidence.append("; native-diagnostic-unavailable:").append(error.getClass().getSimpleName());}
  try{
   evidence.append("; host=").append(host("JSON.stringify({activeView:document.documentElement.dataset.activeView,mode:document.documentElement.dataset.connectionMode,addressPresent:!!document.querySelector('input[aria-label=Address]'),connectionDialog:!!document.querySelector('.alpha-connection-scrim'),isolatedProfilesRejected:document.body.innerText.includes('needs a newer Android System WebView'),privateTabRejected:document.body.innerText.includes('Private tabs need an Android System WebView'),createRejected:document.body.innerText.includes('Could not create an isolated browser tab'),identityRejected:document.body.innerText.includes('Invalid browser identity'),sessionRejected:document.body.innerText.includes('Expired browser session'),tabLimitRejected:document.body.innerText.includes('Close a tab before opening another')})"));
  }catch(Throwable error){evidence.append("; host-diagnostic-unavailable:").append(error.getClass().getSimpleName());}
  try{evidence.append("; child=").append(child("JSON.stringify({protocol:location.protocol,ready:document.readyState,body:!!document.body})"));}
  catch(Throwable error){evidence.append("; child-diagnostic-unavailable:").append(error.getClass().getSimpleName());}
  return evidence.toString();
 }
 private void page(String suffix)throws Exception{
  for(int i=0;i<300;i++){if("true".equals(child("location.protocol==='https:' && location.hostname==='example.com' && location.search==="+JSONObject.quote(suffix)+" && document.readyState==='complete' && !!document.body && document.body.innerText.trim().length>20")))return;SystemClock.sleep(100);}
  fail("Real HTTPS example.com page did not load: "+suffix+"; "+diagnostics());
 }
 private boolean containsNativeText(View view,String text){
  if(view instanceof android.widget.TextView && view.isShown() && text.contentEquals(((android.widget.TextView)view).getText()))return true;
  if(view instanceof ViewGroup){ViewGroup group=(ViewGroup)view;for(int i=0;i<group.getChildCount();i++)if(containsNativeText(group.getChildAt(i),text))return true;}return false;
 }
 /** Deliver a late Chromium chooser callback to the real installed client.
  * Positive picker selection below still uses actual native touch and SAF. */
 private void deniedChooserCallback(WebView web)throws Exception{
  AtomicBoolean called=new AtomicBoolean();
  WebViewTestDriver.withActivity(MainActivity.class,main->{
   android.webkit.WebChromeClient.FileChooserParams params=new android.webkit.WebChromeClient.FileChooserParams(){
    public int getMode(){return MODE_OPEN;}public String[] getAcceptTypes(){return new String[]{"text/plain"};}
    public boolean isCaptureEnabled(){return false;}public CharSequence getTitle(){return "Disposable late chooser fixture";}
    public String getFilenameHint(){return null;}public android.content.Intent createIntent(){return new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT).setType("text/plain");}
   };
   assertTrue("Native client handles rejected callback",web.getWebChromeClient().onShowFileChooser(web,value->{assertNull("Late chooser cannot return selected data",value);called.set(true);},params));
   assertTrue("Inactive chooser is rejected immediately",called.get());
  });
 }
 private void chooserInactiveBoundaries()throws Exception{
  AtomicReference<WebView> target=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,main->{List<WebView> children=new ArrayList<>();collect(main.getWindow().getDecorView(),children,main.getBridge().getWebView());for(WebView web:children)if(web.isShown()){target.set(web);break;}});
  assertNotNull("Actual loaded child page",target.get());
  host(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"));until("window.__alphaTestNavigation?.status==='complete'");
  AtomicBoolean hidden=new AtomicBoolean();for(int i=0;i<100&&!hidden.get();i++){WebViewTestDriver.withActivity(MainActivity.class,a->hidden.set(!target.get().isShown()));if(!hidden.get())SystemClock.sleep(100);}assertTrue("Browser surface actually hidden",hidden.get());deniedChooserCallback(target.get());
  host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
  WebViewTestDriver.withActivity(MainActivity.class,a->a.startActivity(new android.content.Intent(android.provider.Settings.ACTION_SETTINGS)));
  try{
   AtomicBoolean paused=new AtomicBoolean();for(int i=0;i<100&&!paused.get();i++){
    new Handler(Looper.getMainLooper()).post(()->{for(Stage stage:new Stage[]{Stage.PAUSED,Stage.STOPPED})for(Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage))if(activity.getClass()==MainActivity.class)paused.set(true);});SystemClock.sleep(100);
   }assertTrue("Real external Settings Activity paused browser host",paused.get());deniedChooserCallback(target.get());
  }finally{WebViewTestDriver.pressBack();}
  boolean returned=false;for(int i=0;i<150;i++){if("true".equals(child("document.title==='Upload fixture' && document.querySelector('input').files.length===0"))){returned=true;break;}SystemClock.sleep(100);}assertTrue("Returning restores the same untouched page",returned);
 }
 private void tapChildInput()throws Exception{
  org.json.JSONArray bounds=new org.json.JSONArray(child("(()=>{const r=document.querySelector('input[type=file]').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,innerWidth]})()"));
  float[] point=new float[2];AtomicBoolean found=new AtomicBoolean();
  WebViewTestDriver.withActivity(MainActivity.class,main->{List<WebView> children=new ArrayList<>();collect(main.getWindow().getDecorView(),children,main.getBridge().getWebView());for(WebView web:children)if(web.isShown()){
   int[] location=new int[2];web.getLocationOnScreen(location);float scale=(float)(web.getWidth()/bounds.optDouble(2));point[0]=location[0]+(float)bounds.optDouble(0)*scale;point[1]=location[1]+(float)bounds.optDouble(1)*scale;found.set(true);break;
  }});assertTrue("Visible native browser input",found.get());long now=SystemClock.uptimeMillis();
  android.app.Instrumentation instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation();
  for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent event=MotionEvent.obtain(now,SystemClock.uptimeMillis(),action,point[0],point[1],0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);instrumentation.sendPointerSync(event);event.recycle();}
 }
 private void nativeText(String text)throws Exception{
  AtomicBoolean found=new AtomicBoolean();for(int i=0;i<150;i++){WebViewTestDriver.withActivity(MainActivity.class,a->found.set(containsNativeText(a.getWindow().getDecorView(),text)));if(found.get())return;SystemClock.sleep(100);}fail("Missing visible browser state: "+text+"; "+diagnostics());
 }
 @Test public void selectedDocumentUploadsExactBytesWithoutAppBridge()throws Exception{
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  String token=UUID.randomUUID().toString(),name="alpha-upload-"+token+".txt",body="Synthetic selected browser upload "+token;
  android.content.ContentResolver resolver=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver();
  SelectedDocumentInstrumentedTest picker=new SelectedDocumentInstrumentedTest();android.net.Uri uri=picker.fixture(resolver,name,body);
  java.net.ServerSocket server=new java.net.ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"));
  AtomicReference<String> uploaded=new AtomicReference<>();CountDownLatch received=new CountDownLatch(1);ExecutorService worker=Executors.newSingleThreadExecutor();
  worker.submit(()->{while(!server.isClosed()){try(java.net.Socket socket=server.accept()){
   socket.setSoTimeout(10000);java.io.BufferedReader input=new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream(),java.nio.charset.StandardCharsets.UTF_8));
   String first=input.readLine(),line;int length=0;while((line=input.readLine())!=null&&!line.isEmpty())if(line.toLowerCase(Locale.ROOT).startsWith("content-length:"))length=Integer.parseInt(line.substring(15).trim());
   boolean upload=first!=null&&first.startsWith("POST /upload ");
   if(upload){if(length>4096)throw new java.io.IOException();StringBuilder bytes=new StringBuilder();for(int i=0;i<length;i++){int c=input.read();if(c<0)throw new java.io.IOException();bytes.append((char)c);}uploaded.set(bytes.toString());received.countDown();}
   String html=upload?"ok":"<!doctype html><title>Upload fixture</title><input type=file accept='text/plain' onchange=\"fetch('/upload',{method:'POST',body:this.files[0]}).then(()=>document.title='Uploaded')\"><p>Choose a disposable test file.</p>";
   byte[] response=html.getBytes(java.nio.charset.StandardCharsets.UTF_8);socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: "+response.length+"\r\nConnection: close\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));socket.getOutputStream().write(response);socket.getOutputStream().flush();
  }catch(Exception error){if(server.isClosed())return;}}});
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();address("http://127.0.0.1:"+server.getLocalPort()+"/");
   boolean ready=false;for(int i=0;i<150;i++){if("true".equals(child("document.title==='Upload fixture' && !!document.querySelector('input')"))){ready=true;break;}SystemClock.sleep(100);}if(!ready)fail("Upload fixture document missing; "+diagnostics());
   assertNull("Page cannot upload before explicit selection",uploaded.get());
   assertEquals("No native bridge in upload destination","true",child("typeof Capacitor==='undefined'"));
   chooserInactiveBoundaries();assertNull("Rejected inactive callbacks never upload",uploaded.get());
   tapChildInput();
   boolean pickerVisible=false;for(int i=0;i<150;i++){android.view.accessibility.AccessibilityNodeInfo root=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();if(root!=null&&String.valueOf(root.getPackageName()).contains("documentsui")){pickerVisible=true;break;}SystemClock.sleep(100);}assertTrue("System file picker must actually appear",pickerVisible);
   WebViewTestDriver.cancelDocumentPicker();
   boolean cancelled=false;for(int i=0;i<150;i++){if("true".equals(child("document.title==='Upload fixture' && document.querySelector('input').files.length===0"))){cancelled=true;break;}SystemClock.sleep(100);}assertTrue("Cancelling preserves the page without selecting a file",cancelled);assertNull(uploaded.get());
   tapChildInput();picker.selectDocument(name);
   assertTrue("Actual web request carries selected bytes",received.await(20,TimeUnit.SECONDS));assertEquals(body,uploaded.get());
  }finally{server.close();worker.shutdownNow();resolver.delete(uri,null,null);}
 }
 @Test public void stalledPageCanBeStoppedAndReloaded()throws Exception{
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  // Actual loopback HTTP connection, permitted only by the existing debug
  // network policy. Hold the response until the user stops the navigation.
  java.net.ServerSocket server=new java.net.ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"));
  ExecutorService workers=Executors.newCachedThreadPool();CountDownLatch release=new CountDownLatch(1);
  workers.submit(()->{while(!server.isClosed()){try{java.net.Socket socket=server.accept();workers.submit(()->{try(socket){
   socket.setSoTimeout(5000);java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream()));
   String line;while((line=reader.readLine())!=null&&!line.isEmpty()){}
   if(!release.await(45,TimeUnit.SECONDS))return;
   byte[] body="<!doctype html><title>Recovered page</title><p>Controlled browser reload succeeded.</p>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
   socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));socket.getOutputStream().write(body);socket.getOutputStream().flush();
  }catch(Exception expectedOnCancellation){}});}catch(java.io.IOException stopped){break;}}});
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.documentElement.dataset.activeView");host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
   address("http://127.0.0.1:"+server.getLocalPort()+"/slow");nativeText("Loading website…");
   click("Menu");click("Stop loading");nativeText("Loading stopped. Reload from the menu to try again.");
   assertEquals("Cancelled page has no secure indicator","false",host("!!document.querySelector('[role=img][aria-label=\"Secure connection\"]')"));
   release.countDown();click("Menu");click("Reload page");
   boolean recovered=false;for(int i=0;i<150;i++){if("true".equals(child("document.title==='Recovered page' && document.body.innerText.includes('reload succeeded')"))){recovered=true;break;}SystemClock.sleep(100);}
   assertTrue("Reload presents actual response bytes after cancellation",recovered);
   assertEquals("HTTP fixture never has a secure indicator","false",host("!!document.querySelector('[role=img][aria-label=\"Secure connection\"]')"));
  }finally{release.countDown();server.close();workers.shutdownNow();}
 }
 @Test public void httpErrorDocumentRetainsItsRetryLink()throws Exception{
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  java.net.ServerSocket server=new java.net.ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"));
  ExecutorService worker=Executors.newSingleThreadExecutor();
  worker.submit(()->{while(!server.isClosed()){try(java.net.Socket socket=server.accept()){
   socket.setSoTimeout(5000);java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream()));
   String request=reader.readLine(),line;while((line=reader.readLine())!=null&&!line.isEmpty()){}
   boolean retry=request!=null&&request.startsWith("GET /retry ");
   byte[] body=(retry?"<!doctype html><title>Retried</title><p>Retry destination reached.</p>":"<!doctype html><title>Unavailable</title><p>Website temporarily unavailable.</p><a href='/retry'>Try again</a>").getBytes(java.nio.charset.StandardCharsets.UTF_8);
   socket.getOutputStream().write(("HTTP/1.1 "+(retry?"200 OK":"503 Service Unavailable")+"\r\nContent-Type: text/html\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));socket.getOutputStream().write(body);socket.getOutputStream().flush();
  }catch(java.io.IOException stopped){if(server.isClosed())break;}}});
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.documentElement.dataset.activeView");host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
   address("http://127.0.0.1:"+server.getLocalPort()+"/unavailable");
   boolean visible=false;for(int i=0;i<150;i++){if("true".equals(child("document.title==='Unavailable' && !!document.querySelector('a[href=\"/retry\"]')"))){visible=true;break;}SystemClock.sleep(100);}
   if(!visible)fail("HTTP 503 preserves the actual website document; "+diagnostics());
   assertEquals("Error document has no native bridge","true",child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));
   child("document.querySelector('a').click();true");
   boolean retried=false;for(int i=0;i<150;i++){if("true".equals(child("document.title==='Retried' && location.pathname==='/retry'"))){retried=true;break;}SystemClock.sleep(100);}
   assertTrue("Website retry link reaches its actual destination",retried);
   click("Menu");until("!document.querySelector('button[aria-label=\"Stop loading\"]')");
  }finally{server.close();worker.shutdownNow();}
 }
 @Test public void realHttpsHistoryMenuSharedNormalStorageAndPrivateTabIsolation()throws Exception{
  String token=UUID.randomUUID().toString(),one="?alpha_flow="+token+"-one",two="?alpha_flow="+token+"-two";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.documentElement.dataset.activeView");host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
   address("https://alpha-network-check.invalid/");
   // The address bar closes only after the native tab exists; typing the next
   // address before then races that close and loses the text.
   until("!document.querySelector('input[aria-label=Address]')");
   assertEquals("Uncommitted navigation must not display a secure connection", "false", host("!!document.querySelector('[role=img][aria-label=\"Secure connection\"]')"));
   address("https://example.com/"+one);page(one);
   until("document.querySelector('[role=img][aria-label=\"Secure connection\"]')");
   assertEquals("Remote page cannot call native app bridge","true",child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));
   child("localStorage.setItem('alpha_flow_marker',"+JSONObject.quote(token)+");true");
   address("https://example.com/"+two);page(two);click("Previous page");page(one);click("Next page");page(two);
   click("Menu");until("document.querySelector('button[aria-label=\"Reload page\"]')");
   for(int i=0;i<50&&!"null".equals(child("true"));i++)SystemClock.sleep(100);
   assertEquals("Native page must hide behind host menu","null",child("true"));click("Reload page");page(two);
   // Product decision: normal tabs share one persistent browser profile.
   click("Tabs");click("New tab");address("https://example.com/"+one);page(one);
   assertEquals("Normal tabs share site storage",JSONObject.quote(token),child("localStorage.getItem('alpha_flow_marker')"));
   assertEquals("New tab also lacks native bridge","true",child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));
   assertEquals("Host never sees website storage","null",host("localStorage.getItem('alpha_flow_marker')"));
   // A private tab has its own ephemeral profile in both directions.
   click("Tabs");click("New private tab");address("https://example.com/"+two);page(two);
   until("document.querySelector('[aria-label=\"Private tab\"]')");
   assertEquals("Private tab cannot read normal-tab storage","null",child("localStorage.getItem('alpha_flow_marker')"));
   child("localStorage.setItem('alpha_flow_private',"+JSONObject.quote(token)+");true");
   assertEquals("Private tab lacks native bridge","true",child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));
   // Closing a tab leaves the tab switcher open; return to the remaining page.
   click("Tabs");click("Close private tab");click("Back to page");
   until("!document.querySelector('[aria-label=\"Private tab\"]')");page(two);
   assertEquals("Normal tab cannot read private-tab storage","null",child("localStorage.getItem('alpha_flow_private')"));
   click("Tabs");click("Close tab");
  }
 }
 /** The native host's selected tab; present(id:null) clears it and cancels that tab's Autofill session. */
 private String presentedTab()throws Exception{
  AtomicReference<String> id=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,main->{try{Object plugin=main.getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field field=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("presentedId");field.setAccessible(true);id.set((String)field.get(plugin));}catch(ReflectiveOperationException error){throw new AssertionError(error);}});
  return id.get();
 }
 /** A provider's full-screen unlock screen stops Alpha. Pause keeps the tab's Autofill session for it;
  * the renderer must not withdraw the tab while hidden, which would cancel that session. */
 @Test public void fullScreenActivityOverBrowserKeepsTheTabPresented()throws Exception{
  String suffix="?alpha_flow="+UUID.randomUUID()+"-stopped";
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.documentElement.dataset.activeView");host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
   address("https://example.com/"+suffix);page(suffix);
   String tab=null;for(int i=0;i<50&&tab==null;i++){tab=presentedTab();if(tab==null)SystemClock.sleep(100);}
   assertNotNull("Loaded page is presented",tab);
   WebViewTestDriver.withActivity(MainActivity.class,a->a.startActivity(new android.content.Intent(android.provider.Settings.ACTION_SETTINGS)));
   try{
    AtomicBoolean stopped=new AtomicBoolean();for(int i=0;i<100&&!stopped.get();i++){
     new Handler(Looper.getMainLooper()).post(()->{for(Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.STOPPED))if(activity.getClass()==MainActivity.class)stopped.set(true);});SystemClock.sleep(100);
    }assertTrue("Full-screen Settings Activity stopped the browser host",stopped.get());
    // Ten renderer geometry ticks; a hidden document must not send present(id:null).
    SystemClock.sleep(1000);
    assertEquals("Stopped host keeps the tab presented, so its Autofill session survives",tab,presentedTab());
   }finally{WebViewTestDriver.pressBack();}
   page(suffix);
   assertEquals("Returning shows the same tab",tab,presentedTab());
  }
 }
 /** The URL the shown child WebView was asked to load (WebView.getUrl(), the pending or committed
  * entry), read natively so it is known even when the page never loads. A page withdrawn behind a
  * host panel (a load error, a dialog) still counts; null when no child WebView has an address. */
 private String childUrl()throws Exception{
  AtomicReference<String> url=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,main->{
   List<WebView> views=new ArrayList<>();collect(main.getWindow().getDecorView(),views,main.getBridge().getWebView());
   for(WebView web:views)if(web.isShown()&&web.getUrl()!=null){url.set(web.getUrl());return;}
   for(WebView web:views)if(web.getUrl()!=null){url.set(web.getUrl());return;}
  });
  return url.get();
 }
 /** By default this asserts what the product submits: the executable address is refused before any
  * page exists, and a search becomes https://www.google.com/search?q=<query> in the child WebView.
  * Nothing here needs the public page to load, so the default campaign can pass offline.
  * browserFlowLive=1 (an emulator with network) also waits for the real results page and checks
  * that the provider cannot reach the app bridge; rounds 7 and 8 failed only on that live load. */
 /** The address the shown page's history entry was first asked for, before any redirect the provider made. */
 private String requestedAddress()throws Exception{
  AtomicReference<String> value=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,main->{List<WebView> children=new ArrayList<>();collect(main.getWindow().getDecorView(),children,main.getBridge().getWebView());for(WebView web:children)if(web.isShown()){android.webkit.WebHistoryItem item=web.copyBackForwardList().getCurrentItem();value.set(item==null?null:item.getOriginalUrl());break;}});
  return value.get();
 }
 /** Failure-only: which kind of page answered the search. Host and path class only; no query, page text or cookies. */
 private String searchDiagnostics(){
  try{return "search="+child("JSON.stringify({host:location.hostname==='www.google.com'?'www.google.com':location.hostname==='consent.google.com'?'consent.google.com':/(^|\\.)google\\.[a-z.]{2,6}$/.test(location.hostname)?'other-google':'other',path:location.pathname==='/search'?'/search':location.pathname.startsWith('/sorry/')?'/sorry/':'other',hasQ:new URL(location.href).searchParams.has('q'),hasContinue:new URL(location.href).searchParams.has('continue'),textLength:document.body?document.body.innerText.trim().length:-1})");}
  catch(Throwable error){return "search-diagnostic-unavailable:"+error.getClass().getSimpleName();}
 }
 @Test public void submittedSearchUsesRealProviderAndRejectsExecutableAddress()throws Exception{
  boolean live="1".equals(androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("browserFlowLive"));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   until("document.documentElement.dataset.activeView");host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
   address("javascript:alert(1)");
   until("document.body.innerText.includes('valid HTTP or HTTPS address without credentials')");
   assertEquals("Rejected address cannot create a page","null",child("true"));
   String rejected=childUrl();
   assertFalse("Rejected address is never handed to a WebView",rejected!=null&&rejected.toLowerCase(java.util.Locale.ROOT).startsWith("javascript:"));
   String query="android calendar documentation",quoted=JSONObject.quote(query);address(query);
   String submitted=null;
   for(int i=0;i<150;i++){submitted=childUrl();if(submitted!=null&&submitted.startsWith("https:"))break;SystemClock.sleep(100);}
   if(submitted==null||!submitted.startsWith("https:"))fail("Search must create a child page with an HTTPS address; "+diagnostics());
   android.net.Uri uri=android.net.Uri.parse(submitted);
   assertEquals("Search provider host","www.google.com",uri.getHost());
   assertEquals("Search provider path","/search",uri.getPath());
   assertEquals("Search query is the typed text, unchanged",query,uri.getQueryParameter("q"));
   assertNull("No credentials in the submitted address",uri.getUserInfo());
   if(!live)return;
   // The product decides the request; the provider decides the answer. Both recorded emulator
   // campaigns loaded a complete HTTPS page that was not the results address, and the saved
   // diagnostics did not say which. Google answers some networks (emulators, shared or data-centre
   // addresses, some regions) with its own check or consent page, which names the search it
   // interrupted in `continue`. That answer is accepted only from Google's own host, over HTTPS,
   // and only when `continue` is this exact search; anything else still fails.
   String loaded=" && document.readyState==='complete' && !!document.body && document.body.innerText.trim().length>20";
   String results="location.protocol==='https:' && location.hostname==='www.google.com' && location.pathname==='/search' && new URL(location.href).searchParams.get('q')==="+quoted+loaded;
   String interrupted="(()=>{try{const here=new URL(location.href);if(here.protocol!=='https:'||!((here.hostname==='www.google.com'&&here.pathname.startsWith('/sorry/'))||here.hostname==='consent.google.com'))return false;const next=new URL(here.searchParams.get('continue'));return next.protocol==='https:'&&next.hostname==='www.google.com'&&next.pathname==='/search'&&next.searchParams.get('q')==="+quoted+";}catch(error){return false;}})()"+loaded;
   String outcome=null;
   for(int i=0;i<300&&outcome==null;i++){
    if("true".equals(child(results)))outcome="results";
    else if("true".equals(child(interrupted)))outcome="provider-check";
    else SystemClock.sleep(100);
   }
   if(outcome==null)fail("Search must load its actual HTTPS results page, or the provider's own check page for that exact search; "+searchDiagnostics()+"; "+diagnostics());
   // Whatever the provider answered, the request the product made is exact: HTTPS, the search
   // provider's host and path, and the typed words as the query.
   String requested=requestedAddress();assertNotNull("The page's history entry records the requested address; "+searchDiagnostics(),requested);
   android.net.Uri request=android.net.Uri.parse(requested);
   assertEquals("Search is requested over HTTPS","https",request.getScheme());
   assertEquals("Search is requested from the search provider","www.google.com",request.getHost());
   assertEquals("Search is requested at the provider's search path","/search",request.getPath());
   assertEquals("The typed words are the query, unchanged",query,request.getQueryParameter("q"));
   assertEquals("Search provider cannot access app bridge","true",child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));
   // Recorded with the run, so a pass says which answer it saw: "results" or "provider-check".
   Bundle seen=new Bundle();seen.putString("browserFlowSearch",outcome);androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendStatus(0,seen);
  }
 }

}
