package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserLoginFields;
import android.os.*;
import android.view.*;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real framework service, native selection and virtual-field fill. Form injection
 * is instrumentation-only after a real validated HTTPS navigation; never submits. */
@RunWith(AndroidJUnit4.class)
public final class BrowserAutofillInstrumentedTest {
 private final BrowserFlowInstrumentedTest browser=new BrowserFlowInstrumentedTest();
 private String host(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void waitHost(String predicate)throws Exception{
  for(int i=0;i<150;i++){if("true".equals(host("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Autofill host condition timed out");
 }
 private void click(String label)throws Exception{
  String button="[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";
  waitHost(button);host("("+button+").click()");
 }
 private void address(String value)throws Exception{
  if("false".equals(host("!!document.querySelector('input[aria-label=Address]')")))click("Edit address");
  waitHost("document.querySelector('input[aria-label=Address]')");
  host("(()=>{let e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  waitHost("document.querySelector('input[aria-label=Address]').value==="+JSONObject.quote(value));
  host("document.querySelector('input[aria-label=Address]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void collect(View view,List<WebView> children,WebView host){
  if(view instanceof WebView && view!=host)children.add((WebView)view);
  if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)collect(((ViewGroup)view).getChildAt(i),children,host);
 }
 private WebView visibleChild()throws Exception{
  AtomicReference<WebView> found=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,main->{List<WebView> children=new ArrayList<>();collect(main.getWindow().getDecorView(),children,main.getBridge().getWebView());for(WebView child:children)if(child.isShown())found.set(child);});
  assertNotNull("Actual native child must be visible",found.get());return found.get();
 }
 private void childReady(String predicate)throws Exception{
  for(int i=0;i<300;i++){if("true".equals(browser.child(predicate)))return;SystemClock.sleep(100);}fail("Autofill document condition timed out; "+browser.diagnostics());
 }
 private String shell(String command)throws Exception{
  try(ParcelFileDescriptor descriptor=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
      java.io.InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(descriptor)){
   java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[1024];int count;
   while((count=input.read(buffer))!=-1){if(output.size()+count>4096)throw new java.io.IOException("Bounded shell response exceeded");output.write(buffer,0,count);}
   return output.toString(java.nio.charset.StandardCharsets.UTF_8.name()).trim();
  }
 }
 private AccessibilityNodeInfo suggestion(){
  AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
  if(root==null)return null;
  for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(SyntheticAutofillService.LABEL))if(node.isVisibleToUser())return node;
  return null;
 }
 /**
  * The popup is gone only when the active window has a root and that root shows no suggestion in
  * five consecutive readings. While Android removes the popup window the active root is briefly
  * null; a single null reading followed by one more look at the closing window failed this check
  * about two seconds after the product had cancelled the session (logcat of the failing cycle).
  * A popup that stays, or a root that never settles, still fails after ten seconds.
  */
 private boolean suggestionGone(){
  int absent=0;long end=SystemClock.elapsedRealtime()+10000;
  while(SystemClock.elapsedRealtime()<end){
   AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
   boolean shown=false;
   if(root!=null)for(AccessibilityNodeInfo node:root.findAccessibilityNodeInfosByText(SyntheticAutofillService.LABEL))if(node.isVisibleToUser())shown=true;
   absent=root!=null&&!shown?absent+1:0;
   if(absent>=5)return true;
   SystemClock.sleep(100);
  }
  return false;
 }
 private void selectSuggestion()throws Exception{
  for(int i=0;i<150;i++){AccessibilityNodeInfo node=suggestion();if(node!=null){while(node!=null&&!node.isClickable())node=node.getParent();if(node!=null&&node.performAction(AccessibilityNodeInfo.ACTION_CLICK))return;}SystemClock.sleep(100);}
  fail("Android synthetic dataset was not visibly selectable");
 }
 private void tapUsername()throws Exception{
  // DOM replacement is synchronous, but Chromium layout/compositing is not.
  // Await two actual frames before computing coordinates for the real touch.
  browser.child("window.__alphaAutofillLayoutReady=false;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__alphaAutofillLayoutReady=true))");
  childReady("window.__alphaAutofillLayoutReady===true && document.querySelector('#alpha-user').getBoundingClientRect().height>0");

  JSONArray rect=new JSONArray(browser.child("(()=>{const r=document.querySelector('#alpha-user').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2,innerWidth]})()"));
  WebView child=visibleChild();float[] point=new float[2];
  BoundedActivityScenario.main(()->{int[] position=new int[2];child.getLocationOnScreen(position);float scale=(float)(child.getWidth()/rect.optDouble(2));point[0]=position[0]+(float)rect.optDouble(0)*scale;point[1]=position[1]+(float)rect.optDouble(1)*scale;});
  long down=SystemClock.uptimeMillis();for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){
   MotionEvent event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,point[0],point[1],0);event.setSource(InputDevice.SOURCE_TOUCHSCREEN);InstrumentationRegistry.getInstrumentation().sendPointerSync(event);event.recycle();
  }
  childReady("document.activeElement?.id==='alpha-user'");
 }
 private void form()throws Exception{
  assertEquals("true",browser.child("(()=>{document.body.innerHTML='<form autocomplete=\"on\" onsubmit=\"return false\"><label>Username<input id=\"alpha-user\" name=\"username\" autocomplete=\"username\" style=\"display:block;width:85%;height:48px\"></label><label>Password<input id=\"alpha-password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" style=\"display:block;width:85%;height:48px\"></label></form>';return typeof Capacitor==='undefined' && typeof androidBridge==='undefined'})()"));
 }
 /** The tab's Autofill eligibility. With engine-attested fields (BrowserLoginFields) the WebView
  * itself stays excluded and the tab's eligibility flag governs the attested fields instead. */
 private void eligibility(WebView child,int expected)throws Exception{
  boolean attested=BrowserLoginFields.supported();
  for(int i=0;i<100;i++){
   java.util.concurrent.atomic.AtomicInteger actual=new java.util.concurrent.atomic.AtomicInteger();
   BoundedActivityScenario.main(()->actual.set(child.getImportantForAutofill()));
   // The tab flag is read on the main thread by withActivity itself (never nested in main()).
   if(attested)actual.set(actual.get()!=View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS?-1:tabAutofillEnabled(child)?View.IMPORTANT_FOR_AUTOFILL_YES:View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
   if(actual.get()==expected)return;SystemClock.sleep(100);
  }fail("Native autofill eligibility did not reach expected state");
 }
 /** Reads AlphaBrowserPlugin's private tab state for {@code child} on the main thread. */
 private static boolean tabAutofillEnabled(WebView child){
  boolean[] enabled={false};
  try{WebViewTestDriver.withActivity(MainActivity.class,main->{try{
   Object plugin=main.getBridge().getPlugin("AlphaBrowser").getInstance();
   java.lang.reflect.Field tabs=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("tabs");tabs.setAccessible(true);
   for(Object tab:((java.util.Map<?,?>)tabs.get(plugin)).values()){
    java.lang.reflect.Field web=tab.getClass().getDeclaredField("web");web.setAccessible(true);
    if(web.get(tab)!=child)continue;
    java.lang.reflect.Field flag=tab.getClass().getDeclaredField("autofillEnabled");flag.setAccessible(true);
    enabled[0]=flag.getBoolean(tab);
   }
  }catch(ReflectiveOperationException error){throw new AssertionError(error);}});}
  catch(Exception error){throw new AssertionError(error);}
  return enabled[0];
 }
 @Test public void frameworkFillsOnlyVisibleCommittedHttpsChild()throws Exception{
  String user=shell("am get-current-user");
  assertTrue("Foreground Android user must be numeric",user.matches("[0-9]{1,6}"));
  String prior=shell("settings --user "+user+" get secure autofill_service");
  assertTrue("Existing provider setting must be safely restorable",prior.isEmpty()||prior.equals("null")||prior.matches("[A-Za-z0-9_.$]+/[A-Za-z0-9_.$]+"));
  String component=InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName()+"/ai.elizaresearch.alphaphone.SyntheticAutofillService";
  SyntheticAutofillService.accepted.set(0);SyntheticAutofillService.rejected.set(0);SyntheticAutofillService.armed=true;
  try{
   shell("settings --user "+user+" put secure autofill_service "+component);
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    AppNavigation.liveMode();host(AppNavigation.request("Browser"));waitHost(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
    // A fresh install opens the modal access panel a few seconds after launch, in the middle of the
    // real taps below. Answer it first, as an owner does ("Not now" grants nothing).
    AppNavigation.declineStartupAccess();
    WebViewTestDriver.withActivity(MainActivity.class,main->assertEquals("Privileged host excludes credentials",View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS,main.getBridge().getWebView().getImportantForAutofill()));
    address("https://example.com/?alpha_autofill="+UUID.randomUUID());
    childReady("location.protocol==='https:' && location.hostname==='example.com' && document.readyState==='complete'");
    WebView child=visibleChild();eligibility(child,View.IMPORTANT_FOR_AUTOFILL_YES);
    form();tapUsername();selectSuggestion();
    childReady("document.querySelector('#alpha-user').value==="+JSONObject.quote(SyntheticAutofillService.USER)+" && document.querySelector('#alpha-password').value==="+JSONObject.quote(SyntheticAutofillService.PASSWORD));
    assertTrue("Actual framework service accepted HTTPS virtual fields",SyntheticAutofillService.accepted.get()>0);
    assertEquals("Host cannot see filled child form","true",host("!document.querySelector('#alpha-password') && !document.body.innerText.includes("+JSONObject.quote(SyntheticAutofillService.PASSWORD)+")"));
    // Framework cancel plus script-only clearing does not establish a fresh
    // Chromium autofill session. Navigate to a new document and focus a new
    // virtual field through a real tap before testing overlay cancellation.
    // Repeat fresh native sessions to cover the observed intermittent popup race.
    for(int cycle=0;cycle<3;cycle++){
    int previousRequests=SyntheticAutofillService.accepted.get(),previousRejected=SyntheticAutofillService.rejected.get();
    String secondUrl="https://example.com/?alpha_autofill_overlay="+UUID.randomUUID();
    address(secondUrl);
    childReady("location.href==="+JSONObject.quote(secondUrl)+" && document.readyState==='complete' && !document.querySelector('#alpha-password')");
    eligibility(child,View.IMPORTANT_FOR_AUTOFILL_YES);
    form();tapUsername();
    for(int i=0;i<100&&suggestion()==null;i++)SystemClock.sleep(100);
    AccessibilityNodeInfo popup=suggestion();
    if(popup==null){
     java.util.concurrent.atomic.AtomicInteger important=new java.util.concurrent.atomic.AtomicInteger();
     java.util.concurrent.atomic.AtomicBoolean focused=new java.util.concurrent.atomic.AtomicBoolean();
     BoundedActivityScenario.main(()->{important.set(child.getImportantForAutofill());focused.set(child.hasWindowFocus());});
     fail("Real suggestion missing in cycle "+cycle+"; acceptedDelta="+(SyntheticAutofillService.accepted.get()-previousRequests)+"; rejectedDelta="+(SyntheticAutofillService.rejected.get()-previousRejected)+"; usernameFocused="+browser.child("document.activeElement?.id==='alpha-user'")+"; childWindowFocused="+focused.get()+"; eligibility="+important.get());
    }
    assertNotNull("Real suggestion exists before overlay cycle "+cycle,popup);
    assertTrue("New document starts a framework request in cycle "+cycle,SyntheticAutofillService.accepted.get()>previousRequests);
    click("Menu");eligibility(child,View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
    assertTrue("Overlay cancels native credential suggestion in cycle "+cycle,suggestionGone());
    // Reload and a different HTTPS origin must never reuse the prior filled form.
    click("Reload page");childReady("location.hostname==='example.com' && document.readyState==='complete' && !document.querySelector('#alpha-password')");
    }
    address("https://alpha-autofill-invalid.invalid/");eligibility(child,View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
    java.net.ServerSocket server=new java.net.ServerSocket(0,8,java.net.InetAddress.getByName("127.0.0.1"));
    java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
    worker.submit(()->{while(!server.isClosed())try(java.net.Socket socket=server.accept()){
     socket.setSoTimeout(5000);java.io.BufferedReader reader=new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream()));
     String line;while((line=reader.readLine())!=null&&!line.isEmpty()){}
     byte[] body="<!doctype html><title>Cleartext synthetic fixture</title><p>Native autofill must remain disabled.</p>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
     socket.getOutputStream().write(("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(java.nio.charset.StandardCharsets.US_ASCII));socket.getOutputStream().write(body);socket.getOutputStream().flush();
    }catch(Exception stopped){if(server.isClosed())break;}});
    try{
     address("http://127.0.0.1:"+server.getLocalPort()+"/");
     childReady("location.protocol==='http:' && document.title==='Cleartext synthetic fixture' && document.readyState==='complete'");
     eligibility(child,View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
     int accepted=SyntheticAutofillService.accepted.get();form();tapUsername();SystemClock.sleep(800);
     assertEquals("Cleartext document never requests a credential dataset",accepted,SyntheticAutofillService.accepted.get());
     assertNull("Cleartext form has no provider suggestion",suggestion());
     assertEquals("Cleartext fields remain empty","true",browser.child("document.querySelector('#alpha-user').value==='' && document.querySelector('#alpha-password').value===''") );
    }finally{server.close();worker.shutdownNow();}

   }
  }finally{
   SyntheticAutofillService.armed=false;
   if(prior.equals("null"))shell("settings --user "+user+" delete secure autofill_service");
   else if(prior.isEmpty()){
    // UiAutomation executes String commands with Runtime.exec, not a shell:
    // quoting an empty argument would persist quote characters instead.
    android.app.UiAutomation automation=InstrumentationRegistry.getInstrumentation().getUiAutomation();
    automation.adoptShellPermissionIdentity(android.Manifest.permission.WRITE_SECURE_SETTINGS);
    try{assertTrue("Restore explicitly empty provider value",android.provider.Settings.Secure.putString(
     InstrumentationRegistry.getInstrumentation().getTargetContext().getContentResolver(),"autofill_service",""));}
    finally{automation.dropShellPermissionIdentity();}
   }
   else shell("settings --user "+user+" put secure autofill_service "+prior);
  }
 }
}
