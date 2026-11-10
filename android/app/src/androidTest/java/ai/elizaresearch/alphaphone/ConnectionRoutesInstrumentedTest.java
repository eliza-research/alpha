package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Map;
import java.util.TreeMap;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** ConnectionRoutes inside a flag-off APK: the renderer transport (Capacitor.Plugins.AlphaConnection
 * .request) refuses every origin other than https://api.eliza.app, the retired pairing route, and
 * every DELETE except a body-less self-revocation, before any connection is opened. Each refusal is
 * the generic "Connection request failed"; a debuggable build records stage VALIDATE (never CONNECT)
 * in alpha-transport-diagnostics, and no credential slot file changes (measured against the slot
 * files once startup's own writes have settled). Nothing is sent to any host.
 *   npm run test:android:instrumentation -- --owned-emulator --avd NAME --classes ConnectionRoutes
 * A test-mocks build admits every origin by design, so the runner refuses this class with --test-mocks. */
@RunWith(AndroidJUnit4.class)
public class ConnectionRoutesInstrumentedTest {
 private static String eval(String js) throws Exception { return WebViewTestDriver.evaluate(js); }
 private static void until(String expression, String message) throws Exception {
  long deadline = SystemClock.elapsedRealtime() + 15000;
  while (SystemClock.elapsedRealtime() < deadline) {
   if ("true".equals(eval("Boolean(" + expression + ")"))) return;
   SystemClock.sleep(60);
  }
  fail(message);
 }
 /** Starts one request and returns {ok, message} once the plugin settles it. */
 private static JSONObject request(JSONObject args) throws Exception {
  eval("window.__routeResult=null;Capacitor.Plugins.AlphaConnection.request(" + args + ").then(()=>window.__routeResult={ok:true},e=>window.__routeResult={ok:false,message:String(e?.message??'')})");
  until("window.__routeResult!==null", "The transport did not settle " + args.optString("method", "GET"));
  return new JSONObject(eval("window.__routeResult"));
 }
 /** Name and SHA-256 of every stored credential slot file; values are never decrypted or printed. */
 private static Map<String, String> credentialFiles(Context context) throws Exception {
  Map<String, String> files = new TreeMap<>();
  File[] stored = new File(context.getNoBackupFilesDir(), "connection-credentials").listFiles();
  if (stored == null) return files;
  for (File file : stored) {
   if (!file.isFile()) continue;
   StringBuilder hex = new StringBuilder();
   for (byte b : MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file.toPath()))) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
   files.put(file.getName(), hex.toString());
  }
  return files;
 }

 /**
  * The credential slot files once app startup has stopped writing them. A first start after the
  * runner clears app data writes its own slots after the renderer is ready (on the emulator:
  * hosted-notices:owner:v1, hosted-notices:renewals:v1, workflow-notice-owner:v1 and
  * notes-records:v1:device), none of them through the transport. The baseline is taken only after
  * the set has been unchanged for three seconds, so every later change is attributable to the
  * refused requests.
  */
 private static Map<String, String> settledCredentialFiles(Context context) throws Exception {
  long deadline = SystemClock.elapsedRealtime() + 30000;
  Map<String, String> last = credentialFiles(context);
  long stableSince = SystemClock.elapsedRealtime();
  while (SystemClock.elapsedRealtime() < deadline) {
   SystemClock.sleep(250);
   Map<String, String> now = credentialFiles(context);
   if (!now.equals(last)) { last = now; stableSince = SystemClock.elapsedRealtime(); continue; }
   if (SystemClock.elapsedRealtime() - stableSince >= 3000) return now;
  }
  fail("Startup credential slot writes did not settle within 30 s: " + last.keySet());
  return last;
 }

 @Test public void flagOffTransportRefusesEveryNonCloudRouteBeforeConnecting() throws Exception {
  Assume.assumeTrue("ConnectionRoutes admits every origin in a test-mocks build; this checks the flag-off policy", !BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
  android.content.SharedPreferences diagnostics = context.getSharedPreferences("alpha-transport-diagnostics", Context.MODE_PRIVATE);
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   until("window.Capacitor?.Plugins?.AlphaConnection && document.documentElement.dataset.activeView", "AlphaConnection is available");
   Map<String, String> before = settledCredentialFiles(context);
   String agent = java.util.UUID.randomUUID().toString();
   JSONObject[] refused = {
    // A dedicated Cloud agent runtime origin (owner decision A-16 keeps it off production Android).
    new JSONObject().put("url", "https://" + agent + ".cloud.eliza.app/api/v1/user").put("method", "GET"),
    // A paired remote agent's origin, with the pairing route it would use.
    new JSONObject().put("url", "https://agent.example.test/api/auth/pair").put("method", "POST").put("body", "{\"code\":\"000000\"}"),
    // The retired pairing route on the one admitted origin.
    new JSONObject().put("url", "https://api.eliza.app/api/auth/pair").put("method", "POST").put("body", "{\"code\":\"000000\"}"),
    // DELETE of another key: only /api/v1/api-keys/current may be revoked, by its own key.
    new JSONObject().put("url", "https://api.eliza.app/api/v1/api-keys/other").put("method", "DELETE"),
    // Self-revocation with a body is not self-revocation.
    new JSONObject().put("url", "https://api.eliza.app/api/v1/api-keys/current").put("method", "DELETE").put("body", "{}"),
   };
   for (int i = 0; i < refused.length; i++) {
    JSONObject args = refused[i].put("requestId", "routes-" + i + "-" + java.util.UUID.randomUUID());
    if (BuildConfig.DEBUG) assertTrue("Diagnostics cleared before case " + i, diagnostics.edit().remove("lastFailure").commit());
    JSONObject result = request(args);
    assertFalse("Route case " + i + " must be refused", result.getBoolean("ok"));
    assertEquals("Route case " + i + " is refused with the generic message", "Connection request failed", result.getString("message"));
    if (BuildConfig.DEBUG) {
     String code = null;
     for (int attempt = 0; attempt < 50 && code == null; attempt++) { code = diagnostics.getString("lastFailure", null); if (code == null) SystemClock.sleep(40); }
     assertNotNull("Route case " + i + " recorded a transport diagnostic", code);
     String[] parts = code.split(":");
     assertTrue("Diagnostic shape for case " + i + ": " + code, parts.length >= 4 && "ALPHA_TRANSPORT".equals(parts[0]));
     assertEquals("Route case " + i + " is refused at VALIDATE, before any connection: " + code, "VALIDATE", parts[2]);
     assertEquals("No status was read for case " + i, "-1", parts[3]);
    }
   }
   assertEquals("No credential slot file was created, changed or removed", before, credentialFiles(context));
  }
 }
}
