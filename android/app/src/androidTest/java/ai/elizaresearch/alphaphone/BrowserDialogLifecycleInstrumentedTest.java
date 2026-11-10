package ai.elizaresearch.alphaphone;

import android.app.AlertDialog;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Actual product menu -> native dialog -> privileged document replacement.
 * No download is started and no existing history entry is changed. */
@RunWith(AndroidJUnit4.class)
public final class BrowserDialogLifecycleInstrumentedTest {
 private String host(String js)throws Exception{return WebViewTestDriver.evaluate(js);}
 private void ready(String js)throws Exception{for(int i=0;i<200;i++){if("true".equals(host("Boolean("+js+")")))return;SystemClock.sleep(100);}fail("Browser lifecycle control missing");}
 private void click(String label)throws Exception{String q="[...document.querySelectorAll('[data-screen] button')].find(e=>e.getAttribute('aria-label')==="+JSONObject.quote(label)+")";ready(q);host("("+q+").click()");}
 private void app(String label)throws Exception{host(AppNavigation.request(label));ready(AppNavigation.selected(label));ready("window.__alphaTestNavigation?.status==='complete'");}
 private AlertDialog listing()throws Exception{
  AtomicReference<AlertDialog> result=new AtomicReference<>();
  WebViewTestDriver.withActivity(MainActivity.class,activity->{try{
   Object plugin=activity.getBridge().getPlugin("AlphaBrowser").getInstance();java.lang.reflect.Field downloads=ai.eliza.plugins.browsersurface.BrowserTabHostPlugin.class.getDeclaredField("downloads");downloads.setAccessible(true);
   Object owner=downloads.get(plugin);java.lang.reflect.Field field=owner.getClass().getDeclaredField("listing");field.setAccessible(true);result.set((AlertDialog)field.get(owner));
  }catch(Exception failure){throw new AssertionError(failure);}});return result.get();
 }
 private AlertDialog openDownloads()throws Exception{
  app("Browser");click("Menu");click("Downloads");
  for(int i=0;i<150;i++){AlertDialog list=listing();if(list!=null){WebViewTestDriver.withActivity(MainActivity.class,a->assertTrue("Actual native Downloads dialog shown",list.isShowing()));return list;}SystemClock.sleep(100);}throw new AssertionError("Native Downloads dialog missing");
 }
 private void dismissed(AlertDialog old)throws Exception{
  for(int i=0;i<150;i++){if(listing()==null){WebViewTestDriver.withActivity(MainActivity.class,a->assertFalse("Prior native dialog is actually dismissed",old.isShowing()));return;}SystemClock.sleep(100);}fail("Native history dialog survived document replacement");
 }
 @Test public void nativeDownloadsDialogRetiresOnReloadAndMockEntry()throws Exception{
  org.junit.Assume.assumeTrue("Mock mode exists only in -PELIZA_DEV_ALLOW_TEST_MOCKS=1 builds",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();AlertDialog first=openDownloads();String origin=host("performance.timeOrigin");WebViewTestDriver.navigateHostDocument("location.reload()",true);
   ready("performance.timeOrigin!=="+origin+"&&document.documentElement.dataset.activeView==='home'");dismissed(first);
   AlertDialog second=openDownloads();
   // Exercise a host navigation arriving while the native dialog is showing;
   // this is an adversarial lifecycle transition, not a touch through a modal.
   app("Settings");click("Agent connection");ready("document.querySelector('.alpha-connection-scrim')");
   host("[...document.querySelectorAll('.alpha-connection summary')].find(e=>e.textContent==='Mock mode').click()");
   WebViewTestDriver.navigateHostDocument("[...document.querySelectorAll('.alpha-connection button')].find(e=>e.textContent.trim()==='Enter mock mode').click()",false);
   ready("document.documentElement.dataset.connectionMode==='mock'&&document.querySelector('.mock-mode-banner')");dismissed(second);
   WebViewTestDriver.navigateHostDocument("document.querySelector('.mock-mode-banner button').click()",true);ready("document.documentElement.dataset.connectionMode==='live'&&!document.querySelector('.mock-mode-banner')");
   AlertDialog third=openDownloads();WebViewTestDriver.withActivity(MainActivity.class,a->third.dismiss());dismissed(third);
  }
 }
}
