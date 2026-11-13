package ai.alphacompute.alphaphone;

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

/** Native bridge integration against an explicitly synthetic HTTP peer; no real credentials. */
@RunWith(AndroidJUnit4.class)
public class ConnectionInstrumentedTest {
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

 @Test public void productionTransportRejectsRemoteCloudAndUnapprovedRoutesBeforeConnecting() throws Exception {
  org.junit.Assume.assumeTrue("Production transport policy requires a debug APK",BuildConfig.DEBUG);
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode();ready();
   // No credentials, body, or successful HTTP request. The bridge's bounded diagnostic proves
   // refusal during URL/route validation, before openConnection or any network dispatch.
   for(String url:new String[]{"https://remote-fixture.invalid/api/auth/me","https://11111111-1111-4111-8111-111111111111.cloud.eliza.app/api/agents","https://api.eliza.app/api/agents","https://api.eliza.app/api/v1/eliza/unreviewed-service","https://api.eliza.app/api/v1/eliza/google/disconnect"}){
    JSONObject args=new JSONObject().put("requestId",java.util.UUID.randomUUID().toString()).put("url",url).put("method","GET");
    WebViewTestDriver.evaluate("window.__connectionPolicy=null;Capacitor.Plugins.AlphaConnection.request("+args+").then(()=>window.__connectionPolicy={ok:true},error=>window.__connectionPolicy={ok:false,code:error.code})");
    until("window.__connectionPolicy!==null");JSONObject result=new JSONObject(WebViewTestDriver.evaluate("window.__connectionPolicy"));
    assertFalse("Forbidden product transport route must reject",result.getBoolean("ok"));
    assertEquals("Refusal precedes connection and dispatch","ALPHA_TRANSPORT:OTHER:VALIDATE:-1:java.lang.IllegalArgumentException",result.getString("code"));
   }
  }
 }

 @Test public void reservedNativeSlotsRejectEveryPublicStorageOperation() throws Exception {
  org.junit.Assume.assumeTrue("Owned native credential isolation campaign", "1".equals(InstrumentationRegistry.getArguments().getString("nativeSlotIsolation")));
  assertTrue("Fresh secondary user required",android.os.Process.myUid()/100000>0);
  AlphaCredentialStore nativeStore=new AlphaCredentialStore(InstrumentationRegistry.getInstrumentation().getTargetContext());
  // One bare and one versioned slot per native-only namespace; test/native-secure-slots.test.mjs pins the list.
  java.util.List<String> slots=new java.util.ArrayList<>();
  for(String namespace:RendererCredentialSlots.nativeNamespaces()){slots.add(namespace);slots.add(namespace+":v1:fixture");}
  java.util.List<String> ownedSlots=new java.util.ArrayList<>();
  String retained="{\"authority\":\"native-only-fixture\"}",forged="{\"authority\":\"renderer-forgery\"}";
  try(BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode();ready();
   for(String slot:slots){
    assertNull("Fixture must not overwrite existing authority",nativeStore.readCredentialSlot(slot));ownedSlots.add(slot);nativeStore.writeCredentialSlot(slot,retained);
    for(String method:new String[]{"secureRead","secureWrite","secureCompareExchange","secureRemove"}){
     JSONObject args=new JSONObject().put("slot",slot).put("expectedValue",retained).put("value",forged);
     assertFalse("Public "+method+" must reject native namespace",invoke(method,args).getBoolean("ok"));
     assertEquals("Rejected access must preserve native bytes",retained,nativeStore.readCredentialSlot(slot));
    }
    nativeStore.writeCredentialSlot(slot,forged);assertEquals("Trusted native internal access remains",forged,nativeStore.readCredentialSlot(slot));
   }
   String allowed="workflow-draft:v1:"+slotHash(java.util.UUID.randomUUID().toString());
   assertNull(nativeStore.readCredentialSlot(allowed));ownedSlots.add(allowed);
   assertTrue(invoke("secureWrite",new JSONObject().put("slot",allowed).put("value",retained)).getBoolean("ok"));
   assertEquals(retained,invoke("secureRead",new JSONObject().put("slot",allowed)).getJSONObject("value").getString("value"));
   assertEquals("saved",invoke("secureCompareExchange",new JSONObject().put("slot",allowed).put("expectedValue",retained).put("value",forged)).getJSONObject("value").getString("status"));
   assertTrue(invoke("secureRemove",new JSONObject().put("slot",allowed)).getBoolean("ok"));assertNull(nativeStore.readCredentialSlot(allowed));
  }finally{for(String slot:ownedSlots)nativeStore.removeCredentialSlot(slot);}
 }
 @Test public void localDraftCompareExchangePreservesNewerEditsAndEncryptedRecreation() throws Exception {
  String slot="inbox-drafts:v1:instrumentation-"+java.util.UUID.randomUUID();
  String first=new JSONObject().put("body","PRIVATE_SYNTHETIC_DRAFT_"+java.util.UUID.randomUUID()).put("revision","first").toString();
  String second=new JSONObject().put("body","SECOND_SYNTHETIC_BODY").put("revision","second").toString();
  File stored=new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(),"connection-credentials/"+slotHash(slot));
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();ready();
   JSONObject initial=new JSONObject().put("slot",slot).put("expectedValue",JSONObject.NULL).put("value",first);
   assertEquals("saved",invoke("secureCompareExchange",initial).getJSONObject("value").getString("status"));
   AlphaCredentialStore backgroundStore=new AlphaCredentialStore(InstrumentationRegistry.getInstrumentation().getTargetContext());
   assertEquals("Application-context reader uses the same deployed slot",first,backgroundStore.readCredentialSlot(slot));
   assertTrue(backgroundStore.compareExchangeCredentialSlot(slot,first,second));
   assertEquals(second,invoke("secureRead",new JSONObject().put("slot",slot)).getJSONObject("value").getString("value"));
   assertFalse("Stale native completion cannot replace a bridge-visible value",backgroundStore.compareExchangeCredentialSlot(slot,first,"{}"));
   assertTrue(backgroundStore.compareExchangeCredentialSlot(slot,second,first));
   assertFalse(new String(Files.readAllBytes(stored.toPath()),StandardCharsets.ISO_8859_1).contains("PRIVATE_SYNTHETIC_DRAFT_"));
   assertEquals("conflict",invoke("secureCompareExchange",initial).getJSONObject("value").getString("status"));
   assertEquals("saved",invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",first).put("value",second)).getJSONObject("value").getString("status"));
   scenario.recreate();ready();
   assertEquals(second,invoke("secureRead",new JSONObject().put("slot",slot)).getJSONObject("value").getString("value"));
   assertEquals("conflict",invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",first).put("value",JSONObject.NULL)).getJSONObject("value").getString("status"));
   assertEquals(second,invoke("secureRead",new JSONObject().put("slot",slot)).getJSONObject("value").getString("value"));
   assertFalse(invoke("secureCompareExchange",new JSONObject().put("slot","cloud:forbidden-fixture").put("expectedValue",JSONObject.NULL).put("value",first)).getBoolean("ok"));
   assertFalse(invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",second).put("value",17)).getBoolean("ok"));
   assertEquals("saved",invoke("secureCompareExchange",new JSONObject().put("slot",slot).put("expectedValue",second).put("value",JSONObject.NULL)).getJSONObject("value").getString("status"));
   assertFalse(stored.exists());
  }finally{new android.util.AtomicFile(stored).delete();}
 }

}
