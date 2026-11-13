package ai.alphacompute.alphaphone;

import ai.eliza.plugins.system.SystemShade;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Android's shade is the one notification and quick-settings surface (#416, #417). Launcher Home
 * asks Android to open it (a pull on empty Home, EXPAND_STATUS_BAR). Alpha draws no shade of its
 * own. AccessibilityInstrumentedTest drives the pull on Home. Emulator evidence only; not
 * AOSP-image, Pixel 10a or TalkBack acceptance.
 */
@RunWith(AndroidJUnit4.class)
public class SystemShadeInstrumentedTest {
 private static Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }

 /** A status bar stand-in with Android's method name, for the outcome mapping only. */
 public static final class FakeStatusBar { public int calls; public void expandNotificationsPanel() { calls++; } }
 public static final class RefusingStatusBar { public void expandNotificationsPanel() { throw new SecurityException("refused"); } }
 private static SystemShade.Platform platform(boolean granted, Object service) {
  return new SystemShade.Platform() {
   @Override public boolean granted(String permission) { return granted && SystemShade.PERMISSION.equals(permission); }
   @Override public Object statusBar() { return service; }
  };
 }

 @Test public void everyOutcomeIsReportedAndOnlyAnAcceptedCallIsOpened() {
  FakeStatusBar bar = new FakeStatusBar();
  assertEquals(SystemShade.PERMISSION_MISSING, SystemShade.expand(platform(false, bar), true));
  assertEquals(0, bar.calls);
  assertEquals(SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, null), true));
  assertEquals("A service without the method", SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, new Object()), true));
  assertEquals("A refused call", SystemShade.UNSUPPORTED, SystemShade.expand(platform(true, new RefusingStatusBar()), true));
  assertEquals(SystemShade.OPENED, SystemShade.expand(platform(true, bar), true));
  assertEquals(1, bar.calls);
 }

 @Test public void theLauncherDeclaresAndHoldsExpandStatusBar() throws Exception {
  PackageInfo info = context().getPackageManager().getPackageInfo(context().getPackageName(), PackageManager.GET_PERMISSIONS);
  boolean declared = info.requestedPermissions != null && Arrays.asList(info.requestedPermissions).contains(SystemShade.PERMISSION);
  assertTrue("The launcher declares EXPAND_STATUS_BAR", declared);
  boolean granted = context().checkSelfPermission(SystemShade.PERMISSION) == PackageManager.PERMISSION_GRANTED;
  assertTrue("The install-time permission is held", granted);
 }

}
