package ai.elizaresearch.alphaphone;

import static org.junit.Assert.*;
import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.runner.lifecycle.ActivityLifecycleMonitorRegistry;
import androidx.test.runner.lifecycle.Stage;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Explicit signed native-only recovery entry, never an app/JS endpoint.
 * Instrumentation and foreground Activity launch/finish may change lifecycle;
 * both need separate operator approval before this method is invoked. */
@RunWith(AndroidJUnit4.class)
public final class VideoCopyClosedFailureReviewInstrumentedTest {
 private static final class Result extends PluginCall {
  final CountDownLatch done=new CountDownLatch(1);volatile JSObject value;volatile String error;
  Result(){super(null,"NativeVideoPreservation","closed-failure-review","native-only",new JSObject());}
  @Override public void resolve(JSObject value){this.value=value;done.countDown();}
  @Override public void reject(String message){error=message;done.countDown();}
 }
 @Test public void preserveOnlyRootReviewedClosedFailureInOwningContext()throws Exception{
  Bundle args=InstrumentationRegistry.getArguments();
  Assume.assumeTrue("Explicit closed-failure and main lifecycle review required","1".equals(args.getString("videoCopyPreservation"))&&"1".equals(args.getString("approvedMainLifecycle")));
  String token=args.getString("operationId"),recordHash=args.getString("recordSHA256"),expectedUID=args.getString("expectedOwnerUID");
  assertNotNull(token);assertTrue(token.matches("video-[a-f0-9-]{36}"));assertNotNull(recordHash);assertTrue(recordHash.matches("[a-f0-9]{64}"));assertNotNull(expectedUID);
  assertEquals(Integer.parseInt(expectedUID),InstrumentationRegistry.getInstrumentation().getTargetContext().getApplicationInfo().uid);
  // Deliberately preserve browser tabs/history; ordinary launch() clears them.
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launchRetainingBrowserSession(MainActivity.class)){
   AtomicReference<AlphaPhotosPlugin> registered=new AtomicReference<>();long until=SystemClock.elapsedRealtime()+20000;
   while(registered.get()==null&&SystemClock.elapsedRealtime()<until){
    BoundedActivityScenario.main(()->{for(Activity activity:ActivityLifecycleMonitorRegistry.getInstance().getActivitiesInStage(Stage.RESUMED))if(activity instanceof MainActivity&&activity.hasWindowFocus()){
     Object plugin=((MainActivity)activity).getBridge().getPlugin("AlphaPhotos").getInstance();assertEquals(AlphaPhotosPlugin.class,plugin.getClass());registered.set((AlphaPhotosPlugin)plugin);
    }});if(registered.get()==null)SystemClock.sleep(50);
   }
   assertNotNull("Real registered foreground AlphaPhotosPlugin required",registered.get());Result call=new Result();
   BoundedActivityScenario.main(()->registered.get().preserveClosedVideoCopy(token,recordHash,call));
   assertTrue("Preservation outcome unknown; never rerun automatically",call.done.await(60,TimeUnit.SECONDS));assertNull(call.error,call.error);assertNotNull(call.value);assertEquals("preserved",call.value.getString("status"));assertEquals(token,call.value.getString("operationId"));
   assertEquals(token,call.value.getString("artifactId"));assertTrue(call.value.getString("sha256").matches("[a-f0-9]{64}"));assertTrue(call.value.getLong("bytes")>=0&&call.value.getLong("bytes")<=4L*1024*1024);assertFalse(call.value.has("path"));assertFalse(call.value.has("uri"));assertFalse(call.value.has("dataBase64"));
   // Exact artifact files remain private; the operator reads them only after
   // the single canonical JUnit outcome, under separate transfer admission.
  }
 }
}
