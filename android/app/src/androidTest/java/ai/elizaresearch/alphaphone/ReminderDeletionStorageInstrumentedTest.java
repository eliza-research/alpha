package ai.elizaresearch.alphaphone;

import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Encrypted recovery slots in an explicitly selected, owned secondary test user. */
@RunWith(AndroidJUnit4.class)
public class ReminderDeletionStorageInstrumentedTest {
 private String slotHash(String slot) throws Exception {
  StringBuilder text = new StringBuilder();
  for (byte b : java.security.MessageDigest.getInstance("SHA-256").digest(slot.getBytes(StandardCharsets.UTF_8))) text.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
  return text.toString();
 }
 private void until(String expression) throws Exception {
  long deadline = SystemClock.elapsedRealtime() + 15000;
  while (SystemClock.elapsedRealtime() < deadline) {
   if ("true".equals(WebViewTestDriver.evaluate("Boolean(" + expression + ")"))) return;
   SystemClock.sleep(60);
  }
  fail("Connection fixture did not finish");
 }
 private void begin(String expression) throws Exception {
  WebViewTestDriver.evaluate("window.__connectionResult=null;Promise.resolve(" + expression + ").then(value=>window.__connectionResult={ok:true,value:value??null},()=>window.__connectionResult={ok:false})");
 }
 private JSONObject result() throws Exception {
  until("window.__connectionResult!==null");
  return new JSONObject(WebViewTestDriver.evaluate("window.__connectionResult"));
 }
 private JSONObject invoke(String method, JSONObject args) throws Exception {
  begin("Capacitor.Plugins.AlphaConnection." + method + "(" + args + ")"); return result();
 }
 private void ready() throws Exception { until("window.Capacitor?.Plugins?.AlphaConnection && document.documentElement.dataset.activeView"); }

 @Test public void reminderDeletionSlotUsesEncryptedCompareExchange() throws Exception {
  org.junit.Assume.assumeTrue("Explicit pending action storage fixture required","1".equals(InstrumentationRegistry.getArguments().getString("pendingActionStorageFixture")));
  assertTrue(BuildConfig.DEBUG);assertTrue("Owned secondary test user required",android.os.Process.myUid()/100000>0);
  for(String slot:new String[]{"reminder-deletions:v1:device","reminder-creations:v1:device","notes-audio-deletions:v1:device","notes-trash:v1:device"})verifySlot(slot);
 }
 /** Valid JSON with non-ASCII content: byte capacity cannot be mistaken for syntax rejection. */
 private String jsonAtBytes(int bytes) throws Exception {
  String prefix="{\"fixture\":\"",suffix="\"}";
  int remaining=bytes-prefix.getBytes(StandardCharsets.UTF_8).length-suffix.getBytes(StandardCharsets.UTF_8).length;
  String value=prefix+"é".repeat(remaining/2)+(remaining%2==0?"":"x")+suffix;
  assertEquals(bytes,value.getBytes(StandardCharsets.UTF_8).length);
  assertTrue(value.length()<bytes);new JSONObject(value);return value;
 }
 private void verifySlot(String slot) throws Exception {
  File stored=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials/"+slotHash(slot));
  assertFalse("Preserve preexisting reminder recovery",stored.exists());
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();ready();
   assertTrue(invoke("secureRead",new JSONObject().put("slot",slot)).getJSONObject("value").isNull("value"));
   String value=new JSONObject().put("fixture","PRIVATE_REMINDER_CAS_"+java.util.UUID.randomUUID()).toString();
   boolean owned=false;
   try{
    assertEquals("saved",invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",JSONObject.NULL).put("value",value)).getJSONObject("value").getString("status"));owned=true;
    assertFalse(new String(Files.readAllBytes(stored.toPath()),StandardCharsets.ISO_8859_1).contains("PRIVATE_REMINDER_CAS_"));
    assertEquals("conflict",invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",JSONObject.NULL).put("value","{}")).getJSONObject("value").getString("status"));
    scenario.recreate();ready();
    assertEquals(value,invoke("secureRead",new JSONObject().put("slot",slot)).getJSONObject("value").getString("value"));
    // The 32 MiB Notes Trash slot shares the encrypted no-backup store; its capacity is not pushed through the bridge here.
    if(slot.equals("notes-trash:v1:device"))return;
    int limit=slot.equals("notes-audio-deletions:v1:device")?1024*1024:262144;
    String boundary=jsonAtBytes(limit),oversized=jsonAtBytes(limit+1);
    assertEquals("saved",invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",value).put("value",boundary)).getJSONObject("value").getString("status"));
    value=boundary; // Cleanup owns the exact replacement only after acknowledged CAS.
    assertEquals(value,invoke("secureRead",new JSONObject().put("slot",slot)).getJSONObject("value").getString("value"));
    assertFalse(invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",value).put("value",oversized)).getBoolean("ok"));
    assertEquals(value,invoke("secureRead",new JSONObject().put("slot",slot)).getJSONObject("value").getString("value"));
   }finally{
    if(owned){assertEquals("saved",invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",value).put("value",JSONObject.NULL)).getJSONObject("value").getString("status"));assertFalse(stored.exists());}
   }
  }
 }

}
