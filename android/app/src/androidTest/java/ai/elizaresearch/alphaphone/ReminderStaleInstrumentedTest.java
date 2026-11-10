package ai.elizaresearch.alphaphone;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
/** Explicit bridge rejection fixture followed by real native retry; not a storage-failure claim. */
@RunWith(AndroidJUnit4.class)
public final class ReminderStaleInstrumentedTest {
 private String js(String code)throws Exception{return WebViewTestDriver.evaluate(code);}
 private void until(String code)throws Exception{for(int i=0;i<200;i++){if("true".equals(js("Boolean("+code+")")))return;SystemClock.sleep(100);}fail("Reminder stale condition: "+code);}
 @Test public void injectedReadRejectionPersistsUntilActualNativeRetry()throws Exception{
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();js(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));
   js("(()=>{const c=window.Capacitor;window.__reminderReadFixture={original:c.nativePromise,fail:true,rejected:0,nativeReads:0};c.nativePromise=function(plugin,method,options){const f=window.__reminderReadFixture;if(plugin==='DailyApps'&&method==='listReminders'){if(f.fail){f.rejected++;return Promise.reject(new Error('Injected test transport rejection'));}f.nativeReads++;}return f.original.call(this,plugin,method,options);};})()");
   try{
    WebViewTestDriver.withActivity(MainActivity.class,a->{try{Object plugin=a.getBridge().getPlugin("DailyApps").getInstance();java.lang.reflect.Method method=com.getcapacitor.Plugin.class.getDeclaredMethod("notifyListeners",String.class,com.getcapacitor.JSObject.class);method.setAccessible(true);method.invoke(plugin,"appResumed",new com.getcapacitor.JSObject());}catch(Exception e){throw new AssertionError(e);}});
    until("window.__reminderReadFixture.rejected>0");until("document.querySelector('[aria-label=\"Retry calendar and reminders\"]')?.textContent.includes('Reminders may be out of date')");
    SystemClock.sleep(5000);assertEquals("Warning outlives transient toast","true",js("!!document.querySelector('[aria-label=\"Retry calendar and reminders\"]')"));
    js(AppNavigation.request("Notes"));until(AppNavigation.selected("Notes"));js(AppNavigation.request("Calendar"));until(AppNavigation.selected("Calendar"));until("document.querySelector('[aria-label=\"Retry calendar and reminders\"]')?.textContent.includes('Reminders may be out of date')");
    js("window.__reminderReadFixture.fail=false;document.querySelector('[aria-label=\"Retry calendar and reminders\"]').click()");
    until("window.__reminderReadFixture.nativeReads>0");until("!document.querySelector('[aria-label=\"Retry calendar and reminders\"]')?.textContent.includes('Reminders may be out of date')");
   }finally{js("(()=>{const f=window.__reminderReadFixture;if(f)window.Capacitor.nativePromise=f.original;delete window.__reminderReadFixture;})()");}
  }
 }
}
