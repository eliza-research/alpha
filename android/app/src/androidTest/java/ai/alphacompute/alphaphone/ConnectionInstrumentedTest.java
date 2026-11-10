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
  org.junit.Assume.assumeTrue("Production transport policy requires flag-off debug APK",BuildConfig.DEBUG&&!BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
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

 @Test public void encryptedCredentialsAndHttpSurviveRecreationWithCancellationAndRedirectRejection() throws Exception {
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  String slot = "instrumentation.connection.synthetic.v1";
  String token = "SYNTHETIC-ALPHA-CONNECTION-NOT-A-REAL-TOKEN";
  String value = new JSONObject().put("token", token).put("identityId", "fixture-owner").toString();
  AtomicInteger redirectTargetHits = new AtomicInteger(), requestHits = new AtomicInteger();
  java.util.concurrent.atomic.AtomicReference<String> lastCapabilities=new java.util.concurrent.atomic.AtomicReference<>();
  CountDownLatch slowStarted = new CountDownLatch(1), releaseSlow = new CountDownLatch(1);
  ServerSocket server = new ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"));
  String base = "http://127.0.0.1:" + server.getLocalPort();
  Thread peer = new Thread(() -> {
   while (!server.isClosed()) {
    try {
     Socket socket = server.accept();
     Thread handler = new Thread(() -> {
      try (socket) {
       socket.setSoTimeout(15000);
       BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
       String first = input.readLine(), line;requestHits.incrementAndGet();
       int length = 0;
       while ((line = input.readLine()) != null && !line.isEmpty()) {
        if(line.toLowerCase(java.util.Locale.ROOT).startsWith("x-eliza-device-capabilities:"))lastCapabilities.set(line.substring(line.indexOf(':')+1).trim());
        if (line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
       }
       while (length-- > 0) input.read();
       String path = first.split(" ")[1];
       if (path.equals("/slow")) { slowStarted.countDown(); releaseSlow.await(15, TimeUnit.SECONDS); }
       if (path.equals("/redirect-target")) redirectTargetHits.incrementAndGet();
       String body = "{\"fixture\":true}";
       String response = path.equals("/redirect")
         ? "HTTP/1.1 302 Found\r\nLocation: " + base + "/redirect-target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
         : "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: " + body.length() + "\r\nConnection: close\r\n\r\n" + body;
       socket.getOutputStream().write(response.getBytes(StandardCharsets.UTF_8));
      } catch (Exception ignored) { /* Cancellation intentionally closes the client socket. */ }
     }, "alpha-connection-fixture-request");
     handler.setDaemon(true); handler.start();
    } catch (Exception ignored) { if (server.isClosed()) return; }
   }
  }, "alpha-connection-fixture");
  peer.setDaemon(true); peer.start();
  try (BoundedActivityScenario<MainActivity> scenario = BoundedActivityScenario.launch(MainActivity.class)) {
   AppNavigation.liveMode();
   ready();
   assertTrue(invoke("secureWrite", new JSONObject().put("slot", slot).put("value", value)).getBoolean("ok"));
   String hash = slotHash(slot);
   File stored = new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(), "connection-credentials/" + hash);
   assertTrue("Ciphertext exists in private no-backup storage", stored.isFile());
   byte[] ciphertext = Files.readAllBytes(stored.toPath());
   assertFalse("Fixture token must not appear in persisted bytes", new String(ciphertext, StandardCharsets.ISO_8859_1).contains(token));
   assertEquals(1, ciphertext[0]);
   assertEquals(value, invoke("secureRead", new JSONObject().put("slot", slot)).getJSONObject("value").getString("value"));
   scenario.recreate(); ready();
   assertEquals(value, invoke("secureRead", new JSONObject().put("slot", slot)).getJSONObject("value").getString("value"));
   JSONObject request = new JSONObject().put("requestId", "fixture-ok").put("url", base + "/ok").put("method", "POST")
     .put("headers", new JSONObject().put("Content-Type", "application/json").put("Authorization", "Bearer " + token)).put("body", "{\"fixture\":true}");
   JSONObject response = invoke("request", request);
   assertTrue(response.getBoolean("ok")); assertEquals(200, response.getJSONObject("value").getInt("status"));
   assertTrue(response.getJSONObject("value").getJSONObject("data").getBoolean("fixture"));
   String negotiatedCapabilities="calendar.local-event.v1,notes.local-record.v1,reminders.local-record.v1,maps.selected-read.v1,clock.handoff.v1";
   String negotiatedV2=negotiatedCapabilities.replace("reminders.local-record.v1","reminders.local-record.v2");
   for(String capabilities:new String[]{"reminders.create.v1",negotiatedV2+",reminders.create.v1",negotiatedCapabilities+",reminders.create.v1","reminders.local-record.v2",negotiatedV2,"calendar.local-event.v1","notes.local-record.v1","calendar.local-event.v1,notes.local-record.v1","notes.local-record.v1,calendar.local-event.v1","maps.selected-read.v1","calendar.local-event.v1,notes.local-record.v1,maps.selected-read.v1",negotiatedCapabilities}){
    int before=requestHits.get();
    JSONObject accepted=invoke("request",new JSONObject().put("requestId",java.util.UUID.randomUUID().toString()).put("url",base+"/api/conversations").put("method","GET").put("headers",new JSONObject().put("X-Eliza-Device-Capabilities",capabilities)));
    assertTrue(accepted.getBoolean("ok"));assertEquals(200,accepted.getJSONObject("value").getInt("status"));
    assertTrue(accepted.getJSONObject("value").getJSONObject("data").getBoolean("fixture"));
    assertEquals("Accepted capability header must reach the HTTP peer exactly once",before+1,requestHits.get());assertEquals(capabilities,lastCapabilities.get());
   }
   for(String capabilities:new String[]{"reminders.local-record.v1,reminders.local-record.v2","reminders.local-record.v1,reminders.local-record.v2,reminders.create.v1",negotiatedV2+",reminders.create.v1,reminders.local-record.v1",negotiatedV2+",reminders.create.v1,unknown","reminders.create.v1,reminders.create.v1",negotiatedV2+",reminders.local-record.v1","reminders.local-record.v2,reminders.local-record.v2","calendar.local-event.v1,calendar.local-event.v1","notes.local-record.v1,","unknown","calendar.local-event.v1,notes.local-record.v1,unknown","notes.local-record.v1\r\nX-Injected: yes","maps.selected-read.v1,maps.selected-read.v1","calendar.local-event.v1,notes.local-record.v1,reminders.local-record.v1,unknown",negotiatedCapabilities+",maps.selected-read.v1",negotiatedCapabilities+",clock.handoff.v1",negotiatedCapabilities+",unknown",negotiatedCapabilities+"\nX-Injected: yes"}){
    int before=requestHits.get();assertFalse(invoke("request",new JSONObject().put("requestId",java.util.UUID.randomUUID().toString()).put("url",base+"/capabilities-invalid").put("method","GET").put("headers",new JSONObject().put("X-Eliza-Device-Capabilities",capabilities))).getBoolean("ok"));assertEquals("Invalid capability header must not reach HTTP peer",before,requestHits.get());
   }
   assertFalse(invoke("request", new JSONObject().put("requestId", "fixture-redirect").put("url", base + "/redirect").put("method", "GET")).getBoolean("ok"));
   assertEquals("Redirect destination must never receive a request", 0, redirectTargetHits.get());
   begin("Capacitor.Plugins.AlphaConnection.request(" + new JSONObject().put("requestId", "fixture-cancel").put("url", base + "/slow").put("method", "GET") + ")");
   assertTrue("Slow request reached synthetic host", slowStarted.await(15, TimeUnit.SECONDS));
   WebViewTestDriver.evaluate("window.__connectionCancelled=false;Capacitor.Plugins.AlphaConnection.cancel({requestId:'fixture-cancel'}).then(()=>window.__connectionCancelled=true)");
   until("window.__connectionCancelled===true");
   releaseSlow.countDown(); assertFalse(result().getBoolean("ok"));
   assertTrue(invoke("secureRemove", new JSONObject().put("slot", slot)).getBoolean("ok"));
   assertFalse(stored.exists());
   assertTrue(invoke("secureRead", new JSONObject().put("slot", slot)).getJSONObject("value").isNull("value"));
  } finally {
   releaseSlow.countDown(); server.close(); peer.join(2000);
   // Delete only this fixture's slot even when UI verification fails.
   String hash = slotHash(slot);
   new android.util.AtomicFile(new File(InstrumentationRegistry.getInstrumentation().getTargetContext().getNoBackupFilesDir(), "connection-credentials/" + hash)).delete();
  }
 }
 @Test public void enabledViewProfileHttpPreservesAuthenticationAndConditionalRevision() throws Exception {
  org.junit.Assume.assumeTrue("Loopback HTTP fixtures require a -PELIZA_DEV_ALLOW_TEST_MOCKS=1 debug build", BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  final String path="/api/client-devices/view-profile";
  final String installation=java.util.UUID.randomUUID().toString();
  final String key="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", bearer="Bearer SYNTHETIC-PROFILE-OWNER";
  final String capabilities="calendar.local-event.v1,notes.local-record.v1,reminders.local-record.v2,reminders.create.v1,maps.selected-read.v1,clock.handoff.v1";
  final String revision=java.util.UUID.randomUUID().toString();
  AtomicInteger hits=new AtomicInteger(), writes=new AtomicInteger();
  java.util.concurrent.atomic.AtomicReference<JSONObject> profile=new java.util.concurrent.atomic.AtomicReference<>();
  java.util.concurrent.atomic.AtomicReference<Throwable> peerFailure=new java.util.concurrent.atomic.AtomicReference<>();
  java.util.List<JSONObject> observed=java.util.Collections.synchronizedList(new java.util.ArrayList<>());
  ServerSocket server=new ServerSocket(0,8,InetAddress.getByName("127.0.0.1"));
  String base="http://127.0.0.1:"+server.getLocalPort();
  Thread peer=new Thread(()->{
   while(!server.isClosed()){
    try(Socket socket=server.accept()){
     socket.setSoTimeout(5000);
     BufferedReader input=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));
     String first=input.readLine();if(first==null||first.length()>2048)throw new IllegalStateException("Invalid fixture request line");
     String[] requestLine=first.split(" ");if(requestLine.length!=3)throw new IllegalStateException("Invalid fixture request line");
     JSONObject headers=new JSONObject();String line;int headerBytes=0,length=0;
     while((line=input.readLine())!=null&&!line.isEmpty()){
      headerBytes+=line.length();if(headerBytes>8192)throw new IllegalStateException("Fixture headers exceeded bound");
      int colon=line.indexOf(':');if(colon<=0)throw new IllegalStateException("Invalid fixture header");
      String name=line.substring(0,colon).toLowerCase(java.util.Locale.ROOT),value=line.substring(colon+1).trim();
      if(headers.has(name))throw new IllegalStateException("Duplicate fixture header");headers.put(name,value);
      if(name.equals("content-length"))length=Integer.parseInt(value);
     }
     if(length<0||length>2048)throw new IllegalStateException("Fixture body exceeded bound");
     char[] content=new char[length];int read=0;
     while(read<length){int n=input.read(content,read,length-read);if(n<0)throw new IllegalStateException("Truncated fixture body");read+=n;}
     String body=new String(content);hits.incrementAndGet();observed.add(new JSONObject().put("method",requestLine[0]).put("path",requestLine[1]).put("headers",headers).put("body",body));
     int status=200;JSONObject response=new JSONObject();
     if(!requestLine[1].equals(path)){status=404;response.put("error","Unknown synthetic route");}
     else if(!bearer.equals(headers.optString("authorization"))||!installation.equals(headers.optString("x-eliza-device-id"))||!key.equals(headers.optString("x-eliza-device-key"))){status=401;response.put("error","Synthetic identity mismatch");}
     else if(!capabilities.equals(headers.optString("x-eliza-device-capabilities"))){status=400;response.put("error","Synthetic capabilities mismatch");}
     else if(requestLine[0].equals("POST")){
      JSONObject value=new JSONObject(body);
      if(value.getInt("version")!=1||value.length()!=3||!value.getJSONArray("views").toString().equals("[\"notes\"]"))throw new IllegalStateException("Unexpected profile body");
      Object expected=value.get("expectedRevision");JSONObject current=profile.get();
      if(current==null?expected!=JSONObject.NULL:!current.getString("revision").equals(expected)){status=409;response.put("error","Synthetic revision conflict");}
      else{JSONObject saved=new JSONObject().put("version",1).put("revision",revision).put("views",new org.json.JSONArray().put("notes"));profile.set(saved);writes.incrementAndGet();response.put("version",1).put("profile",saved);}
     }else{response.put("version",1).put("supportedViews",new org.json.JSONArray().put("notes")).put("profile",profile.get()==null?JSONObject.NULL:profile.get());}
     byte[] bytes=response.toString().getBytes(StandardCharsets.UTF_8);
     socket.getOutputStream().write(("HTTP/1.1 "+status+" Fixture\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
     socket.getOutputStream().write(bytes);socket.getOutputStream().flush();
    }catch(Exception error){if(!server.isClosed())peerFailure.compareAndSet(null,error);}
   }
  },"alpha-view-profile-http-fixture");peer.setDaemon(true);peer.start();
  try(BoundedActivityScenario<MainActivity> scenario=BoundedActivityScenario.launch(MainActivity.class)){
   AppNavigation.liveMode();ready();
   JSONObject headers=new JSONObject().put("Authorization",bearer).put("Content-Type","application/json").put("X-Eliza-Device-Id",installation).put("X-Eliza-Device-Key",key).put("X-Eliza-Device-Capabilities",capabilities);
   JSONObject request=new JSONObject().put("url",base+path).put("method","GET").put("headers",headers);
   java.util.function.Function<JSONObject,JSONObject> call=args->{try{return invoke("request",new JSONObject(args.toString()).put("requestId",java.util.UUID.randomUUID().toString()));}catch(Exception e){throw new AssertionError(e);}};
   JSONObject first=call.apply(request);assertTrue(first.getBoolean("ok"));assertEquals(200,first.getJSONObject("value").getInt("status"));assertTrue(first.getJSONObject("value").getJSONObject("data").isNull("profile"));
   String body=new JSONObject().put("version",1).put("views",new org.json.JSONArray().put("notes")).put("expectedRevision",JSONObject.NULL).toString();
   JSONObject post=new JSONObject(request.toString()).put("method","POST").put("body",body);
   JSONObject saved=call.apply(post);assertTrue(saved.getBoolean("ok"));assertEquals(200,saved.getJSONObject("value").getInt("status"));assertEquals(revision,saved.getJSONObject("value").getJSONObject("data").getJSONObject("profile").getString("revision"));assertEquals(1,writes.get());
   assertEquals("Conditional stale write is not retried",409,call.apply(post).getJSONObject("value").getInt("status"));assertEquals(1,writes.get());
   assertEquals(revision,call.apply(request).getJSONObject("value").getJSONObject("data").getJSONObject("profile").getString("revision"));
   assertEquals("GET forwarded with no body","",observed.get(0).getString("body"));assertEquals(body,observed.get(1).getString("body"));
   for(int i=0;i<4;i++){
    JSONObject sent=observed.get(i).getJSONObject("headers");assertEquals(bearer,sent.getString("authorization"));assertEquals(installation,sent.getString("x-eliza-device-id"));assertEquals(key,sent.getString("x-eliza-device-key"));assertEquals(capabilities,sent.getString("x-eliza-device-capabilities"));
   }
   for(String identityHeader:new String[]{"Authorization","X-Eliza-Device-Id","X-Eliza-Device-Key"}){
    JSONObject bad=new JSONObject(request.toString());bad.getJSONObject("headers").put(identityHeader,"synthetic-wrong-identity");int before=hits.get();JSONObject refused=call.apply(bad);assertTrue(refused.getBoolean("ok"));assertEquals(401,refused.getJSONObject("value").getInt("status"));assertEquals(before+1,hits.get());assertEquals(1,writes.get());
   }
   assertEquals(404,call.apply(new JSONObject(request.toString()).put("url",base+path+"/unknown")).getJSONObject("value").getInt("status"));
   for(String invalid:new String[]{capabilities+",unknown.v1",capabilities+",reminders.local-record.v1","notes.local-record.v1,notes.local-record.v1",capabilities+"\r\nX-Injected: yes"}){
    JSONObject bad=new JSONObject(request.toString());bad.getJSONObject("headers").put("X-Eliza-Device-Capabilities",invalid);int before=hits.get();assertFalse(call.apply(bad).getBoolean("ok"));assertEquals("Rejected capabilities never reach HTTP",before,hits.get());
   }
   for(JSONObject bad:new JSONObject[]{new JSONObject(request.toString()).put("url",base+path+"#fragment"),new JSONObject(request.toString()).put("url","file:///api/client-devices/view-profile"),new JSONObject(request.toString()).put("method","DELETE"),new JSONObject(request.toString()).put("body",body)}){
    int before=hits.get();assertFalse(call.apply(bad).getBoolean("ok"));assertEquals("Invalid transport request never reaches HTTP",before,hits.get());
   }
   assertEquals(1,writes.get());assertNull("Synthetic HTTP peer completed without error",peerFailure.get());
  }finally{server.close();peer.join(6000);assertFalse("Fixture peer stopped",peer.isAlive());}
 }
}
