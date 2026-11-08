package ai.elizaresearch.alphaphone;

import ai.eliza.auth.cloud.CloudSignInEnvironment;
import ai.eliza.auth.cloud.CloudSignInPlugin;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import static org.junit.Assert.*;

/** Actual Android consent prompt on an isolated plugin instance. No session, account or network
 * is supplied. This proves the native gate, not authenticated login or remote key issuance.
 * Run only in the runner's owned disposable device/profile. */
public final class CloudSignInAuthorizationInstrumentedTest {
 private static Field field(Class<?> type,String name)throws Exception { Field f=type.getDeclaredField(name);f.setAccessible(true);return f; }
 @Test public void onlyExplicitAuthorizeReleasesTheNativeGate()throws Exception {
  UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)) {
   for(String choice:new String[]{"authorize","cancel","back","expired","retired"}) {
    AlphaCloudSignInPlugin plugin=new AlphaCloudSignInPlugin();
    WebViewTestDriver.withActivity(MainActivity.class,a->plugin.setBridge(a.getBridge()));
    Class<?> attemptType=Class.forName("ai.eliza.auth.cloud.CloudSignInPlugin$Attempt");
    Constructor<?> constructor=attemptType.getDeclaredConstructor(CloudSignInEnvironment.class,boolean.class);constructor.setAccessible(true);
    Object attempt=constructor.newInstance(AlphaCloudSignInPlugin.REGISTRATION.defaultEnvironment(),false);
    Field expires=field(attemptType,"expiresAt");expires.setLong(attempt,System.currentTimeMillis()+60000);
    Field owner=field(CloudSignInPlugin.class,"attempt");owner.set(plugin,attempt);
    Method gate=CloudSignInPlugin.class.getDeclaredMethod("requireAuthorization",attemptType);gate.setAccessible(true);
    // The shared client's teardown is protected in another package; the host lifecycle calls it.
    Method destroy=CloudSignInPlugin.class.getDeclaredMethod("handleOnDestroy");destroy.setAccessible(true);
    AtomicReference<Throwable> failure=new AtomicReference<>();
    Thread waiting=new Thread(()->{try{gate.invoke(plugin,attempt);}catch(InvocationTargetException error){failure.set(error.getCause());}catch(Throwable error){failure.set(error);}},"consent-gate-test");
    try {
     waiting.start();
     assertTrue("Native authorization prompt appears",device.wait(Until.hasObject(By.text("Authorize Alpha Phone")),10000));
     assertTrue("Showing the prompt does not authorize",waiting.isAlive());
     assertFalse(field(attemptType,"authorized").getBoolean(attempt));
     if("expired".equals(choice)) { synchronized(field(CloudSignInPlugin.class,"lock").get(plugin)) { expires.setLong(attempt,System.currentTimeMillis()-1); } }
     if("retired".equals(choice)) {
      Method cancel=attemptType.getDeclaredMethod("cancel");cancel.setAccessible(true);cancel.invoke(attempt);
     } else if("back".equals(choice)) device.pressBack();
     else {
      // AlertDialog button labels may be transformed to uppercase by the Android theme.
      // Select the platform's positive/negative control, not its presentation text.
      var button=device.wait(Until.findObject(By.res("android", "cancel".equals(choice)?"button2":"button1")),10000);
      assertNotNull("Native decision button appears for "+choice,button);
      button.click();
     }
     waiting.join(10000);
     assertFalse("Consent decision terminates the gate",waiting.isAlive());
     if("authorize".equals(choice)) assertNull(failure.get());
     else { assertTrue(failure.get() instanceof CloudSignInPlugin.SignInFailure);assertEquals("expired".equals(choice)?"expired":"cancelled",((CloudSignInPlugin.SignInFailure)failure.get()).code); }
    } finally {
     WebViewTestDriver.withActivity(MainActivity.class,a->{try{destroy.invoke(plugin);}catch(ReflectiveOperationException error){throw new AssertionError("Sign-in teardown failed",error);}});
     waiting.join(10000);
    }
    assertTrue("Native dialog is removed",device.wait(Until.gone(By.text("Authorize Alpha Phone")),10000));
   }
  }
 }
}
