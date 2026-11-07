package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

/** Ordinary APK denial only. No call, message, role selection or image admission is performed. */
public final class ImageCapabilitiesInstrumentedTest {
 private static void until(String expression)throws Exception{
  long end=SystemClock.elapsedRealtime()+15000;
  while(SystemClock.elapsedRealtime()<end){if("true".equals(WebViewTestDriver.evaluate("Boolean("+expression+")")))return;SystemClock.sleep(50);}
  throw new AssertionError("Image capability fixture did not settle");
 }
 @Test public void ordinaryApkRejectsTelephonyRolesAndOwnedDialerHandoffs()throws Exception{
  org.junit.Assume.assumeFalse("Production policy build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  assertFalse("Ordinary APK has no admitted image capability",AlphaImageCapabilities.aospImage(InstrumentationRegistry.getInstrumentation().getTargetContext()));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();until("window.Capacitor?.Plugins?.DeviceApps");
   Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();java.util.concurrent.atomic.AtomicInteger launches=new java.util.concurrent.atomic.AtomicInteger();
   Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){launches.incrementAndGet();return new Instrumentation.ActivityResult(Activity.RESULT_CANCELED,null);}};
   instrumentation.addMonitor(monitor);
   try{
    WebViewTestDriver.evaluate("window.__imageProbe=null;(async()=>{const p=Capacitor.Plugins;const reject=async f=>{try{await f();return 'ACCEPTED'}catch(e){return String(e.message)}};return {caps:await p.DeviceApps.platformCapabilities(),roles:await p.ElizaSystem.getStatus(),denials:await Promise.all([()=>p.ElizaSystem.resolveDefaultApp({role:'dial'}),()=>p.ElizaSystem.openDefaultApp({role:'dial'}),()=>p.ElizaSystem.requestRole({role:'dialer'}),()=>p.ElizaSystem.requestRole({role:'sms'})].map(reject)),actions:await p.DailyApps.capabilities(),legacy:await Promise.all(['phone','messages','contacts'].map(action=>p.DailyApps.perform({action})))}})().then(v=>window.__imageProbe=v,e=>window.__imageProbe={failure:String(e.message)})");
    until("window.__imageProbe!==null");
    assertEquals("Native admission, shortcuts, roles and legacy actions all fail closed","true",WebViewTestDriver.evaluate("(()=>{const r=window.__imageProbe;return !r.failure&&r.caps.aospImage===false&&['phone','contacts','sms'].every(k=>r.caps[k]===false)&&!r.roles.roles.some(x=>['dialer','sms'].includes(x.role))&&r.denials.every(x=>/unavailable in this product/.test(x))&&!r.actions.actions.some(x=>['phone','messages','contacts'].includes(x.action))&&r.legacy.every(x=>x.status==='failed')})()"));
    assertEquals("Ordinary APK denies Contacts reads, permissions and editor dispatch", "true", WebViewTestDriver.evaluate("window.__contactDeny=null;Promise.all(['list','requestPermissions','create','edit'].map(async method=>{try{await Capacitor.Plugins.AlphaContacts[method]({});return false}catch{return true}})).then(r=>window.__contactDeny=r.every(Boolean));true"));
    until("window.__contactDeny===true");
    instrumentation.waitForIdleSync();assertEquals("No Android activity dispatched for denied roles or handoffs",0,launches.get());
   }finally{instrumentation.removeMonitor(monitor);}
  }
 }
 @Test public void ordinaryApkCannotEnablePhoneContactsOrSmsWithDeveloperRoutes()throws Exception{
  org.junit.Assume.assumeFalse("Production policy build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();until("document.documentElement.dataset.activeView==='home'");
   for(String view:new String[]{"phone","contacts","messages"}){
    String query="?mode=dev&start="+view;
    WebViewTestDriver.evaluate("setTimeout(()=>location.replace(location.origin+"+JSONObject.quote(query)+"),0);true");
    until("location.search==="+JSONObject.quote(query)+"&&document.documentElement.dataset.activeView==='home'&&document.documentElement.dataset.connectionMode==='live'");
    assertEquals("No product Phone/Contacts/SMS entry in either distribution","true",WebViewTestDriver.evaluate("![...document.querySelectorAll('button')].some(b=>['Phone','Contacts','Messages'].includes((b.getAttribute('aria-label')||b.textContent||'').trim()))"));
   }
  }
 }
}
