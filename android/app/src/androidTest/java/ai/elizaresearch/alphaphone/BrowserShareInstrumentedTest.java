package ai.elizaresearch.alphaphone;
import android.app.Instrumentation;
import android.content.Intent;
import android.os.SystemClock;
import android.view.KeyEvent;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;
/** Real public HTTPS document -> Android chooser; cancels without selecting a recipient. */
public final class BrowserShareInstrumentedTest {
 private final BrowserFlowInstrumentedTest browser=new BrowserFlowInstrumentedTest();
 private String js(String value)throws Exception{return WebViewTestDriver.evaluate(value);}
 private void ready(String predicate)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+predicate+")")))return;SystemClock.sleep(100);}fail("Browser share control/state missing");}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";ready(q);js("("+q+").click()");}
 private void app(String label)throws Exception{js(AppNavigation.request(label));ready(AppNavigation.selected(label));ready("window.__alphaTestNavigation?.status==='complete'");}
 private void address(String url)throws Exception{if("false".equals(js("!!document.querySelector('input[aria-label=Address]')")))click("Edit address");ready("document.querySelector('input[aria-label=Address]')");js("(()=>{const e=document.querySelector('input[aria-label=Address]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,"+JSONObject.quote(url)+");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()");for(int i=0;i<300;i++){if("true".equals(browser.child("location.href==="+JSONObject.quote(url)+"&&document.title==='Example Domain'&&document.readyState==='complete'"))){ready("document.querySelector('[role=img][aria-label=\"Secure connection\"]')");return;}SystemClock.sleep(100);}fail("Real HTTPS page missing");}
 private boolean foreground(String name)throws Exception{try(android.os.ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys activity activities");java.io.FileInputStream in=new java.io.FileInputStream(fd.getFileDescriptor());java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream()){byte[] chunk=new byte[4096];int n;while((n=in.read(chunk))!=-1){assertTrue(out.size()+n<2*1024*1024);out.write(chunk,0,n);}for(String line:new String(out.toByteArray(),java.nio.charset.StandardCharsets.UTF_8).split("\n"))if(line.contains("topResumedActivity")&&line.contains(name))return true;return false;}}
 private void foregroundWait(String name)throws Exception{for(int i=0;i<100;i++){if(foreground(name))return;SystemClock.sleep(100);}fail("Expected foreground Activity: "+name);}
 private void rejectOld()throws Exception{js("window.__shareRejected=null;window.__shareNative('AlphaBrowser','share',window.__shareArgs).then(()=>window.__shareRejected=false,()=>window.__shareRejected=true)");ready("window.__shareRejected!==null");assertEquals("Stale/hidden share rejected","true",js("window.__shareRejected"));}
 @Test public void exactCurrentPageChooserCancellationAndStalePageRejection()throws Exception{
  org.junit.Assume.assumeTrue("Explicit external HTTPS and Android chooser fixture", "1".equals(InstrumentationRegistry.getArguments().getString("browserShareLive")));
  Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();AtomicReference<Intent> outgoing=new AtomicReference<>();Instrumentation.ActivityMonitor monitor=new Instrumentation.ActivityMonitor(){@Override public Instrumentation.ActivityResult onStartActivity(Intent intent){if(Intent.ACTION_CHOOSER.equals(intent.getAction()))outgoing.set(new Intent(intent));return null;}};
  String url="https://example.com/?alpha_share="+UUID.randomUUID(),canary="private-browser-"+UUID.randomUUID(),key="alpha_share_"+UUID.randomUUID().toString().replace("-","");instrumentation.addMonitor(monitor);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   Throwable primary=null;boolean installed=false;try{
   AppNavigation.liveMode();app("Browser");address(url);browser.child("localStorage.setItem("+JSONObject.quote(key)+","+JSONObject.quote(canary)+");document.cookie='"+key+"="+canary+"; Secure; Path=/';true");installed=true;
   assertEquals("Website has no native bridge","true",browser.child("typeof Capacitor==='undefined'"));
   js("window.__shareNative=Capacitor.nativePromise;Capacitor.nativePromise=function(p,m,a){if(p==='AlphaBrowser'&&m==='share')window.__shareArgs={...a};return window.__shareNative.apply(this,arguments);}");
   try{
    click("Menu");click("Share");foregroundWait("ChooserActivity");assertNotNull(outgoing.get());Intent send=outgoing.get().getParcelableExtra(Intent.EXTRA_INTENT);assertNotNull(send);assertEquals(Intent.ACTION_SEND,send.getAction());assertEquals("text/plain",send.getType());assertEquals(url,send.getStringExtra(Intent.EXTRA_TEXT));assertEquals("Example Domain",send.getStringExtra(Intent.EXTRA_SUBJECT));assertEquals("Example Domain",send.getStringExtra(Intent.EXTRA_TITLE));assertNull(send.getComponent());assertNull(send.getPackage());assertNull(send.getData());assertNull(send.getParcelableExtra(Intent.EXTRA_STREAM));assertEquals(0,send.getFlags()&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION));assertFalse(send.hasExtra(Intent.EXTRA_EMAIL));assertFalse(send.getExtras().toString().contains(canary));
    instrumentation.sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);foregroundWait("MainActivity");for(int i=0;i<100;i++){if("true".equals(browser.child("location.href==="+JSONObject.quote(url)+"&&localStorage.getItem("+JSONObject.quote(key)+")==="+JSONObject.quote(canary))))break;SystemClock.sleep(100);}assertEquals("Exact child document survives chooser cancellation","true",browser.child("location.href==="+JSONObject.quote(url)+"&&localStorage.getItem("+JSONObject.quote(key)+")==="+JSONObject.quote(canary)));assertEquals("Host storage isolated","null",js("localStorage.getItem("+JSONObject.quote(key)+")"));
    outgoing.set(null);address(url+"-new");rejectOld();assertNull("Old document cannot launch chooser",outgoing.get());
    js("window.__shareCurrent=false;window.__shareNative('AlphaBrowser','command',{session:window.__shareArgs.session,id:window.__shareArgs.id,command:'stop'}).then(v=>{window.__shareArgs={session:v.session,id:v.id,url:v.url,navigation:v.navigation};window.__shareCurrent=true})");ready("window.__shareCurrent===true");
    app("Notes");rejectOld();assertNull("Hidden tab cannot launch chooser",outgoing.get());
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{try{js("if(window.__shareNative){Capacitor.nativePromise=window.__shareNative;delete window.__shareNative;delete window.__shareArgs;delete window.__shareRejected;delete window.__shareCurrent;}");}catch(Exception|AssertionError cleanupFailure){if(primary!=null)primary.addSuppressed(cleanupFailure);else throw cleanupFailure;}}
   }catch(Exception|AssertionError failure){primary=failure;throw failure;}finally{
    if(installed)try{
     assertTrue("Return to Alpha required for exact canary cleanup",foreground("MainActivity"));app("Browser");
     String cleanup="(()=>{if(location.origin!=='https://example.com')return false;const k="+JSONObject.quote(key)+",v="+JSONObject.quote(canary)+";if(localStorage.getItem(k)===v)localStorage.removeItem(k);if(document.cookie.split(';').some(c=>c.trim()===k+'='+v))document.cookie=k+'=; Max-Age=0; Secure; Path=/';return localStorage.getItem(k)===null&&!document.cookie.split(';').some(c=>c.trim().startsWith(k+'='));})()";
     String result="null";for(int i=0;i<100;i++){result=browser.child(cleanup);if("true".equals(result))break;SystemClock.sleep(100);}assertEquals("Only exact owned cookie/storage canaries removed","true",result);
    }catch(Exception|AssertionError cleanupFailure){if(primary!=null)primary.addSuppressed(cleanupFailure);else throw cleanupFailure;}
   }
  }finally{instrumentation.removeMonitor(monitor);}
 }
}
