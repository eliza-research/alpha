package ai.elizaresearch.alphaphone;

import ai.eliza.auth.cloud.CloudSignInFlow;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

/**
 * In-app Eliza Cloud sign-in return through the actual MainActivity and Capacitor bridge, with
 * owned synthetic links only. No Steward exchange, Cloud request, Google consent or account is
 * involved; an unexpired matching return is never delivered here, so no sign-in request is sent. This does
 * not show that Android verified the App Link: that is `adb shell pm get-app-links
 * ai.elizaresearch.alphaphone` on a device whose eliza.app assetlinks lists the installed signer.
 */
public final class CloudSignInCallbackInstrumentedTest {
 private static Context context() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
 private static Intent intent(String uri) { return new Intent(Intent.ACTION_VIEW, Uri.parse(uri), context(), MainActivity.class); }
 private static String callback(String state) { return "https://eliza.app/alphaphone/auth/callback#code=synthetic-unused-code&state=" + state; }
 private static void gate() { org.junit.Assume.assumeTrue("Explicit synthetic Cloud sign-in campaign", "1".equals(InstrumentationRegistry.getArguments().getString("cloudSignInNative"))); }
 private static AlphaCredentialStore store() { return new AlphaCredentialStore(context()); }
 private static void waitForRemoved(String slot) throws Exception {
  long deadline = SystemClock.elapsedRealtime() + 15000;
  while (SystemClock.elapsedRealtime() < deadline) { if (store().readCredentialSlot(slot) == null) return; SystemClock.sleep(100); }
  fail("Pending sign-in record was not burned");
 }

 private static void holdFor(long millis) { SystemClock.sleep(millis); }

 /** The return resolves to MainActivity only, at one exact path; eliza.app only in builds with ELIZAOS_APP_LINK_HOST=eliza.app. */
 @Test public void returnLinkResolvesOnlyToMainActivity() {
  PackageManager packages = context().getPackageManager();
  Intent link = new Intent(Intent.ACTION_VIEW, Uri.parse(callback(CloudSignInFlow.newState()))).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(context().getPackageName());
  List<ResolveInfo> matches = packages.queryIntentActivities(link, 0);
  if ("eliza.app".equals(BuildConfig.ELIZAOS_APP_LINK_HOST)) {
   assertEquals(1, matches.size());
   assertEquals(MainActivity.class.getName(), matches.get(0).activityInfo.name);
  } else assertTrue("A build without ELIZAOS_APP_LINK_HOST declares no production return", matches.isEmpty());
  for (String other : new String[]{"https://eliza.app/", "https://eliza.app/alphaphone/auth/callback/extra", "https://eliza.app/auth/callback", "https://api.eliza.app/alphaphone/auth/callback", "http://eliza.app/alphaphone/auth/callback"})
   assertTrue(other, packages.queryIntentActivities(new Intent(Intent.ACTION_VIEW, Uri.parse(other)).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(context().getPackageName()), 0).isEmpty());
  boolean staging = !packages.queryIntentActivities(new Intent(Intent.ACTION_VIEW, Uri.parse("https://staging.eliza.app/alphaphone/auth/callback")).addCategory(Intent.CATEGORY_BROWSABLE).setPackage(context().getPackageName()), 0).isEmpty();
  assertEquals("The staging return exists only in test-mocks builds", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS, staging);
 }

 /** A return whose state does not match is ignored: the pending record stays and nothing is stored (shared callback contract). */
 @Test public void mismatchingReturnLeavesPendingRecordAndStoresNothing() throws Exception {
  gate();
  String cloudBefore = store().readCredentialSlot("cloud:production");
  CloudSignInFlow.Pending pending = CloudSignInFlow.Pending.create(AlphaCloudSignInPlugin.REGISTRATION.defaultEnvironment(), System.currentTimeMillis());
  store().writeCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT, pending.serialize());
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(intent(callback(CloudSignInFlow.newState())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK))) {
   holdFor(3000);
   assertEquals("A foreign return cannot cancel a sign-in", pending.serialize(), store().readCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT));
   assertEquals("No key is written for a mismatching return", cloudBefore, store().readCredentialSlot("cloud:production"));
  } finally { store().removeCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT); }
 }

 /** The fallback page's parameterless hand-off carries no result: the pending record stays until expiry or a retry. */
 @Test public void parameterlessReturnKeepsPendingRecord() throws Exception {
  gate();
  String cloudBefore = store().readCredentialSlot("cloud:production");
  CloudSignInFlow.Pending pending = CloudSignInFlow.Pending.create(AlphaCloudSignInPlugin.REGISTRATION.defaultEnvironment(), System.currentTimeMillis());
  store().writeCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT, pending.serialize());
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(intent("https://eliza.app/alphaphone/auth/callback").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK))) {
   holdFor(3000);
   assertEquals(pending.serialize(), store().readCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT));
   assertEquals(cloudBefore, store().readCredentialSlot("cloud:production"));
  } finally { store().removeCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT); }
 }

 /** An expired record with the matching state is burned and never used. */
 @Test public void expiredPendingRecordIsNeverUsed() throws Exception {
  gate();
  String cloudBefore = store().readCredentialSlot("cloud:production");
  CloudSignInFlow.Pending expired = new CloudSignInFlow.Pending(AlphaCloudSignInPlugin.REGISTRATION.defaultEnvironment(), CloudSignInFlow.newState(), CloudSignInFlow.newVerifier(), System.currentTimeMillis() - 1);
  store().writeCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT, expired.serialize());
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(intent(callback(expired.state)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK))) {
   waitForRemoved(AlphaCloudSignInPlugin.PENDING_SLOT);
   assertEquals(cloudBefore, store().readCredentialSlot("cloud:production"));
   scenario.recreate();
   assertNull("A recreated activity does not replay the return", store().readCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT));
  } finally { store().removeCredentialSlot(AlphaCloudSignInPlugin.PENDING_SLOT); }
 }

 /** The renderer cannot read or write the native pending and receipt slots. */
 @Test public void signInSlotsAreNativeOnly() {
  for (String slot : new String[]{AlphaCloudSignInPlugin.PENDING_SLOT, AlphaCloudSignInPlugin.receiptSlot(AlphaCloudSignInPlugin.REGISTRATION.defaultEnvironment())}) {
   try { RendererCredentialSlots.requireAllowed(slot); fail(slot); } catch (SecurityException expected) { /* Native only. */ }
  }
 }
}
