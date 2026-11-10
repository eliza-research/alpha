package ai.alphacompute.alphaphone;

import android.os.SystemClock;
import android.view.KeyEvent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Full WebView journeys through the reference UI; no mocked native bridge/model. The live-agent
 * proposal journey is LiveAgentInstrumentedTest.realProviderProposesAndUserApprovesPersistedLocalNote. */
@RunWith(AndroidJUnit4.class)
public class PrototypeFlowInstrumentedTest {
 private String eval(BoundedActivityScenario<MainActivity> s,String js) throws Exception {
  return NotesSecureFixture.evaluate(js);
 }
 private void waitFor(BoundedActivityScenario<MainActivity> s,String condition,long timeout) throws Exception {
  long end=SystemClock.elapsedRealtime()+timeout;
  while(SystemClock.elapsedRealtime()<end){if("true".equals(eval(s,"Boolean("+condition+")")))return;SystemClock.sleep(100);}
  fail("Timed out: "+condition+"; visible="+eval(s,"document.body.innerText.slice(-2200)"));
 }
 private String button(String label) {return "[...document.querySelectorAll('[data-screen] button')].find(b=>b.getAttribute('aria-label')==="+JSONObject.quote(label)+")";}
 private void click(BoundedActivityScenario<MainActivity> s,String label) throws Exception {waitFor(s,button(label),10000);eval(s,"("+button(label)+").click()");}
 private void home(BoundedActivityScenario<MainActivity> s) throws Exception {
  // Native Back evaluates JS asynchronously. Never queue another key merely
  // because 150 ms elapsed: a delayed second key can finish standalone at Home.
  eval(s,"(()=>{if(!window.__backProbeInstalled){window.__backProbeInstalled=true;window.__backProbe=0;addEventListener('alpha-back',()=>requestAnimationFrame(()=>requestAnimationFrame(()=>window.__backProbe++)));}})()");
  for(int i=0;i<8;i++){
   if("\"home\"".equals(eval(s,"document.documentElement.dataset.activeView")))return;
   String before=eval(s,"window.__backProbe");
   assertEquals("Non-home screen must advertise native Back handling","true",eval(s,"document.documentElement.dataset.alphaCanGoBack==='true'"));
   InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
   waitFor(s,"window.__backProbe>"+before+" || document.documentElement.dataset.activeView==='home'",5000);
  }
  fail("Eight acknowledged physical Back events did not return Home; state="+eval(s,"document.documentElement.dataset.activeView"));
 }
 private void ready(BoundedActivityScenario<MainActivity> s) throws Exception {waitFor(s,"document.documentElement.dataset.activeView==='home' && document.querySelector('[data-screen]')",15000);}
 private void open(BoundedActivityScenario<MainActivity> s,String title) throws Exception {home(s);click(s,title);waitFor(s,"document.documentElement.dataset.activeView==="+JSONObject.quote(title.toLowerCase()),10000);}
 private void fill(BoundedActivityScenario<MainActivity> s,String label,String value) throws Exception {
  String q="document.querySelector('input[aria-label=\""+label+"\"],textarea[aria-label=\""+label+"\"]')";
  waitFor(s,q,10000);eval(s,"(()=>{const e="+q+";Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(value)+");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
  waitFor(s,q+".value==="+JSONObject.quote(value),10000);
 }
 private String note(String title){return "__notesEnvelope.records.find(n=>n.title==="+JSONObject.quote(title)+")";}
 @Test public void allMvpAppsOpenAndPhysicalBackReturnsHome() throws Exception {
  AppNavigation.assumeNoRequiredSignIn("MVP app navigation");
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   ready(s);
   assertEquals("Deferred native Contacts plugin is not registered","true",eval(s,"!Capacitor.isPluginAvailable('ElizaContacts')"));
   eval(s,"window.__mvpNativeProfile=null;Promise.all([Capacitor.Plugins.DailyApps.capabilities(),...['phone','messages','contacts'].map(action=>Capacitor.Plugins.DailyApps.perform({action}))]).then(value=>window.__mvpNativeProfile=value)");
   waitFor(s,"Array.isArray(window.__mvpNativeProfile)",10000);
   assertEquals("Deferred handoffs absent and direct native calls fail","true",eval(s,"!window.__mvpNativeProfile[0].actions.some(x=>['phone','messages','contacts'].includes(x.action))&&window.__mvpNativeProfile.slice(1).every(x=>x.status==='failed')"));
   android.content.pm.PackageInfo packageInfo=InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageManager().getPackageInfo(InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(),android.content.pm.PackageManager.GET_PERMISSIONS);
   for(String permission:packageInfo.requestedPermissions)assertFalse("Deferred Contacts permission not shipped",permission.equals("android.permission.READ_CONTACTS")||permission.equals("android.permission.WRITE_CONTACTS"));
   for(String deferred:new String[]{"Phone","Messages","Contacts","Wallet"}) {
    assertEquals("Deferred app has no Home control: "+deferred,"true",eval(s,"!("+button(deferred)+")"));
    accessible(deferred,false);
   }
   for(String title:new String[]{"Inbox","Calendar","Browser","Camera","Photos","Maps","Notes","Files","Workflows","Settings"}){
    open(s,title);assertEquals("App must render controls: "+title,"true",eval(s,"document.querySelectorAll('[data-screen] button').length>0"));home(s);
   }
  }
 }
 @Test public void walletRoutesAndNativePaymentActionsAreUnavailableInProduction() throws Exception {
  Assume.assumeFalse("Qualify the packaged production policy",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   ready(s);
   String original=new org.json.JSONTokener(eval(s,"location.href")).nextValue().toString();Throwable primary=null;
   try{
    eval(s,"setTimeout(()=>location.replace(location.origin+'/?mode=dev&start=wallet'),0);true");
    waitFor(s,"location.search==='?mode=dev&start=wallet' && document.documentElement.dataset.activeView==='home' && document.querySelector('[data-screen]')",15000);
    assertEquals("Wallet startup route cannot enable developer fixtures","true",eval(s,"document.documentElement.dataset.connectionMode==='live'"));
    assertEquals("Wallet has no Home entry","true",eval(s,"!("+button("Wallet")+")"));accessible("Wallet",false);
    assertEquals("No Wallet payment surface rendered","true",eval(s,"!document.querySelector('[aria-label=\"Pay\"],[aria-label=\"Add card\"]')"));
    java.util.concurrent.atomic.AtomicInteger launches=new java.util.concurrent.atomic.AtomicInteger();
    android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();
    android.app.Instrumentation.ActivityMonitor monitor=new android.app.Instrumentation.ActivityMonitor(){
     @Override public android.app.Instrumentation.ActivityResult onStartActivity(android.content.Intent intent){launches.incrementAndGet();return new android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_CANCELED,null);}
    };
    instrumentation.addMonitor(monitor);
    try{
     eval(s,"window.__walletNativeProbe=null;Promise.all([Capacitor.Plugins.DailyApps.capabilities(),...['wallet','pay','wallet_pay'].map(action=>Capacitor.Plugins.DailyApps.perform({action}))]).then(value=>window.__walletNativeProbe=value)");
     waitFor(s,"Array.isArray(window.__walletNativeProbe)",10000);
     assertEquals("No native Wallet or payment capability and every direct invocation refused","true",eval(s,"!window.__walletNativeProbe[0].actions.some(x=>['wallet','pay','wallet_pay'].includes(x.action))&&window.__walletNativeProbe.slice(1).every(x=>x.status==='failed')"));
     instrumentation.waitForIdleSync();assertEquals("Rejected payment requests start no Android activity",0,launches.get());
     assertEquals("Native refusal leaves Home visible","\"home\"",eval(s,"document.documentElement.dataset.activeView"));
    }finally{instrumentation.removeMonitor(monitor);}
   }catch(Exception|Error failure){primary=failure;throw failure;}finally{
    try{eval(s,"setTimeout(()=>location.replace("+JSONObject.quote(original)+"),0);true");
     waitFor(s,"location.href==="+JSONObject.quote(original)+" && document.documentElement.dataset.activeView==='home'",15000);
    }catch(Exception|Error cleanup){if(primary!=null)primary.addSuppressed(cleanup);else throw cleanup;}
   }
  }
 }
 private boolean accessibleLabel(String label) {
  android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();
  if(root==null)return false;
  java.util.ArrayDeque<android.view.accessibility.AccessibilityNodeInfo> nodes=new java.util.ArrayDeque<>();nodes.add(root);
  while(!nodes.isEmpty()){
   android.view.accessibility.AccessibilityNodeInfo node=nodes.removeFirst();
   if(label.contentEquals(node.getText()==null?"":node.getText()) || label.contentEquals(node.getContentDescription()==null?"":node.getContentDescription()))return true;
   for(int i=0;i<node.getChildCount();i++){android.view.accessibility.AccessibilityNodeInfo child=node.getChild(i);if(child!=null)nodes.add(child);}
  }
  return false;
 }
 private void accessible(String label,boolean expected) {
  long end=SystemClock.elapsedRealtime()+10000;
  while(SystemClock.elapsedRealtime()<end){if(accessibleLabel(label)==expected)return;SystemClock.sleep(100);}
  assertEquals("Native accessibility label: "+label,expected,accessibleLabel(label));
 }
 @Test public void hiddenShellLayersCannotReceiveFocusOrAccessibilityNavigation() throws Exception {
  AppNavigation.assumeNoRequiredSignIn("Hidden shell layers");
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   ready(s);accessible("Inbox",true);accessible("Resize chat",false);
   assertEquals("Collapsed chat cannot take keyboard focus","true",eval(s,"(()=>{const b=document.querySelector('[aria-label=\"Resize chat\"]');b.focus();return document.activeElement!==b;})()"));
   open(s,"Notes");accessible("New note",true);accessible("Inbox",false);
   assertEquals("Covered Home cannot take keyboard focus","true",eval(s,"(()=>{const b="+button("Inbox")+";b.focus();return document.activeElement!==b;})()"));
   click(s,"Open conversation");accessible("Minimize chat",true);accessible("New note",false);
   assertEquals("Covered app cannot take keyboard focus","true",eval(s,"(()=>{const b="+button("New note")+";b.focus();return document.activeElement!==b;})()"));
   click(s,"Minimize chat");accessible("New note",true);accessible("Resize chat",false);
   home(s);accessible("Inbox",true);
  }
 }
 @Test public void referenceNoteEditorPersistsAndDeletesWithUndo() throws Exception {
  AppNavigation.assumeNoRequiredSignIn("Reference note editor");
  String title="Reference note "+UUID.randomUUID(),body="Written through the exact prototype editor.";
  try(BoundedActivityScenario<MainActivity>s=BoundedActivityScenario.launch(MainActivity.class)){
   ready(s);open(s,"Notes");click(s,"New note");fill(s,"Title",title);fill(s,"Note",body);click(s,"Back to notes");
   waitFor(s,button("Open "+title),10000);
   // The visible list is optimistic; prove the encrypted commit before killing its activity.
   waitFor(s,"("+note(title)+")?.body==="+JSONObject.quote(body),10000);
   s.recreate();ready(s);open(s,"Notes");click(s,"Open "+title);
   waitFor(s,"document.querySelector('textarea[aria-label=\"Note\"]').value==="+JSONObject.quote(body),10000);
   click(s,"Delete note");waitFor(s,"!("+note(title)+")",10000);
   String undo="[...document.querySelectorAll('button')].find(b=>b.textContent==='Undo'&&b.getClientRects().length&&b.closest('.drop')?.textContent.includes("+JSONObject.quote(title)+"))";
   waitFor(s,undo,10000);eval(s,"("+undo+").click()");waitFor(s,note(title),10000);
   click(s,"Open "+title);click(s,"Delete note");waitFor(s,"!("+note(title)+")",10000);
  }
 }
}
