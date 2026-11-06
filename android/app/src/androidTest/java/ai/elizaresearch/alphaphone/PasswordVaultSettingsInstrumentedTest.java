package ai.elizaresearch.alphaphone;

import android.content.ClipboardManager;
import android.content.Context;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.By;
import androidx.test.uiautomator.UiDevice;
import androidx.test.uiautomator.Until;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Settings > Password manager on a real emulator (MVP-29, LOOP-E): a fixture screen-lock PIN,
 * unlock through Android's device-credential prompt, a typed and a generated synthetic entry,
 * list and search, Show (Android's own surface) and Copy, Lock, the inactivity lock and the lock
 * on leaving. No secret may appear in the page DOM (markup, input values, local and session
 * storage) or in logcat. The agent view context is not read directly: it is built from page state,
 * which this test shows never holds the secret, and passwordSurfaceOpen withholds it on these pages
 * (a renderer unit, not checked here).
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --classes PasswordVaultSettings
 * passwordVault=1 is the runner's gate: the class sets and clears a screen-lock PIN, so it runs only
 * on an owned, disposable emulator with no screen lock of its own. Synthetic values only. */
@RunWith(AndroidJUnit4.class)
public class PasswordVaultSettingsInstrumentedTest {
 private static String eval(String js) throws Exception { return WebViewTestDriver.evaluate(js); }
 private static void until(String condition, String message, int tenths) throws Exception {
  for (int i = 0; i < tenths; i++) { if ("true".equals(eval("!!(" + condition + ")"))) return; SystemClock.sleep(100); }
  fail(message);
 }
 private static void until(String condition, String message) throws Exception { until(condition, message, 200); }
 /** A control by accessible name (aria-label, else its text), visible and enabled. */
 private static String control(String name) {
  return "[...document.querySelectorAll('[data-screen] button,[data-screen] [role=button]')].find(b=>((b.getAttribute('aria-label')||b.textContent||'').trim()===" + JSONObject.quote(name) + ")&&b.getClientRects().length&&!b.disabled&&!b.closest('[inert]'))";
 }
 private static void press(String name) throws Exception { until(control(name), "Missing control " + name); eval("(" + control(name) + ").click()"); }
 private static String field(String label) {
  return "[...document.querySelectorAll('[data-screen] input')].find(e=>(e.getAttribute('aria-label')===" + JSONObject.quote(label) + "||e.placeholder===" + JSONObject.quote(label) + ")&&e.getClientRects().length&&!e.closest('[inert]'))";
 }
 private static void type(String label, String value) throws Exception {
  until(field(label), "Missing field " + label);
  eval("(()=>{const e=(" + field(label) + ");e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e," + JSONObject.quote(value) + ");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()");
 }
 /** The whole page, including attribute values and input values, must not hold the secret. */
 private static void assertNotInDom(String secret, String when) throws Exception {
  assertEquals("Secret absent from the page " + when, "false", eval("(()=>{const s=" + JSONObject.quote(secret) + ";return document.documentElement.outerHTML.includes(s)||[...document.querySelectorAll('input,textarea')].some(e=>e.value.includes(s))||JSON.stringify(localStorage).includes(s)||JSON.stringify(sessionStorage).includes(s)})()"));
 }
 private static void openPasswordManager() throws Exception {
  eval(AppNavigation.request("Settings"));
  until(AppNavigation.selected("Settings"), "Settings opens");
  press("Password manager");
  until(control("Unlock passwords") + "||" + control("Lock passwords"), "The Password manager page opens");
 }
 private static void unlock() throws Exception {
  press("Unlock passwords");
  PasswordVaultFixture.confirmDeviceCredential();
  until(control("Lock passwords"), "Unlocked through the device credential");
 }
 private static void addEntry(String name, String username, String website, String typedPassword) throws Exception {
  press("Add password");
  until("document.body.innerText.includes('New password')", "The new-password page opens");
  type("Name", name);
  type("Username", username);
  // The page refuses an entry with no website ("Add at least one website."); .invalid never resolves.
  type("Add website", website);
  if (typedPassword == null) press("Generate a strong password");
  else type("Password", typedPassword);
  press("Save");
  until(control("Open " + name), "The saved entry is listed: " + name);
 }

 @Test public void unlockAddListSearchRevealCopyAndLockWithoutLeakingSecrets() throws Exception {
  Assume.assumeTrue("Owned emulator campaign only: passwordVault=1 (sets a fixture screen lock)", "1".equals(InstrumentationRegistry.getArguments().getString("passwordVault")));
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
  String suffix = UUID.randomUUID().toString().substring(0, 8);
  String typedName = "Synthetic typed " + suffix, generatedName = "Synthetic generated " + suffix;
  String typedSecret = "SyntheticVault-" + UUID.randomUUID();
  long started = System.currentTimeMillis() / 1000L;
  try (PasswordVaultFixture lock = new PasswordVaultFixture();
       BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode();
   openPasswordManager();
   assertTrue("Locked until the owner confirms", "true".equals(eval("!!(" + control("Unlock passwords") + ")")));
   unlock();

   // A typed entry and a generated one.
   addEntry(typedName, "fixture@example.invalid", "typed-" + suffix + ".example.invalid", typedSecret);
   assertNotInDom(typedSecret, "after saving the typed entry");
   addEntry(generatedName, "", "generated-" + suffix + ".example.invalid", null);

   // List and search: metadata only.
   until(control("Open " + typedName) + "&&" + control("Open " + generatedName), "Both entries are listed");
   type("Search passwords", "generated " + suffix);
   until(control("Open " + generatedName) + "&&!" + control("Open " + typedName), "Search narrows to the generated entry");
   type("Search passwords", "");

   // Show: Android's own surface displays it; the page never receives it.
   press("Open " + typedName);
   until("document.body.innerText.includes('Edit password')", "The entry opens");
   press("Show password");
   assertTrue("Android shows the password outside the page", device.wait(Until.hasObject(By.text(typedSecret)), 10_000));
   assertNotInDom(typedSecret, "while Android shows it");
   device.pressBack();
   assertTrue("Android's reveal surface closed", device.wait(Until.gone(By.text(typedSecret)), 10_000));

   // Copy: the clipboard holds it (cleared shortly after), the page still does not.
   press("Copy password");
   until("document.body.innerText.includes('Copied.')", "Copy is confirmed");
   AtomicReference<String> clip = new AtomicReference<>();
   WebViewTestDriver.withActivity(MainActivity.class, activity -> {
    ClipboardManager clipboard = activity.getSystemService(ClipboardManager.class);
    clip.set(clipboard.hasPrimaryClip() && clipboard.getPrimaryClip().getItemCount() > 0 ? String.valueOf(clipboard.getPrimaryClip().getItemAt(0).getText()) : null);
   });
   assertEquals("Copy places exactly the saved password on the clipboard", typedSecret, clip.get());
   assertNotInDom(typedSecret, "after Copy");
   WebViewTestDriver.withActivity(MainActivity.class, activity -> activity.getSystemService(ClipboardManager.class).clearPrimaryClip());
   eval("[...document.querySelectorAll('[data-screen] button')].find(b=>b.getAttribute('aria-label')==='Back to Password manager')?.click()");

   // Lock.
   press("Lock passwords");
   until(control("Unlock passwords") + "&&!" + control("Open " + typedName), "Lock hides the list");

   // Expiry: the vault locks when its unlock window ends, whatever the input.
   unlock();
   until(control("Unlock passwords") + "&&document.body.innerText.includes('Locked after the unlock time ended.')", "The vault locks when the unlock window ends", 900);

   // Leaving the Password manager locks it.
   unlock();
   eval("[...document.querySelectorAll('[data-screen] button')].find(b=>b.getAttribute('aria-label')==='Back to Settings')?.click()");
   until("!(" + control("Lock passwords") + ")", "Settings is shown again");
   press("Password manager");
   until(control("Unlock passwords"), "Returning finds the vault locked");

   // What the agent may observe is built from this page's state, which never held the secret;
   // the password pages are also marked sensitive, so no view context is sent while they are open.
   assertNotInDom(typedSecret, "at the end");
   String log = PasswordVaultFixture.logcatSince(started);
   assertFalse("No secret in logcat", log.contains(typedSecret));
  }
 }
}
