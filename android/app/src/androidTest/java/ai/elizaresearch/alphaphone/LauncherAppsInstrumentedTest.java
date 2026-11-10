package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.system.SystemLauncherApps;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.List;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Alpha's use of upstream {@link SystemLauncherApps} (elizaOS/eliza#35909), which ElizaSystem
 * (AlphaSystemPlugin) lists and launches through, against the device's own package manager, under
 * Alpha's package-visibility queries and identity. Resolves only:
 * nothing is launched, installed, removed or re-roled. Listing rules for synthetic candidates,
 * profile kinds and locked-profile wording are upstream's SystemLauncherAppsInstrumentedTest. A
 * device with a work profile, a paused profile and real add/remove is separate acceptance. */
@RunWith(AndroidJUnit4.class)
public class LauncherAppsInstrumentedTest {
 private static Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
 private static SystemLauncherApps.App ownUserEntry() {
  for (SystemLauncherApps.App app : SystemLauncherApps.list(context())) if (app.user == null) return app;
  return null;
 }

 @Test public void aListedEntryResolvesToExactlyItsOwnComponent() throws Exception {
  List<SystemLauncherApps.App> apps = SystemLauncherApps.list(context());
  SystemLauncherApps.App own = null;
  for (SystemLauncherApps.App app : apps) {
   assertNotEquals("Alpha never lists itself", context().getPackageName(), app.packageName);
   assertNotNull("Every entry names its activity", app.activityName);
   assertSame("An entry is found by package, activity and user", app, SystemLauncherApps.find(apps, app.packageName, app.activityName, app.user));
   if (own == null && app.user == null) own = app;
  }
  Assume.assumeTrue("This image has at least one other launchable app", own != null);
  assertNull("Another profile's entry is a different identity", SystemLauncherApps.find(apps, own.packageName, own.activityName, "999999999"));
  assertFalse(own.locked);
  SystemLauncherApps.Target target = SystemLauncherApps.resolve(context(), own.packageName, own.activityName, null);
  assertEquals(new ComponentName(own.packageName, own.activityName), target.component);
  assertNull(target.user);
  Intent intent = SystemLauncherApps.launchIntent(target.component);
  assertEquals(Intent.ACTION_MAIN, intent.getAction());
  assertTrue(intent.hasCategory(Intent.CATEGORY_LAUNCHER));
  assertEquals("The launch is explicit, never resolved by label or by package default", target.component, intent.getComponent());
  assertTrue((intent.getFlags() & Intent.FLAG_ACTIVITY_NEW_TASK) != 0);
 }

 @Test public void staleOrUnknownEntriesAreRefusedWithAReason() throws Exception {
  try { SystemLauncherApps.resolve(context(), "org.example.alpha.not.installed", "org.example.alpha.not.installed.Main", null); fail("A removed package must not resolve"); }
  catch (SystemLauncherApps.Refusal refusal) { assertEquals(SystemLauncherApps.NOT_INSTALLED, refusal.code); assertFalse(refusal.getMessage().isEmpty()); }
  SystemLauncherApps.App own = ownUserEntry();
  Assume.assumeTrue("This image has at least one other launchable app", own != null);
  try { SystemLauncherApps.resolve(context(), own.packageName, own.activityName + "Gone", null); fail("A component that is no longer a launcher entry must not resolve"); }
  catch (SystemLauncherApps.Refusal refusal) { assertEquals(SystemLauncherApps.NO_LAUNCHER, refusal.code); }
  try { SystemLauncherApps.resolve(context(), own.packageName, own.activityName, "999999999"); fail("An unknown profile must not resolve"); }
  catch (SystemLauncherApps.Refusal refusal) { assertEquals(SystemLauncherApps.PROFILE_UNAVAILABLE, refusal.code); }
  try { SystemLauncherApps.resolve(context(), own.packageName, "android.app.AppDetailsActivity", null); fail("Android's app-details stand-in is not a launcher entry"); }
  catch (SystemLauncherApps.Refusal refusal) { assertEquals(SystemLauncherApps.NO_LAUNCHER, refusal.code); }
  for (String[] bad : new String[][] {{null, "x.Main"}, {"", "x.Main"}, {context().getPackageName(), "x.Main"}, {own.packageName, null}, {own.packageName, ""}, {own.packageName, own.activityName, "not-a-number"}}) {
   try { SystemLauncherApps.resolve(context(), bad[0], bad[1], bad.length > 2 ? bad[2] : null); fail("Malformed request must be rejected"); }
   catch (IllegalArgumentException expected) { assertEquals("Choose an installed app", expected.getMessage()); }
  }
 }

 @Test public void packageOnlyRefusalsUseUpstreamCodes() {
  PackageManager packages = context().getPackageManager();
  assertEquals(SystemLauncherApps.NOT_INSTALLED, SystemLauncherApps.explain(packages, "org.example.alpha.not.installed").code);
  // Alpha is installed and enabled; asked about as a launch target it simply has no entry here.
  assertEquals(SystemLauncherApps.NO_LAUNCHER, SystemLauncherApps.explain(packages, context().getPackageName()).code);
  assertEquals("The shared failure code is distinct from every refusal", "failed", SystemLauncherApps.FAILED);
  try { SystemLauncherApps.launchIntent(context(), context().getPackageName()); fail("Alpha never launches itself by package"); }
  catch (IllegalArgumentException expected) { assertEquals("Choose an installed app", expected.getMessage()); }
 }

 @Test public void aComponentOrProfileThatIsNotTextIsMalformedNotAbsent() throws Exception {
  com.getcapacitor.JSObject request = new com.getcapacitor.JSObject();
  request.put("packageName", "org.example.one"); request.put("activityName", "org.example.one.Main"); request.put("user", 10);
  assertTrue("A numeric profile must not be read as the current user", SystemLauncherApps.malformedText(request, "user"));
  assertFalse(SystemLauncherApps.malformedText(request, "activityName"));
  request.put("user", "10"); request.put("activityName", true);
  assertFalse(SystemLauncherApps.malformedText(request, "user"));
  assertTrue("A non-text activity must not fall back to the package default", SystemLauncherApps.malformedText(request, "activityName"));
  com.getcapacitor.JSObject legacy = new com.getcapacitor.JSObject();
  legacy.put("packageName", "org.example.one"); legacy.put("user", org.json.JSONObject.NULL);
  assertFalse("A package-only request stays valid", SystemLauncherApps.malformedText(legacy, "activityName"));
  assertFalse(SystemLauncherApps.malformedText(legacy, "user"));
  assertFalse(SystemLauncherApps.malformedText(null, "user"));
 }
}
