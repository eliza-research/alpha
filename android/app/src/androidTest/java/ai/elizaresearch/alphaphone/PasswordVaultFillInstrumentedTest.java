package ai.elizaresearch.alphaphone;

import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.text.InputType;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.BySelector;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Alpha's vault as the Android Autofill service (AP-10): with a fixture screen-lock PIN, Alpha is
 * selected as the service, a synthetic sign-in is saved through Android's Save prompt from a native
 * form in the test package (PasswordFillFixtureActivity, its own package and signer), and then:
 * filled only into that exact package after the device credential; not offered to a form in
 * another package (Alpha's own, hosted over MainActivity); the fill sheet's Cancel leaves the form
 * empty; and after the vault locks, a fill asks for the credential again.
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --classes PasswordVaultFill
 * passwordVaultFill=1 is the runner's gate. The class sets and clears a screen-lock PIN and the
 * secure autofill_service setting and restores what it found. The second package is Alpha itself
 * because the instrumentation APK holds one package; a third-party package needs a companion APK.
 * Synthetic values only; emulator evidence, not device acceptance. */
@RunWith(AndroidJUnit4.class)
public class PasswordVaultFillInstrumentedTest {
 private static final String SERVICE = BuildConfig.APPLICATION_ID + "/ai.eliza.plugins.passwords.ElizaPasswordAutofillService";
 private static final String TEST_PACKAGE = BuildConfig.APPLICATION_ID + ".test";
 private static final String FILL_OFFER = "Fill with a saved password";
 private final UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());

 private void launchForm() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getContext();
  context.startActivity(new Intent().setComponent(new ComponentName(TEST_PACKAGE, PasswordFillFixtureActivity.class.getName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK));
  assertTrue("The fixture form opened", device.wait(Until.hasObject(By.desc(PasswordFillFixtureActivity.USERNAME)), 10_000));
 }
 private UiObject2 find(BySelector selector, String message) {
  UiObject2 found = device.wait(Until.findObject(selector), 10_000);
  assertNotNull(message, found);
  return found;
 }
 private String status() { return find(By.desc(PasswordFillFixtureActivity.STATUS), "Fixture status").getText(); }
 /** Focus the username field and wait for Alpha's authentication-gated dataset. */
 private UiObject2 offer() {
  find(By.desc(PasswordFillFixtureActivity.USERNAME), "Username field").click();
  return device.wait(Until.findObject(By.text(FILL_OFFER)), 10_000);
 }

 @Test public void saveFillOnlyExactPackageRefuseAnotherCancelAndLock() throws Exception {
  Assume.assumeTrue("Owned emulator campaign only: passwordVaultFill=1 (sets a screen lock and the autofill service)", "1".equals(InstrumentationRegistry.getArguments().getString("passwordVaultFill")));
  String previous = PasswordVaultFixture.shell("settings get secure autofill_service");
  String username = "fixture-" + UUID.randomUUID().toString().substring(0, 8) + "@example.invalid", secret = "SyntheticFill-" + UUID.randomUUID();
  long started = System.currentTimeMillis() / 1000L;
  try (PasswordVaultFixture lock = new PasswordVaultFixture()) {
   PasswordVaultFixture.shell("settings put secure autofill_service " + SERVICE);
   assertEquals("Alpha is the selected Autofill service", SERVICE, PasswordVaultFixture.shell("settings get secure autofill_service"));

   // Save: the form commits by finishing; Android offers Save; Alpha's save sheet confirms with the credential.
   launchForm();
   find(By.desc(PasswordFillFixtureActivity.USERNAME), "Username field").setText(username);
   find(By.desc(PasswordFillFixtureActivity.PASSWORD), "Password field").setText(secret);
   find(By.text(PasswordFillFixtureActivity.SIGN_IN), "Sign in").click();
   find(By.res("android", "autofill_save_yes"), "Android's Save prompt").click();
   assertTrue("Alpha's save sheet opens", device.wait(Until.hasObject(By.pkg(BuildConfig.APPLICATION_ID).text(Pattern.compile("(Save|Update saved) password\\?"))), 10_000));
   find(By.pkg(BuildConfig.APPLICATION_ID).text("Save"), "Save in Alpha's sheet").click();
   // Saving always asks for the device credential (PasswordSaveActivity.save).
   PasswordVaultFixture.confirmDeviceCredential();
   assertTrue("Saved", device.wait(Until.hasObject(By.text("Password saved")), 10_000) || device.wait(Until.gone(By.pkg(BuildConfig.APPLICATION_ID).text("Save")), 5_000));

   // Fill into the exact package and signer it was saved for, after the device credential.
   launchForm();
   UiObject2 offered = offer();
   assertNotNull("Alpha offers a fill to the package the password was saved for", offered);
   offered.click();
   // Every fill authenticates in the picker; no earlier unlock is reused.
   PasswordVaultFixture.confirmDeviceCredential();
   find(By.text(username), "The saved sign-in is listed for this package").click();
   String expected = PasswordFillFixtureActivity.expectedStatus(username, secret);
   for (int i = 0; i < 50 && !expected.equals(status()); i++) SystemClock.sleep(100);
   assertEquals("Both fields were filled with the saved values", expected, status());

   // Cancel: the fill sheet's Cancel fills nothing.
   launchForm();
   UiObject2 again = offer();
   assertNotNull("Offered again", again);
   again.click();
   PasswordVaultFixture.confirmDeviceCredential();
   find(By.pkg(BuildConfig.APPLICATION_ID).text("Cancel"), "Cancel in the fill sheet").click();
   SystemClock.sleep(1000);
   assertEquals("Cancel leaves the form empty", "user=;password=empty", status());

   // Another package: a native form in Alpha's own package is never offered this sign-in.
   try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
    AtomicReference<AlertDialog> dialog = new AtomicReference<>();
    WebViewTestDriver.withActivity(MainActivity.class, activity -> {
     LinearLayout form = new LinearLayout(activity);form.setOrientation(LinearLayout.VERTICAL);
     EditText user = new EditText(activity);user.setContentDescription("Other package username");user.setAutofillHints(View.AUTOFILL_HINT_USERNAME);
     EditText pass = new EditText(activity);pass.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);pass.setAutofillHints(View.AUTOFILL_HINT_PASSWORD);
     form.addView(user);form.addView(pass);
     dialog.set(new AlertDialog.Builder(activity).setView(form).show());
    });
    find(By.desc("Other package username"), "Other package form").click();
    assertFalse("No fill is offered to a different package", device.wait(Until.hasObject(By.text(FILL_OFFER)), 5_000));
    WebViewTestDriver.withActivity(MainActivity.class, activity -> dialog.get().dismiss());
   }

   // Lock: once the unlock window has passed, a fill asks for the device credential again.
   SystemClock.sleep(65_000);
   launchForm();
   UiObject2 locked = offer();
   assertNotNull("Offered while locked (authentication-gated)", locked);
   locked.click();
   assertTrue("A locked vault asks for the device credential before listing sign-ins", PasswordVaultFixture.credentialPromptShown(10_000));
   device.pressBack();
   assertFalse("No secret in logcat", PasswordVaultFixture.logcatSince(started).contains(secret));
  } finally {
   if (previous == null || previous.isEmpty() || "null".equals(previous)) PasswordVaultFixture.shell("settings delete secure autofill_service");
   else PasswordVaultFixture.shell("settings put secure autofill_service " + previous);
  }
 }
}
