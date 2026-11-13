package ai.alphacompute.alphaphone;

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
 /** The tab the native host presents. Only a presented tab may hold an autofill session, so a
  * renderer that withdraws its page while stopped ends the session a provider's unlock screen needs. */
 private String presentedTab()throws Exception{
  AtomicReference<String> id=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,main->{try{
   Object plugin=main.getBridge().getPlugin("AlphaBrowser").getInstance();
   java.lang.reflect.Field field=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("presentedId");field.setAccessible(true);id.set((String)field.get(plugin));
  }catch(ReflectiveOperationException error){throw new AssertionError(error);}});
  return id.get();
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

 /** Same-document fixture origin. Every request to it is answered in memory by the tab's own client
  * wrapper below; nothing reaches the network and TLS is never bypassed for a real host. */
 private static final String SAME="https://same-document.invalid/";
 private static String sameDocumentPage(String path){
  if(path.equals("/head"))return "<!doctype html><head><script>history.replaceState(null,'','/replaced')</script><title>Replaced fixture</title></head><body><p>Address replaced before first paint.</p></body>";
  return "<!doctype html><title>Same-document fixture</title><p>Same-document navigation fixture.</p><a id='frag' href='#section'>Section</a><form id='signin' onsubmit='return false'><input id='user' name='username' autocomplete='username'></form><section id='section' style='margin-top:1500px'>Section</section>";
 }
 private static Object field(Class<?> type,Object owner,String name)throws ReflectiveOperationException{java.lang.reflect.Field f=type.getDeclaredField(name);f.setAccessible(true);return f.get(owner);}
 /** The presented native tab of AlphaBrowser, or null. Main thread only. */
 private static Object presentedTabObject(MainActivity main)throws ReflectiveOperationException{
  Object plugin=main.getBridge().getPlugin("AlphaBrowser").getInstance();
  Class<?> host=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class;
  Object id=field(host,plugin,"presentedId");
  return id==null?null:((Map<?,?>)field(host,plugin,"tabs")).get(id);
 }
 /** The presented tab's native state: recorded and engine address, committed, loading, error, shown,
  * the Autofill flag and the eligibility the host would compute now. */
 private JSONObject tabState()throws Exception{
  AtomicReference<JSONObject> out=new AtomicReference<>(new JSONObject());
  WebViewTestDriver.withActivity(MainActivity.class,main->{try{
   Object tab=presentedTabObject(main);if(tab==null)return;Class<?> type=tab.getClass();
   WebView web=(WebView)field(type,tab,"web");
   java.lang.reflect.Method eligible=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredMethod("canAutofill",type);eligible.setAccessible(true);
   JSONObject state=new JSONObject();
   state.put("url",field(type,tab,"url"));state.put("engineUrl",String.valueOf(web.getUrl()));state.put("committed",field(type,tab,"committed"));state.put("loading",field(type,tab,"loading"));
   state.put("error",field(type,tab,"error"));state.put("shown",web.isShown());state.put("autofillEnabled",field(type,tab,"autofillEnabled"));
   state.put("eligible",eligible.invoke(main.getBridge().getPlugin("AlphaBrowser").getInstance(),tab));
   out.set(state);
  }catch(Exception error){throw new AssertionError(error);}});
  return out.get();
 }
 /** The presented tab settles on {@code url}: recorded and engine address agree, committed, not loading,
  * no error, shown, and the page itself is at that address (parsed: Android's JSONObject.quote escapes "/"). */
 private JSONObject settled(String url,String step)throws Exception{
  JSONObject state=new JSONObject();
  for(int i=0;i<100;i++){
   state=tabState();
   if(url.equals(state.optString("url"))&&url.equals(state.optString("engineUrl"))&&state.optBoolean("committed")&&!state.optBoolean("loading")&&state.optString("error").isEmpty()&&state.optBoolean("shown")
    &&url.equals(new org.json.JSONTokener(child("location.href")).nextValue()))return state;
   SystemClock.sleep(100);
  }
  fail(step+": tab did not settle on "+url+"; state="+state+"; "+diagnostics());return state;
 }
 /** Opens Browser and loads the in-memory fixture at {@code path} in the presented tab. */
 private void openSameDocument(String path)throws Exception{
  until("document.documentElement.dataset.activeView");host(AppNavigation.request("Browser"));until(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
  // The first address only creates the tab; it fails offline, before the fixture client exists.
  address(SAME+"start");until("!document.querySelector('input[aria-label=Address]')");
  for(int i=0;i<50&&presentedTab()==null;i++)SystemClock.sleep(100);
  assertNotNull("The fixture tab is presented",presentedTab());
  WebViewTestDriver.withActivity(MainActivity.class,main->{try{
   Object tab=presentedTabObject(main);WebView web=(WebView)field(tab.getClass(),tab,"web");android.webkit.WebViewClient original=web.getWebViewClient();
   web.setWebViewClient(new android.webkit.WebViewClient(){
    @Override public android.webkit.WebResourceResponse shouldInterceptRequest(WebView v,android.webkit.WebResourceRequest r){
     original.shouldInterceptRequest(v,r);android.net.Uri uri=r.getUrl();boolean fixture=r.isForMainFrame()&&"https".equals(uri.getScheme())&&"same-document.invalid".equals(uri.getHost());
     byte[] body=(fixture?sameDocumentPage(uri.getPath()):"Fixture route refused").getBytes(java.nio.charset.StandardCharsets.UTF_8);
     return new android.webkit.WebResourceResponse("text/html","UTF-8",fixture?200:403,fixture?"OK":"Forbidden",Collections.emptyMap(),new java.io.ByteArrayInputStream(body));
    }
    @Override public boolean shouldOverrideUrlLoading(WebView v,android.webkit.WebResourceRequest r){return original.shouldOverrideUrlLoading(v,r);}
    @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){original.onPageStarted(v,url,icon);}
    @Override public void onPageCommitVisible(WebView v,String url){original.onPageCommitVisible(v,url);}
    @Override public void onPageFinished(WebView v,String url){original.onPageFinished(v,url);}
    @Override public void doUpdateVisitedHistory(WebView v,String url,boolean reload){original.doUpdateVisitedHistory(v,url,reload);}
    @Override public void onReceivedError(WebView v,android.webkit.WebResourceRequest r,android.webkit.WebResourceError e){original.onReceivedError(v,r,e);}
    @Override public void onReceivedHttpError(WebView v,android.webkit.WebResourceRequest r,android.webkit.WebResourceResponse e){original.onReceivedHttpError(v,r,e);}
    @Override public void onReceivedSslError(WebView v,android.webkit.SslErrorHandler h,android.net.http.SslError e){original.onReceivedSslError(v,h,e);}
    @Override public void onReceivedHttpAuthRequest(WebView v,android.webkit.HttpAuthHandler h,String host,String realm){original.onReceivedHttpAuthRequest(v,h,host,realm);}
    @Override public boolean onRenderProcessGone(WebView v,android.webkit.RenderProcessGoneDetail d){return original.onRenderProcessGone(v,d);}
   });
  }catch(ReflectiveOperationException error){throw new AssertionError(error);}});
  address(SAME+path.substring(1));
 }
 /** pushState records a new entry without a load; Back and Forward then move within the same document. */
 @Test public void sameDocumentPushStateThenBackAndForward()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   openSameDocument("/");settled(SAME,"Fixture page");
   assertEquals("Fixture page has no native bridge","true",child("typeof Capacitor==='undefined' && typeof androidBridge==='undefined'"));
   child("history.pushState({step:1},'','/pushed');true");settled(SAME+"pushed","After pushState");
   click("Previous page");settled(SAME,"Back across pushState");
   assertEquals("Back stays in the same document","true",child("history.state===null && !!document.getElementById('frag')"));
   click("Next page");settled(SAME+"pushed","Forward across pushState");
   assertEquals("Forward restores the pushed state","1",child("history.state&&history.state.step"));
   click("Tabs");click("Close tab");
  }
 }
 /** A fragment link changes the address without a load; Share then offers that exact address. */
 @Test public void sameDocumentFragmentThenShare()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   openSameDocument("/");settled(SAME,"Fixture page");
   child("document.getElementById('frag').click();true");settled(SAME+"#section","After fragment link");
   android.app.Instrumentation instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation();AtomicReference<android.content.Intent> chooser=new AtomicReference<>();
   // Intercepts only the share chooser and answers it as cancelled: no sheet opens, nothing is sent.
   android.app.Instrumentation.ActivityMonitor monitor=new android.app.Instrumentation.ActivityMonitor(){@Override public android.app.Instrumentation.ActivityResult onStartActivity(android.content.Intent intent){
    if(!android.content.Intent.ACTION_CHOOSER.equals(intent.getAction()))return null;chooser.compareAndSet(null,new android.content.Intent(intent));return new android.app.Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null);}};
   instrumentation.addMonitor(monitor);
   try{
    click("Menu");click("Share");
    for(int i=0;i<100&&chooser.get()==null;i++)SystemClock.sleep(100);
    assertNotNull("Share opens for the fragment address; state="+tabState(),chooser.get());
    android.content.Intent send=chooser.get().getParcelableExtra(android.content.Intent.EXTRA_INTENT);
    assertNotNull("Share chooser carries the page",send);
    assertEquals("Share offers the address after the fragment link",SAME+"#section",send.getStringExtra(android.content.Intent.EXTRA_TEXT));
   }finally{instrumentation.removeMonitor(monitor);}
   settled(SAME+"#section","After share");
   click("Tabs");click("Close tab");
  }
 }
 /** A head script replaces the address before first paint; the tab records the replaced address. */
 @Test public void sameDocumentReplaceStateBeforeFirstPaint()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   openSameDocument("/head");settled(SAME+"replaced","Head replaceState");
   assertEquals("The replaced page is the fixture document","\"Replaced fixture\"",child("document.title"));
   click("Tabs");click("Close tab");
  }
 }
 /** A sign-in page that moves from its username to its password step with pushState stays eligible
  * for Autofill on its new address, as it was on the first. */
 @Test public void sameDocumentPushStateBetweenSignInFieldsKeepsAutofillEligibility()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   openSameDocument("/");
   JSONObject first=settled(SAME,"Username step");
   assertTrue("The committed HTTPS username step is Autofill eligible; state="+first,first.optBoolean("eligible")&&first.optBoolean("autofillEnabled"));
   child("history.pushState({},'','/password');document.getElementById('signin').innerHTML=\"<input id='password' name='password' type='password' autocomplete='current-password'>\";true");
   JSONObject second=settled(SAME+"password","Password step");
   assertTrue("The password step is Autofill eligible on its new address; state="+second,second.optBoolean("eligible")&&second.optBoolean("autofillEnabled"));
   click("Tabs");click("Close tab");
  }
 }
}
