package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.browsersurface.BrowserLoginFields;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;
import android.webkit.WebView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.webkit.ScriptHandler;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Real WebView boundary for the integrated provider. Standard WebView omits native
 * per-field origins, so without engine-attested fields (BrowserLoginFields) both top-level
 * and framed forms must receive an explicit framework unavailable result. When the WebView
 * supports engine-attested fields, the top-level form is offered (the offer is never chosen)
 * and the cross-origin frame is still never offered. Synthetic input is never submitted to a server.
 * Run only on the owned disposable emulator admitted by the acceptance runner. */
@RunWith(AndroidJUnit4.class)
public final class PasswordBrowserFillInstrumentedTest {
 private static final String OFFER="Fill with a saved password";
 private final BrowserFlowInstrumentedTest browser=new BrowserFlowInstrumentedTest();
 private final String token=UUID.randomUUID().toString().replace("-","").substring(0,16);
 private final String username="alpha-fill-"+token;
 private final String password="Synthetic-"+token+"-pw";

 private String host(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void waitHost(String predicate)throws Exception{for(int i=0;i<200;i++){if("true".equals(host("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Host condition timed out: "+predicate.substring(0,Math.min(120,predicate.length())));}
 private void click(String label)throws Exception{
  String button="[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";
  waitHost(button);host("("+button+").click()");
 }
 private void address(String value)throws Exception{
  if("false".equals(host("!!document.querySelector('input[aria-label=Address]')")))click("Edit address");
  waitHost("document.querySelector('input[aria-label=Address]')");
  host("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  waitHost("document.querySelector('input[aria-label=Address]').value==="+JSONObject.quote(value));
  host("document.querySelector('input[aria-label=Address]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
 }
 private void childReady(String predicate)throws Exception{for(int i=0;i<300;i++){if("true".equals(browser.child("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Child document condition timed out: "+predicate.substring(0,Math.min(120,predicate.length()))+"; "+browser.diagnostics());}
 private void page(String url)throws Exception{address(url);childReady("location.href==="+JSONObject.quote(url)+" && document.readyState==='complete' && typeof Capacitor==='undefined'");}

 // ---- Shell and accessibility across windows (framework save UI, provider sheets, keyguard) --
 private UiAutomation automation(){return InstrumentationRegistry.getInstrumentation().getUiAutomation();}
 private String shell(String command)throws Exception{
  try(ParcelFileDescriptor descriptor=automation().executeShellCommand(command);java.io.InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(descriptor)){
   java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[1024];int count;
   while((count=input.read(buffer))!=-1){if(output.size()+count>8192)throw new java.io.IOException("Bounded shell response exceeded");output.write(buffer,0,count);}
   return output.toString("UTF-8").trim();
  }
 }
 private List<AccessibilityNodeInfo> roots(){
  List<AccessibilityNodeInfo> roots=new ArrayList<>();
  for(AccessibilityWindowInfo window:automation().getWindows()){AccessibilityNodeInfo root=window.getRoot();if(root!=null)roots.add(root);}
  AccessibilityNodeInfo active=automation().getRootInActiveWindow();if(active!=null)roots.add(active);
  return roots;
 }
 private interface Match{boolean test(AccessibilityNodeInfo node);}
 private AccessibilityNodeInfo find(Match match){
  for(AccessibilityNodeInfo root:roots()){
   ArrayDeque<AccessibilityNodeInfo> queue=new ArrayDeque<>();queue.add(root);int visited=0;
   while(!queue.isEmpty()&&visited++<1024){AccessibilityNodeInfo node=queue.remove();if(node.isVisibleToUser()&&match.test(node))return node;for(int i=0;i<node.getChildCount();i++){AccessibilityNodeInfo child=node.getChild(i);if(child!=null)queue.add(child);}}
  }
  return null;
 }
 private static String text(AccessibilityNodeInfo node){return node.getText()==null?"":node.getText().toString().trim();}
 private AccessibilityNodeInfo withText(String value,boolean exact){String expected=value.toLowerCase(Locale.ROOT);return find(node->{String actual=text(node).toLowerCase(Locale.ROOT);return exact?actual.equals(expected):actual.contains(expected);});}
 // ---- Child page geometry and real touches -----------------------------------------
 private void collect(View view,List<WebView> children,WebView hostView){if(view instanceof WebView&&view!=hostView)children.add((WebView)view);if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)collect(((ViewGroup)view).getChildAt(i),children,hostView);}
 private WebView visibleChild()throws Exception{
  AtomicReference<WebView> found=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,main->{List<WebView> children=new ArrayList<>();collect(main.getWindow().getDecorView(),children,main.getBridge().getWebView());for(WebView child:children)if(child.isShown())found.set(child);});
  assertNotNull("Actual native child must be visible",found.get());return found.get();
 }
 private interface DocumentPoint{double[] read()throws Exception;}
 /**
  * Screen position of a point in the child document, or null while the native child and its
  * document disagree about the viewport. They disagree for a while after the keyboard opens: the
  * activity's bottom padding changes first, so the child is clipped by its parent; the host renderer
  * then gives the native child its smaller frame (it measures on a timer); and the child document
  * learns its new height last. A rectangle read from the document in that interval maps to a place
  * the view no longer shows, which is how one run failed its own "stays inside the visible browser"
  * check. A point counts only when the child is wholly visible, the document's height is the view's
  * height, and the point is inside what is visible.
  */
 private float[] screenPoint(double cssX,double cssY,StringBuilder seen)throws Exception{
  String raw=browser.child("[innerWidth,innerHeight]");seen.setLength(0);
  if(raw==null||!raw.startsWith("[")){seen.append("no child document");return null;}
  JSONArray viewport=new JSONArray(raw);double width=viewport.getDouble(0),height=viewport.getDouble(1);
  if(!(width>0&&height>0)){seen.append("document ").append(raw);return null;}
  WebView child=visibleChild();float[] point=new float[2];boolean[] settled={false};
  BoundedActivityScenario.main(()->{
   int[] position=new int[2];child.getLocationOnScreen(position);float scale=(float)(child.getWidth()/width);int slack=(int)Math.ceil(scale)+1;
   android.graphics.Rect visible=new android.graphics.Rect();boolean shown=child.isShown()&&child.getGlobalVisibleRect(visible);
   boolean whole=shown&&visible.width()>=child.getWidth()-slack&&visible.height()>=child.getHeight()-slack;
   boolean agrees=Math.abs(height*scale-child.getHeight())<=2*slack;
   point[0]=position[0]+(float)cssX*scale;point[1]=position[1]+(float)cssY*scale;
   settled[0]=whole&&agrees&&visible.contains((int)point[0],(int)point[1]);
   seen.append("view ").append(child.getWidth()).append('x').append(child.getHeight()).append(" visible ").append(shown?visible.width()+"x"+visible.height():"none").append(" document ").append(raw).append(" scale ").append(scale).append(" point ").append((int)point[0]).append(',').append((int)point[1]);
  });
  return settled[0]?point:null;
 }
 /** Waits until the same settled screen position is read twice, then sends one real touch there. */
 private void tapSettled(String what,DocumentPoint source)throws Exception{
  float[] point=null,previous=null;StringBuilder seen=new StringBuilder("never sampled");
  for(int i=0;i<300&&point==null;i++){
   double[] css=source.read();float[] next=css==null?null:screenPoint(css[0],css[1],seen);
   if(next!=null&&previous!=null&&Math.abs(next[0]-previous[0])<=1&&Math.abs(next[1]-previous[1])<=1)point=next;
   else{previous=next;SystemClock.sleep(100);}
  }
  assertNotNull("Synthetic form tap stays inside the visible browser ("+what+"): "+seen,point);
  float[] target=point;WebView child=visibleChild();
  // The same precondition as before, read on the UI thread immediately before the touch.
  BoundedActivityScenario.main(()->{android.graphics.Rect visible=new android.graphics.Rect();assertTrue("Synthetic form tap stays inside the visible browser",child.getGlobalVisibleRect(visible)&&visible.contains((int)target[0],(int)target[1]));});
  long down=SystemClock.uptimeMillis();
  for(int action:new int[]{MotionEvent.ACTION_DOWN,MotionEvent.ACTION_UP}){MotionEvent event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,target[0],target[1],0);event.setSource(InputDevice.SOURCE_TOUCHSCREEN);InstrumentationRegistry.getInstrumentation().sendPointerSync(event);event.recycle();}
 }
 private void tapPage(double cssX,double cssY)throws Exception{tapSettled("page point",()->new double[]{cssX,cssY});}
 private void tapField(String id)throws Exception{
  // The IME shrinks the page after typing the username. Scroll the next field into view before a
  // real tap so it cannot hit the host's dock below the page, and read its place again on every
  // pass: a viewport that is still changing moves it.
  String element="document.getElementById("+JSONObject.quote(id)+")";
  tapSettled("field "+id,()->{
   browser.child("window.__alphaLayout=false;"+element+".scrollIntoView({block:'center'});requestAnimationFrame(()=>requestAnimationFrame(()=>window.__alphaLayout=true))");
   childReady("window.__alphaLayout===true");
   String raw=browser.child("(()=>{const r="+element+".getBoundingClientRect();return r.height>0&&r.top>=0&&r.bottom<=innerHeight?[r.x+r.width/2,r.y+r.height/2]:null})()");
   if(raw==null||!raw.startsWith("["))return null;
   JSONArray rect=new JSONArray(raw);return new double[]{rect.getDouble(0),rect.getDouble(1)};
  });
  childReady("document.activeElement?.id==="+JSONObject.quote(id));
 }
 /** Native IME commits after the framework refusal and WebView input connection are ready.
  * DOM equality alone does not prove Android received the edited autofill value. */
 private void type(String id,String value)throws Exception{
  WebView child=visibleChild();boolean[] accepting={false};
  for(int i=0;i<150&&!accepting[0];i++){
   BoundedActivityScenario.main(()->{android.view.inputmethod.InputMethodManager ime=child.getContext().getSystemService(android.view.inputmethod.InputMethodManager.class);accepting[0]=ime!=null&&ime.isActive(child)&&ime.isAcceptingText();});
   if(!accepting[0])SystemClock.sleep(100);
  }
  assertTrue("Browser input connection is ready: "+id,accepting[0]);
  automation().waitForIdle(250,5000);
  android.view.inputmethod.InputConnection[] connection={null};
  BoundedActivityScenario.main(()->connection[0]=child.onCreateInputConnection(new android.view.inputmethod.EditorInfo()));
  assertNotNull("Browser supplies a native input connection",connection[0]);
  android.os.Handler handler=connection[0].getHandler();
  if(handler==null)handler=new android.os.Handler(android.os.Looper.getMainLooper());
  java.util.concurrent.CountDownLatch committed=new java.util.concurrent.CountDownLatch(1);
  boolean[] accepted={false};Throwable[] failure={null};
  assertTrue("Input thread accepts commit",handler.post(()->{
   try{accepted[0]=connection[0].commitText(value,1);}catch(Throwable error){failure[0]=error;}finally{committed.countDown();}
  }));
  assertTrue("Native input commit completes",committed.await(10,java.util.concurrent.TimeUnit.SECONDS));
  if(failure[0]!=null)throw new AssertionError("Native input commit failed",failure[0]);
  assertTrue("Native input commit accepted",accepted[0]);
  for(int i=0;i<150;i++){if("true".equals(browser.child("document.getElementById("+JSONObject.quote(id)+").value==="+JSONObject.quote(value))))return;SystemClock.sleep(100);}
  fail("Native browser edit did not reach "+id+"; "+browser.child("JSON.stringify({active:document.activeElement?.id,length:document.getElementById("+JSONObject.quote(id)+").value.length})"));
 }
 private void refused(java.util.concurrent.atomic.AtomicInteger unavailable,int before)throws Exception{
  for(int i=0;i<150&&unavailable.get()==before;i++)SystemClock.sleep(100);
  assertTrue("Framework explicitly reports Autofill unavailable for the focused web form",unavailable.get()>before);
 }
 private void form(boolean navigateOnSubmit)throws Exception{
  String submit=navigateOnSubmit?"event.preventDefault();location.href=\\'https://example.com/?alpha_password_signed_in="+token+"\\';":"event.preventDefault();";
  assertEquals("true",browser.child("(()=>{document.body.style.cssText='margin:16px;width:auto;padding-bottom:100vh';document.body.innerHTML='<form id=\"alpha-login\" autocomplete=\"on\" onsubmit=\""+submit+"\"><label>Username<input id=\"alpha-user\" name=\"username\" autocomplete=\"username\" style=\"display:block;width:85%;height:48px\"></label><label style=\"display:block;margin-top:200px\">Password<input id=\"alpha-password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" style=\"display:block;width:85%;height:48px;margin-bottom:24px\"></label><button id=\"alpha-submit\" style=\"display:block;height:48px\">Sign in</button></form>';return typeof Capacitor==='undefined' && typeof androidBridge==='undefined'})()"));
 }

 @Test public void webFormsWithoutNativeFieldOriginsAreRefused()throws Exception{
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  AccessibilityServiceInfo info=automation().getServiceInfo();info.flags|=AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS;automation().setServiceInfo(info);
  assertEquals("Boundary test runs only on an emulator","1",shell("getprop ro.kernel.qemu"));
  // Fill admission does not read the vault or require an unlock. Validate native
  // configuration so an initialization failure cannot masquerade as form refusal.
  assertNotNull(ai.eliza.plugins.passwords.PasswordVaultAccess.get(context));
  String user=shell("am get-current-user");
  assertTrue("Foreground Android user must be numeric",user.matches("[0-9]{1,6}"));
  String prior=shell("settings --user "+user+" get secure autofill_service");
  assertTrue("Existing provider setting must be safely restorable",prior.isEmpty()||prior.equals("null")||prior.matches("[A-Za-z0-9_.$]+/[A-Za-z0-9_.$]+"));
  String component=context.getPackageName()+"/ai.eliza.plugins.passwords.ElizaPasswordAutofillService";
  String priorAugmented=shell("cmd autofill get default-augmented-service-enabled "+user);
  assertTrue("Augmented provider setting must be safely restorable",priorAugmented.equals("true")||priorAugmented.equals("false"));
  ScriptHandler frameScript=null;
  java.util.concurrent.atomic.AtomicInteger unavailable=new java.util.concurrent.atomic.AtomicInteger();
  android.view.autofill.AutofillManager manager=context.getSystemService(android.view.autofill.AutofillManager.class);
  AtomicReference<WebView> observedChild=new AtomicReference<>();
  AtomicReference<android.view.autofill.AutofillManager> observationManager=new AtomicReference<>();
  AtomicReference<android.view.autofill.AutofillManager.AutofillCallback> original=new AtomicReference<>();
  android.view.autofill.AutofillManager.AutofillCallback callback=new android.view.autofill.AutofillManager.AutofillCallback(){
   @Override public void onAutofillEvent(View view,int virtualId,int event){original.get().onAutofillEvent(view,virtualId,event);if(view==observedChild.get()&&event==EVENT_INPUT_UNAVAILABLE)unavailable.incrementAndGet();}
   @Override public void onAutofillEvent(View view,int event){original.get().onAutofillEvent(view,event);if(view==observedChild.get()&&event==EVENT_INPUT_UNAVAILABLE)unavailable.incrementAndGet();}
  };
  try{
   // Android retains null-response sessions when an augmented provider can fill.
   // Isolate this provider so its rejection produces the real unavailable callback.
   shell("cmd autofill set default-augmented-service-enabled "+user+" false");
   assertEquals("Augmented fallback disabled for this test", "false",shell("cmd autofill get default-augmented-service-enabled "+user));
   shell("settings --user "+user+" put secure autofill_service "+component);
   assertEquals("Eliza password provider selected",component,shell("settings --user "+user+" get secure autofill_service"));
   for(int i=0;i<150&&!android.content.ComponentName.unflattenFromString(component).equals(manager.getAutofillServiceComponentName());i++)SystemClock.sleep(100);
   assertEquals("Framework observed the selected provider",android.content.ComponentName.unflattenFromString(component),manager.getAutofillServiceComponentName());
   try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
    try{
    AppNavigation.liveMode();host(AppNavigation.request("Browser"));waitHost(AppNavigation.selected("Browser"));AppNavigation.declineStartupAccess();
    // AlphaBrowser loads lazily and registers its callback when the first tab
    // opens. Observe only after that registration, preserving its callback.
    page("https://example.com/?alpha_password_save="+token);
    observedChild.set(visibleChild());
    WebViewTestDriver.withActivity(MainActivity.class,activity->{try{
     Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();
     java.lang.reflect.Field field=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("autofillCallback");field.setAccessible(true);
     original.set((android.view.autofill.AutofillManager.AutofillCallback)field.get(plugin));
     android.view.autofill.AutofillManager actual=observedChild.get().getContext().getSystemService(android.view.autofill.AutofillManager.class);
     observationManager.set(actual);actual.registerCallback(callback);
    }catch(Exception error){throw new AssertionError(error);}});

    boolean attested=BrowserLoginFields.supported();
    if(attested){
     // Engine-attested origin for the top-level document: the provider offers its locked
     // dataset. It is not chosen, and the form never navigates, so nothing is filled or saved.
     form(false);tapField("alpha-user");
     for(int i=0;i<150&&withText(OFFER,false)==null;i++)SystemClock.sleep(100);
     assertNotNull("Engine-attested top-level login field is offered",withText(OFFER,false));
     type("alpha-user",username);
    }else{
    form(true);tapField("alpha-user");
    refused(unavailable,0);
    type("alpha-user",username);
    tapField("alpha-password");type("alpha-password",password);
    assertNull("No password offer without native field origins",withText(OFFER,false));
    browser.child("document.getElementById('alpha-login').requestSubmit()");
    childReady("location.search==="+JSONObject.quote("?alpha_password_signed_in="+token)+" && document.readyState==='complete'");
    SystemClock.sleep(2500);
    assertNull("No Save offer without native field origins",withText("Alpha Phone passwords",false));
    assertNull("No provider Save sheet",withText("Save password?",false));
    }

    int beforeFrame=unavailable.get();
    // A login form only inside a cross-origin iframe: focused for real, never offered.
    Assume.assumeTrue("Cross-origin frame phase needs WebView document-start scripts",WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT));
    WebView child=visibleChild();AtomicReference<ScriptHandler> handler=new AtomicReference<>();
    String inner="document.addEventListener('DOMContentLoaded',()=>{document.body.innerHTML='<form autocomplete=\"on\" onsubmit=\"return false\"><input id=\"alpha-frame-user\" name=\"username\" autocomplete=\"username\" style=\"position:fixed;left:8px;top:8px;width:200px;height:48px\"><input id=\"alpha-frame-password\" type=\"password\" autocomplete=\"current-password\" style=\"position:fixed;left:8px;top:72px;width:200px;height:48px\"></form>';document.addEventListener('focusin',e=>parent.postMessage('alpha-frame-focus:'+e.target.id,'*'));});";
    BoundedActivityScenario.main(()->handler.set(WebViewCompat.addDocumentStartJavaScript(child,inner,Collections.singleton("https://example.org"))));
    frameScript=handler.get();
    page("https://example.com/?alpha_password_frame="+token);
    browser.child("(()=>{window.__alphaFrameFocus='';addEventListener('message',e=>{if(e.origin==='https://example.org')window.__alphaFrameFocus=String(e.data)});document.body.innerHTML='<iframe id=\"alpha-frame\" src=\"https://example.org/?alpha_password_frame="+token+"\" style=\"position:fixed;left:0;top:0;width:300px;height:160px;border:0\" onload=\"window.__alphaFrameLoaded=true\"></iframe>';})()");
    childReady("window.__alphaFrameLoaded===true");
    for(int attempt=0;attempt<100;attempt++){
     tapPage(8+100,8+24);SystemClock.sleep(300);
     if("true".equals(browser.child("window.__alphaFrameFocus==='alpha-frame-focus:alpha-frame-user'")))break;
    }
    assertEquals("The cross-origin frame's username field received a real focus","true",browser.child("window.__alphaFrameFocus==='alpha-frame-focus:alpha-frame-user'"));
    if(attested)SystemClock.sleep(3000);
    else refused(unavailable,beforeFrame);
    assertNull("No password offer for a cross-origin iframe",withText(OFFER,false));
    assertNull("No picker for a cross-origin iframe",withText("Choose a sign-in",false));
    }finally{
     // Remove scripts while their WebView is alive; Chromium can crash natively
     // if ScriptHandler.remove runs after ActivityScenario destroys the view.
     if(frameScript!=null){ScriptHandler remove=frameScript;BoundedActivityScenario.main(remove::remove);}
    }
   }
  }finally{
   shell("cmd autofill set default-augmented-service-enabled "+user+" "+priorAugmented);
   assertEquals("Augmented provider setting restored",priorAugmented,shell("cmd autofill get default-augmented-service-enabled "+user));
   if(observationManager.get()!=null)observationManager.get().unregisterCallback(callback);
   if(prior.equals("null"))shell("settings --user "+user+" delete secure autofill_service");
   else if(prior.isEmpty()){
    UiAutomation automation=automation();automation.adoptShellPermissionIdentity(android.Manifest.permission.WRITE_SECURE_SETTINGS);
    try{android.provider.Settings.Secure.putString(context.getContentResolver(),"autofill_service","");}finally{automation.dropShellPermissionIdentity();}
   }
   else shell("settings --user "+user+" put secure autofill_service "+prior);
  }
 }
}
