package ai.elizaresearch.alphaphone;

import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.BySelector;
import androidx.test.uiautomator.StaleObjectException;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.UiObject2;
import androidx.test.uiautomator.Until;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import static org.junit.Assert.*;

/** Shared emulator setup for the password vault classes: a synthetic screen-lock PIN that the
 * classes set and always clear, and Android's own device-credential prompt answered with it.
 * Disposable owned emulators only; the PIN is a fixture value, never a real credential. */
final class PasswordVaultFixture implements AutoCloseable {
 /** Fixture PIN for the disposable emulator's screen lock; removed again by close(). */
 static final String PIN = "1357";
 private static final Pattern PROMPT_PACKAGES = Pattern.compile("com\\.android\\.(systemui|settings)");
 /** The credential entry field of Android's prompt: BiometricPrompt's credential view in SystemUI
  * (id lockPassword) or Settings' ConfirmDeviceCredential (id password_entry). The status bar and
  * shade are SystemUI too, so the package alone never shows that a prompt is open. */
 private static final BySelector CREDENTIAL_FIELD = By.res(Pattern.compile("com\\.android\\.systemui:id/lockPassword|com\\.android\\.settings:id/password_entry"));
 /** Fallback for a prompt layout with other ids: a focused text field owned by SystemUI or Settings. */
 private static final BySelector FOCUSED_PROMPT_FIELD = By.pkg(PROMPT_PACKAGES).clazz("android.widget.EditText").focused(true);
 private boolean set;

 static String shell(String command) throws Exception {
  try (InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command))) {
   return new String(input.readAllBytes(), StandardCharsets.UTF_8).trim();
  }
 }
 /** Sets the screen-lock PIN, refusing an emulator that already has a screen lock it does not own. */
 PasswordVaultFixture() throws Exception {
  // With no credential set, verifying an empty one succeeds; an existing lock is never replaced.
  String existing = shell("locksettings verify");
  assertTrue("The emulator already has a screen lock this test does not own: " + existing, existing.contains("verified successfully"));
  String result = shell("locksettings set-pin " + PIN);
  set = true;
  // A constructor that throws is never closed by try-with-resources: clear the PIN here.
  try { assertTrue("Fixture PIN set: " + result, shell("locksettings verify --old " + PIN).contains("verified successfully")); }
  catch (Throwable failed) { close(); throw failed; }
 }
 private static UiDevice device() { return UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()); }
 private static UiObject2 credentialField() {
  UiDevice device = device();
  UiObject2 field = device.findObject(CREDENTIAL_FIELD);
  return field != null ? field : device.findObject(FOCUSED_PROMPT_FIELD);
 }
 /** Waits up to timeoutMs for Android's device-credential prompt to show its entry field. */
 static boolean credentialPromptShown(long timeoutMs) {
  long deadline = SystemClock.uptimeMillis() + timeoutMs;
  do { if (credentialField() != null) return true; SystemClock.sleep(100); } while (SystemClock.uptimeMillis() < deadline);
  return false;
 }
 private static boolean credentialPromptGone(long timeoutMs) {
  long deadline = SystemClock.uptimeMillis() + timeoutMs;
  do { if (credentialField() == null) return true; SystemClock.sleep(100); } while (SystemClock.uptimeMillis() < deadline);
  return false;
 }
 /** Answers Android's device-credential prompt with the fixture PIN and waits for it to close.
  * The PIN goes in only once the prompt's own entry field holds input focus: the prompt binds the
  * field's credential type after it opens, and keys typed before that are lost, which a wrong-PIN
  * verify then rejects. A wrong attempt (text lost to a late rebind) is retried, at most three
  * times, well under the lock-screen throttle. Where the caller's activity lands afterwards is the
  * caller's assertion: a save sheet finishes itself, an unlocked page stays. */
 static void confirmDeviceCredential() throws Exception {
  UiDevice device = device();
  assertTrue("Android's device-credential prompt appeared", credentialPromptShown(10_000));
  for (int attempt = 1; attempt <= 3; attempt++) {
   UiObject2 field = null;
   long deadline = SystemClock.uptimeMillis() + 10_000;
   while (SystemClock.uptimeMillis() < deadline) {
    field = credentialField();
    if (field == null) return; // closed already, e.g. by the previous attempt's late success
    try { if (field.isFocused()) break; } catch (StaleObjectException rebound) { /* re-find */ }
    SystemClock.sleep(100);
   }
   assertNotNull("The credential prompt's entry field is present", field);
   try { if (!field.isFocused()) continue; } catch (StaleObjectException rebound) { continue; }
   SystemClock.sleep(500); // let the prompt finish binding the PIN input type
   try { field.setText(PIN); }
   catch (StaleObjectException rebound) { continue; }
   device.pressEnter();
   if (credentialPromptGone(5_000)) return;
  }
  fail("The credential prompt closed after the PIN");
 }
 /** Logcat since the given epoch (seconds), app process only, for secret scans. */
 static String logcatSince(long epochSeconds) throws Exception {
  return shell("logcat -d -v epoch -T " + epochSeconds + ".000");
 }
 @Override public void close() throws Exception {
  if (set) shell("locksettings clear --old " + PIN);
  set = false;
 }
}
