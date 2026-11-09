package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.os.SystemClock;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.*;
import static org.junit.Assert.*;

/** Test APK only: persisted synthetic loopback session, restored by the real renderer initializer. */
final class WorkflowNoticeOwnerFixture implements AutoCloseable {
 static final String PREFS="workflow-owner-restore-fixture",OWNER_SLOT="workflow-notice-owner:v1";
 final Context context;final JSONObject identity;final String origin,token;final ServerSocket server;final Thread peer;
 final AtomicInteger verified=new AtomicInteger(),agents=new AtomicInteger();volatile Throwable failure;
 static boolean preparing(){return "prepare".equals(InstrumentationRegistry.getArguments().getString("workflowOwnerPhase"));}
 static void prepare()throws Exception{
  org.junit.Assume.assumeTrue("Synthetic restore requires test-mocks build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertTrue(android.os.Process.myUid()/100000>0);
  JSONObject identity=seed(context);AlphaCredentialStore store=new AlphaCredentialStore(context);
  String id="approval-"+(UUID.randomUUID().toString()+UUID.randomUUID()).replace("-","");
  JSONObject route=new JSONObject(identity.toString()).put("scope","a".repeat(64)).put("workflowId","fixture-flow").put("runId","fixture-run-"+UUID.randomUUID()).put("versionId","fixture-version");
  JSONObject approval=new JSONObject().put("id",id).put("bindingHash","b".repeat(64)).put("route",route).put("expiresAt",System.currentTimeMillis()+600000L);
  assertTrue(context.getSharedPreferences(PREFS,0).edit().putString("approval",approval.toString()).commit());
  try(WorkflowNoticeOwnerFixture fixture=new WorkflowNoticeOwnerFixture(context);BoundedActivityScenario<MainActivity> activity=BoundedActivityScenario.launch(MainActivity.class)){
   fixture.signIn();
   // One real main-process bridge publication. Never race the main owner fence
   // with a helper-process ledger write, and never retry an unknown publication.
   WebViewTestDriver.evaluate("window.__fixtureApprovalPost=null;Capacitor.Plugins.AlphaHostedResults.postWorkflowApprovalNotice("+approval+").then(value=>window.__fixtureApprovalPost={value},error=>window.__fixtureApprovalPost={error:String(error)});true");
   long publicationEnd=SystemClock.elapsedRealtime()+10000;String raw;
   do{raw=WebViewTestDriver.evaluate("window.__fixtureApprovalPost");if(!"null".equals(raw))break;SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<publicationEnd);
   assertNotEquals("Publication callback must settle; no retry","null",raw);
   JSONObject result=new JSONObject(raw);assertFalse("Main bridge rejected publication: "+result,result.has("error"));assertEquals("succeeded",result.getJSONObject("value").getString("status"));
   android.service.notification.StatusBarNotification notice=null;
   for(android.service.notification.StatusBarNotification row:context.getSystemService(android.app.NotificationManager.class).getActiveNotifications())if(("alpha-workflow-"+id).equals(row.getTag())){assertNull(notice);notice=row;}
   assertNotNull("Original OS publication required",notice);assertNotNull(notice.getNotification().contentIntent);
   JSONObject publication=new JSONObject().put("key",notice.getKey()).put("postTime",notice.getPostTime()).put("token",WorkflowNoticeTapsFactory.create(context).token(id)).put("receipt",store.readCredentialSlot(WorkflowNoticeDelivery.APPROVAL_SLOT)).put("routes",store.readCredentialSlot(WorkflowNoticeTaps.SLOT));
   assertTrue(context.getSharedPreferences(PREFS,0).edit().putString("publication",publication.toString()).commit());
   assertEquals(context.getPackageName(),notice.getNotification().contentIntent.getCreatorPackage());assertEquals(android.os.Process.myUid(),notice.getNotification().contentIntent.getCreatorUid());assertTrue(notice.getNotification().contentIntent.isImmutable());
   // Read back the actual OS IntentSender record/launch flags without launching it.
   try(InputStream input=new android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("dumpsys activity intents "+context.getPackageName()));ByteArrayOutputStream output=new ByteArrayOutputStream()){
    byte[] buffer=new byte[4096];int count;while((count=input.read(buffer))!=-1){assertTrue("Bounded owned PendingIntent diagnostic",output.size()+count<=65536);output.write(buffer,0,count);}
    android.os.Bundle evidence=new android.os.Bundle();evidence.putString("workflowOwnerPreparedIntentSender",output.toString("UTF-8"));InstrumentationRegistry.getInstrumentation().addResults(evidence);
   }


  }
 }
 /** Persists a fresh synthetic owner identity and its loopback token; returns the identity. */
 static JSONObject seed(Context context)throws Exception{
  org.junit.Assume.assumeTrue("Synthetic restore requires test-mocks build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  assertFalse("Fresh fixture preferences",context.getSharedPreferences(PREFS,0).contains("identity"));
  int port;try(ServerSocket probe=new ServerSocket(0,1,InetAddress.getByName("127.0.0.1"))){port=probe.getLocalPort();}
  String origin="http://127.0.0.1:"+port,token="SYNTHETIC-LOCAL-ONLY-"+UUID.randomUUID();
  JSONObject identity=new JSONObject().put("origin",origin).put("ownerId","fixture-owner-"+UUID.randomUUID()).put("agentId",UUID.randomUUID().toString());
  assertNull(new AlphaCredentialStore(context).readCredentialSlot("remote:"+origin));
  assertTrue(context.getSharedPreferences(PREFS,0).edit().putString("identity",identity.toString()).putString("token",token).commit());
  return identity;
 }
 /** In the launched activity: the real renderer restores the seeded session, which becomes the native notice owner. */
 void signIn()throws Exception{
  AlphaCredentialStore store=new AlphaCredentialStore(context);
  AppNavigation.liveMode();long end=SystemClock.elapsedRealtime()+20000;
  while(!"true".equals(WebViewTestDriver.evaluate("Boolean(document.documentElement.dataset.activeView)"))&&SystemClock.elapsedRealtime()<end)SystemClock.sleep(50);
  JSONObject credential=new JSONObject().put("origin",origin).put("token",token).put("sessionId",token).put("identityId",identity.getString("ownerId")).put("expiresAt",System.currentTimeMillis()+3600000);
  store.writeCredentialSlot("remote:"+origin,credential.toString());
  String selection=new JSONObject().put("kind","local").put("origin",origin).toString();
  assertEquals("true",WebViewTestDriver.evaluate("localStorage.setItem('alpha.connection.selection.v1',"+JSONObject.quote(selection)+");localStorage.getItem('alpha.connection.selection.v1')==="+JSONObject.quote(selection)));
  WebViewTestDriver.evaluate("location.reload();true");awaitOwner(true);
  JSONObject restored=new JSONObject((String)new JSONTokener(WebViewTestDriver.evaluate("localStorage.getItem('alpha.connection.selection.v1')")).nextValue());
  assertEquals(2,restored.length());assertEquals("local",restored.getString("kind"));assertEquals(origin,restored.getString("origin"));
 }
 static JSONObject approval(Context context)throws Exception{return new JSONObject(context.getSharedPreferences(PREFS,0).getString("approval","{}"));}
 static JSONObject publication(Context context)throws Exception{return new JSONObject(context.getSharedPreferences(PREFS,0).getString("publication","{}"));}
 WorkflowNoticeOwnerFixture(Context context)throws Exception{
  org.junit.Assume.assumeTrue("Synthetic restore requires test-mocks build",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  this.context=context;identity=new JSONObject(context.getSharedPreferences(PREFS,0).getString("identity","{}"));origin=identity.getString("origin");token=context.getSharedPreferences(PREFS,0).getString("token",null);assertNotNull(token);
  URI uri=new URI(origin);assertEquals("http",uri.getScheme());assertEquals("127.0.0.1",uri.getHost());server=new ServerSocket();server.setReuseAddress(true);server.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),uri.getPort()),8);
  peer=new Thread(()->{while(!server.isClosed())try(Socket socket=server.accept()){
   socket.setSoTimeout(5000);BufferedReader reader=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));String line=reader.readLine();if(line==null||line.length()>2048)throw new IOException("Invalid fixture request");String[] request=line.split(" ");String auth=null;int size=0;
   while((line=reader.readLine())!=null&&!line.isEmpty()){size+=line.length();if(size>16384)throw new IOException("Fixture header bound");if(line.toLowerCase(java.util.Locale.ROOT).startsWith("authorization:"))auth=line.substring(line.indexOf(':')+1).trim();}
   int status=404;JSONObject body=new JSONObject();
   if("GET".equals(request[0])&&("/api/auth/me".equals(request[1])||"/api/agents".equals(request[1]))){
    if(!("Bearer "+token).equals(auth))throw new IOException("Synthetic credential mismatch");status=200;
    if("/api/auth/me".equals(request[1])){verified.incrementAndGet();body.put("identity",new JSONObject().put("id",identity.getString("ownerId")).put("kind","owner").put("displayName","Synthetic fixture owner")).put("session",new JSONObject().put("id",token).put("kind","machine").put("expiresAt",System.currentTimeMillis()+3600000)).put("access",new JSONObject().put("role","OWNER").put("mode","session"));}
    else{agents.incrementAndGet();body.put("agents",new JSONArray().put(new JSONObject().put("id",identity.getString("agentId")).put("name","Synthetic fixture agent").put("status","running")));}
   }
   byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);socket.getOutputStream().write(("HTTP/1.1 "+status+" Fixture\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));socket.getOutputStream().write(bytes);socket.getOutputStream().flush();
  }catch(Exception error){if(!server.isClosed())failure=error;}},"synthetic-notice-owner");peer.setDaemon(true);peer.start();
 }
 void awaitOwner(boolean signedIn)throws Exception{awaitOwner(signedIn,1,1);}
 void awaitOwner(boolean signedIn,int minimumVerified,int minimumAgents)throws Exception{
  AlphaCredentialStore store=new AlphaCredentialStore(context);long end=SystemClock.elapsedRealtime()+20000;
  do{assertNull("Loopback peer failure",failure);String raw=store.readCredentialSlot(OWNER_SLOT);if(raw!=null){JSONObject stored=new JSONObject(raw),owner=stored.optJSONObject("owner");if(!signedIn&&stored.has("owner")&&stored.isNull("owner"))return;if(signedIn&&owner!=null&&identity.getString("origin").equals(owner.optString("origin"))&&identity.getString("ownerId").equals(owner.optString("ownerId"))&&identity.getString("agentId").equals(owner.optString("agentId"))&&verified.get()>=minimumVerified&&agents.get()>=minimumAgents){return;}}SystemClock.sleep(50);}while(SystemClock.elapsedRealtime()<end);fail("Renderer did not settle expected owner; auth="+verified.get()+", agents="+agents.get()+", nativeOwner="+store.readCredentialSlot(OWNER_SLOT)+", syntheticCredentialPresent="+(store.readCredentialSlot("remote:"+origin)!=null));
 }
 public void close()throws Exception{server.close();peer.join(6000);assertFalse("Loopback peer stopped",peer.isAlive());assertNull("Loopback peer failure",failure);}
}
