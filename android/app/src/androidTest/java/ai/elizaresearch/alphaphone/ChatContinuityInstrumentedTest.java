package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** An unsent chat draft with the real soft keyboard: typed with the IME shown, it survives sheet and
 * full, real KEYCODE_BACK presses (the IME is dismissed, then full -> sheet -> rest), the HOME key
 * (launcher variant while Alpha is HOME) or backgrounding and resuming (otherwise), and an activity
 * recreation, which reads it back from the persisted draft. The composer stays within innerHeight
 * after each step and nothing is posted. Back and HOME are injected through UiAutomation.
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --classes ChatContinuity
 * Emulator evidence only; a phone's own keyboard and gesture navigation are device acceptance. */
@RunWith(AndroidJUnit4.class)
public class ChatContinuityInstrumentedTest {
 private static final String DRAFT = "Unsent continuity draft 4417";
 private static final String CONVERSATION = "document.querySelector('[data-alpha-layer=\"conversation\"]')";

 private static String eval(String js) throws Exception { return WebViewTestDriver.evaluate(js); }
 private static void until(String condition, String message) throws Exception {
  for (int i = 0; i < 200; i++) { if ("true".equals(eval("!!(" + condition + ")"))) return; SystemClock.sleep(100); }
  fail(message + ": " + eval("JSON.stringify({view:document.documentElement.dataset.activeView||null,chat:" + chatState() + "})"));
 }
 /** 'full', 'sheet' or 'rest', read from the conversation layer and its size control. */
 private static String chatState() {
  return "(()=>{const c=" + CONVERSATION + ";if(!c||c.getAttribute('aria-hidden')==='true'||c.getBoundingClientRect().height<1)return 'rest';"
   + "const b=[...c.querySelectorAll('button')].map(b=>b.getAttribute('aria-label'));return b.includes('Shrink chat')?'full':b.includes('Expand chat')?'sheet':'unknown';})()";
 }
 private static void awaitChat(String state) throws Exception { until(chatState() + "===" + JSONObject.quote(state), "Chat did not reach " + state); }
 private static void click(String label) throws Exception {
  String q = "[...document.querySelectorAll('[data-screen] button')].find(b=>b.getAttribute('aria-label')===" + JSONObject.quote(label) + "&&b.getClientRects().length&&!b.disabled&&!b.closest('[inert]'))";
  until(q, "Missing control " + label);
  eval("(" + q + ").click()");
 }
 private static void pressKey(int code) {
  android.app.UiAutomation ui = InstrumentationRegistry.getInstrumentation().getUiAutomation();
  long down = SystemClock.uptimeMillis();
  boolean accepted = ui.injectInputEvent(new KeyEvent(down, down, KeyEvent.ACTION_DOWN, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, KeyEvent.FLAG_FROM_SYSTEM, InputDevice.SOURCE_KEYBOARD), true);
  boolean released = ui.injectInputEvent(new KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, KeyEvent.FLAG_FROM_SYSTEM, InputDevice.SOURCE_KEYBOARD), true);
  assertTrue("Android accepted key " + code, accepted && released);
 }
 private static boolean imeVisible() throws Exception {
  AtomicBoolean shown = new AtomicBoolean();
  try {
   WebViewTestDriver.withActivity(MainActivity.class, activity -> {
    WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(activity.getWindow().getDecorView());
    shown.set(insets != null && insets.isVisible(WindowInsetsCompat.Type.ime()));
   });
  } catch (AssertionError noResumedActivity) { return false; }
  return shown.get();
 }
 private static void awaitIme(boolean visible, String message) throws Exception {
  for (int i = 0; i < 60; i++) { if (imeVisible() == visible) return; SystemClock.sleep(100); }
  fail(message);
 }
 /** Focus the visible composer and ask Android for the real soft keyboard. */
 static void showKeyboard() throws Exception {
  eval("(" + AppNavigation.composer() + ")?.focus()");
  SystemClock.sleep(200);
  WebViewTestDriver.withActivity(MainActivity.class, activity -> {
   android.view.inputmethod.InputMethodManager ime = (android.view.inputmethod.InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
   ime.showSoftInput(activity.getBridge().getWebView(), android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT);
  });
  awaitIme(true, "The real soft keyboard must be visible");
 }
 /** The visible composer holds the draft and it, with Send when shown, fits inside innerHeight. */
 static void assertComposer(String text, String when) throws Exception {
  String composer = AppNavigation.composer();
  until(composer + "&&(" + composer + ").value===" + JSONObject.quote(text), "Composer keeps the draft " + when);
  String layout = eval("(()=>{const e=(" + composer + ");const r=e.getBoundingClientRect();const s=e.parentElement.querySelector('button[aria-label=Send]')?.getBoundingClientRect();"
   + "return JSON.stringify({fits:r.top>=0&&r.bottom<=innerHeight+0.5&&r.width>100&&(!s||(s.top>=0&&s.bottom<=innerHeight+0.5)),top:r.top,bottom:r.bottom,innerHeight})})()");
  JSONObject parsed = new JSONObject((String) new org.json.JSONTokener(layout).nextValue());
  assertTrue("Composer within innerHeight " + when + ": " + parsed, parsed.getBoolean("fits"));
 }
 /** No message bubble shows the draft: it was never sent. */
 static void assertNotPosted(String text) throws Exception {
  assertEquals("The draft was never posted", "false", eval("[...document.querySelectorAll('[data-screen] *')].some(e=>!e.childElementCount&&e.tagName!=='TEXTAREA'&&e.closest('[data-alpha-layer=\"conversation\"]')&&(e.textContent||'').includes(" + JSONObject.quote(text) + "))"));
 }
 /**
  * Whether Alpha holds the HOME role, as Android's RoleManager answers for this package. Resolving the
  * HOME intent is not that answer: package visibility hides the stock launcher from Alpha (system_server
  * logs the AppsFilter interaction alphaphone -> nexuslauncher as BLOCKED on the API 36 emulator), so
  * the resolver named Alpha while the stock launcher held the role. In the emulator campaign of
  * 2026-10-14 the launcher run then took the HOME branch, HOME opened the stock launcher, and
  * recreate() ran with Alpha in the background (the recreated activity stopped, never resumed).
  */
 static boolean alphaIsHome(Context context) {
  if (!BuildConfig.IS_LAUNCHER) return false;
  android.app.role.RoleManager roles = context.getSystemService(android.app.role.RoleManager.class);
  return roles != null && roles.isRoleAvailable(android.app.role.RoleManager.ROLE_HOME) && roles.isRoleHeld(android.app.role.RoleManager.ROLE_HOME);
 }

 @Test public void draftSurvivesKeyboardSheetFullBackHomeAndRecreation() throws Exception {
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode();
   eval(AppNavigation.request("Home"));
   until(AppNavigation.selected("Home") + "&&!document.querySelector('.os')?.inert", "Home ready");
   AppNavigation.declineStartupAccess();
   click("Open conversation");
   awaitChat("sheet");
   until(AppNavigation.composer(), "The conversation sheet shows its composer");
   eval("(()=>{const e=(" + AppNavigation.composer() + ");e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e," + JSONObject.quote(DRAFT) + ");e.dispatchEvent(new Event('input',{bubbles:true}));})()");
   showKeyboard();
   assertComposer(DRAFT, "in the sheet with the keyboard shown");
   click("Expand chat");
   awaitChat("full");
   assertComposer(DRAFT, "after switching to full");
   click("Shrink chat");
   awaitChat("sheet");
   assertComposer(DRAFT, "after switching back to the sheet");
   click("Expand chat");
   awaitChat("full");
   showKeyboard();

   // Real Back: Android first dismisses the keyboard, then the app steps full -> sheet -> rest.
   pressKey(KeyEvent.KEYCODE_BACK);
   awaitIme(false, "The first Back dismisses the soft keyboard");
   awaitChat("full");
   assertComposer(DRAFT, "after the keyboard was dismissed");
   pressKey(KeyEvent.KEYCODE_BACK);
   awaitChat("sheet");
   assertComposer(DRAFT, "after Back from full");
   pressKey(KeyEvent.KEYCODE_BACK);
   awaitChat("rest");
   assertFalse("Back at rest did not leave the keyboard up", imeVisible());
   click("Open conversation");
   awaitChat("sheet");
   assertComposer(DRAFT, "when the conversation is reopened from rest");

   // HOME: delivered to Alpha while it is HOME, otherwise the app is backgrounded and resumed.
   boolean home = alphaIsHome(context);
   // The page already shows Home under the sheet, so "Home is selected" alone would pass before the
   // key is handled: count the HOME starts the page hears (MainActivity.onNewIntent -> launcher-home).
   if (home) eval("window.__alphaHomeStarts=0;window.addEventListener('launcher-home',()=>{window.__alphaHomeStarts++;})");
   pressKey(KeyEvent.KEYCODE_HOME);
   if (home) {
    until("window.__alphaHomeStarts>0", "HOME reaches Alpha's page");
    until(AppNavigation.selected("Home"), "HOME lands on Alpha Home");
    for (int i = 0; i < 100 && scenario.getState() != androidx.lifecycle.Lifecycle.State.RESUMED; i++) SystemClock.sleep(100);
    assertEquals("Alpha is resumed as HOME", androidx.lifecycle.Lifecycle.State.RESUMED, scenario.getState());
   } else {
    for (int i = 0; i < 50 && scenario.getState() == androidx.lifecycle.Lifecycle.State.RESUMED; i++) SystemClock.sleep(100);
    assertNotEquals("HOME backgrounded Alpha", androidx.lifecycle.Lifecycle.State.RESUMED, scenario.getState());
    context.startActivity(new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT));
    for (int i = 0; i < 100 && scenario.getState() != androidx.lifecycle.Lifecycle.State.RESUMED; i++) SystemClock.sleep(100);
    assertEquals("Alpha resumed in the same activity", androidx.lifecycle.Lifecycle.State.RESUMED, scenario.getState());
   }
   if (!"true".equals(eval("!!(" + AppNavigation.composer() + ")"))) click("Open conversation");
   assertComposer(DRAFT, "after HOME");

   // A new activity and renderer read the draft back from its persisted record.
   scenario.recreate();
   AppNavigation.liveMode();
   eval(AppNavigation.request("Home"));
   until(AppNavigation.selected("Home") + "&&!document.querySelector('.os')?.inert", "Home ready after recreation");
   if (!"true".equals(eval("!!(" + AppNavigation.composer() + ")"))) click("Open conversation");
   assertComposer(DRAFT, "after recreation (persisted draft)");
   assertNotPosted(DRAFT);
  }
 }
}
