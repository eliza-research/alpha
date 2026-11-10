package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.UUID;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/**
 * The reminder-from-note link (LOOP-B, B-28) at the storage level on Android. The renderer keeps the
 * links in the encrypted slot note-origins:v1:device through AlphaConnection.secureRead and
 * secureCompareExchange (note-origin-adapter.ts). This class writes a link in exactly the shape a
 * reminder saved from a note draft stores ({version:1, links:{"reminder:<id>": {version, noteId,
 * audioId, revision, savedAt}}}), reads back the exact bytes, refuses a stale compare-and-exchange,
 * keeps the link across an Activity recreation and puts the slot back as it found it.
 *
 * The Calendar detail line ("From note: <title>", Open note) needs a voice note and a reminder made
 * through the UI and is not driven here. The slot must be admitted for compare-and-exchange by
 * AlphaConnectionPlugin (the WP1 allowlist fix); until then the write step fails. Synthetic
 * identifiers only; emulator evidence of the native store, not of the renderer flow.
 *
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --serial emulator-NNNN --classes NoteOrigin
 */
@RunWith(AndroidJUnit4.class)
public class NoteOriginInstrumentedTest {
 private static final String SLOT = "note-origins:v1:device";
 private String eval(String js) throws Exception { return WebViewTestDriver.evaluate(js); }
 private JSONObject call(String code) throws Exception {
  eval("window.__noteOrigin=null;Promise.resolve().then(()=>" + code + ").then(v=>window.__noteOrigin=JSON.stringify(v??{}),e=>window.__noteOrigin=JSON.stringify({error:true,message:String(e?.message??'')}))");
  for (int i = 0; i < 150; i++) {
   String value = eval("window.__noteOrigin");
   if (!"null".equals(value)) return new JSONObject((String) new JSONTokener(value).nextValue());
   SystemClock.sleep(100);
  }
  fail("Secure store call did not settle: " + code); return null;
 }
 /** The slot's raw value: a JSON string, or null when the slot is empty. */
 private Object read() throws Exception {
  JSONObject result = call("Capacitor.Plugins.AlphaConnection.secureRead({slot:" + JSONObject.quote(SLOT) + "})");
  assertFalse("Read the note-link slot: " + result, result.optBoolean("error"));
  return result.isNull("value") ? null : result.getString("value");
 }
 private String exchange(Object expected, Object value) throws Exception {
  JSONObject result = call("Capacitor.Plugins.AlphaConnection.secureCompareExchange({slot:" + JSONObject.quote(SLOT) + ",expectedValue:" + (expected == null ? "null" : JSONObject.quote((String) expected)) + ",value:" + (value == null ? "null" : JSONObject.quote((String) value)) + "})");
  assertFalse("The note-link slot accepts compare-and-exchange (WP1 allowlist): " + result, result.optBoolean("error"));
  return result.getString("status");
 }
 private static String hex(String seed) throws Exception {
  byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(seed.getBytes(java.nio.charset.StandardCharsets.UTF_8));
  StringBuilder out = new StringBuilder(); for (byte b : digest) out.append(String.format("%02x", b)); return out.toString();
 }

 @Test public void reminderLinkIsStoredReadBackExactlyAndSurvivesRecreation() throws Exception {
  String reminder = "reminder-" + UUID.randomUUID(), note = "note-" + UUID.randomUUID(), audio = "audio-" + UUID.randomUUID();
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode(); eval(AppNavigation.request("Home")); for (int i = 0; i < 200 && !"true".equals(eval(AppNavigation.selected("Home"))); i++) SystemClock.sleep(100);
   Object original = read();
   JSONObject index = original == null ? new JSONObject().put("version", 1).put("links", new JSONObject()) : new JSONObject((String) original);
   assertEquals("A stored index is version 1", 1, index.getInt("version"));
   index.getJSONObject("links").put("reminder:" + reminder, new JSONObject().put("version", 1).put("noteId", note).put("audioId", audio).put("revision", hex(note)).put("savedAt", System.currentTimeMillis()));
   String written = index.toString();
   Throwable primary = null; boolean wrote = false;
   try {
    assertEquals("The link is stored against the value it was read from", "saved", exchange(original, written)); wrote = true;
    assertEquals("Exact bytes read back", written, read());
    // A writer holding the earlier value cannot overwrite the link.
    assertEquals("A stale compare-and-exchange is refused", "conflict", exchange(original, original));
    assertEquals("The refused exchange changed nothing", written, read());
    scenario.recreate(); AppNavigation.liveMode();
    assertEquals("The link survives an Activity recreation", written, read());
    assertTrue(new JSONObject((String) read()).getJSONObject("links").getJSONObject("reminder:" + reminder).getString("noteId").equals(note));
   } catch (Exception | AssertionError failure) { primary = failure; throw failure; } finally {
    try { if (wrote) assertEquals("The slot is put back as found", "saved", exchange(written, original)); }
    catch (Exception | AssertionError failure) { if (primary != null) primary.addSuppressed(failure); else throw failure; }
   }
  }
 }
}
