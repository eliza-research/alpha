package ai.elizaresearch.alphaphone;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Bounded UI dispatch: animated WebViews need not make the main queue idle.
 * Resolve the live Activity on each call so recreation cannot reuse a dead WebView. */
final class WebViewTestDriver {
 private WebViewTestDriver() {}
 static <T extends Activity> void withActivity(Class<T> type, java.util.function.Consumer<T> action) throws Exception {
  CountDownLatch done=new CountDownLatch(1);AtomicReference<Throwable> error=new AtomicReference<>();
  TestUiDispatch dispatch=TestUiDispatch.post(()->{
   try {
    T target=null;
    for(Stage stage:new Stage[]{Stage.RESUMED,Stage.STARTED,Stage.PAUSED,Stage.STOPPED}) {
     for(Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage)) {
      if(activity.getClass()==type&&!activity.isFinishing()&&!activity.isDestroyed()){target=type.cast(activity);break;}
     }
     if(target!=null)break;
    }
    if(target==null)throw new AssertionError("No live Activity of exact type "+type.getName());
    action.accept(target);
   }catch(Throwable failure){error.set(failure);}finally{done.countDown();}
  });
  dispatch.await(done,"Main thread action for "+type.getName());
  if(error.get()!=null)throw new AssertionError("Activity action failed for "+type.getName(),error.get());
 }
 static void cancelDocumentPicker() throws Exception {
  android.app.UiAutomation ui=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation();
  int presses=0;
  for(int attempt=0;attempt<10;attempt++){
   String activities;
   try(java.io.InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand("dumpsys activity activities"))){activities=new String(input.readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);}
   boolean picker=activities.lines().anyMatch(line->(line.contains("mResumedActivity")||line.contains("topResumedActivity"))&&(line.contains("documentsui")||line.contains("DocumentsActivity")));
   if(!picker){assertTrue("Picker cancellation used real Android Back",presses>0);return;}
   // DocumentsUI restores its previous search/folder. Back first dismisses the
   // IME/search or parent folder; repeat only while that real picker is resumed.
   pressBack();presses++;android.os.SystemClock.sleep(500);
  }
  throw new AssertionError("DocumentsUI remained open after bounded Back navigation");
 }
 static void pressBack() {
  android.app.UiAutomation ui=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation();
  long downTime=android.os.SystemClock.uptimeMillis();int code=android.view.KeyEvent.KEYCODE_BACK;
  android.view.KeyEvent down=new android.view.KeyEvent(downTime,downTime,android.view.KeyEvent.ACTION_DOWN,code,0,0,android.view.KeyCharacterMap.VIRTUAL_KEYBOARD,0,android.view.KeyEvent.FLAG_FROM_SYSTEM,android.view.InputDevice.SOURCE_KEYBOARD);
  boolean accepted=ui.injectInputEvent(down,true);
  // Release the same key even if Android rejected its down event.
  android.view.KeyEvent up=new android.view.KeyEvent(downTime,android.os.SystemClock.uptimeMillis(),android.view.KeyEvent.ACTION_UP,code,0,0,android.view.KeyCharacterMap.VIRTUAL_KEYBOARD,0,android.view.KeyEvent.FLAG_FROM_SYSTEM,android.view.InputDevice.SOURCE_KEYBOARD);
  boolean released=ui.injectInputEvent(up,true);
  assertTrue("Android accepted Back down",accepted);assertTrue("Android accepted Back up",released);
 }
 /** Dispatch one document-changing action; lost old-document JS callbacks are not readiness. */
 static void navigateHostDocument(String script,boolean requireLive)throws Exception {
  try(StartupDocumentProbe startup=new StartupDocumentProbe()){
   startup.expectNavigation();
   withActivity(MainActivity.class,a->a.getBridge().getWebView().evaluateJavascript(script,null));
   startup.awaitReady(requireLive);
  }
 }
 static String evaluate(String script) throws Exception {
  return evaluate(MainActivity.class, script, script);
 }
 static String evaluateSensitive(String script) throws Exception {
  return evaluate(MainActivity.class, script, "private connection input");
 }
 /** Select the exact requested surface, never a subclass or another live WebView. */
 static String evaluate(Class<? extends MainActivity> type, String script) throws Exception {
  return evaluate(type, script, script);
 }
 private static String evaluate(Class<? extends MainActivity> type, String script, String diagnostic) throws Exception {
  CountDownLatch done=new CountDownLatch(1);
  AtomicReference<String> answer=new AtomicReference<>();
  AtomicReference<Throwable> error=new AtomicReference<>();
  TestUiDispatch dispatch=TestUiDispatch.post(()->{
   try {
    MainActivity target=null;
    for(Stage stage:new Stage[]{Stage.RESUMED,Stage.STARTED,Stage.PAUSED,Stage.STOPPED}) {
     for(Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(stage)) {
      if(activity.getClass()==type&&!activity.isFinishing()&&!activity.isDestroyed()) {target=(MainActivity)activity;break;}
     }
     if(target!=null)break;
    }
    if(target==null)throw new AssertionError("No live exact Activity for WebView evaluation: "+type.getName());
    target.getBridge().getWebView().evaluateJavascript(script,value->{answer.set(value);done.countDown();});
   } catch(Throwable failure) {error.set(failure);done.countDown();}
  });
  dispatch.await(done,"WebView evaluation for: "+diagnostic);
  if(error.get()!=null)throw new AssertionError("WebView evaluation failed",error.get());
  assertNotNull("Missing WebView result",answer.get());return answer.get();
 }
}
