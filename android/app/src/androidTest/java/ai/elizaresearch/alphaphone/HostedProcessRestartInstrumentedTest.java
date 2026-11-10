package ai.elizaresearch.alphaphone;

import static org.junit.Assert.*;
import android.content.Context;
import android.os.UserManager;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.work.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/** Three separate instrumentation processes; no Activity and no external fixture state. */
@RunWith(AndroidJUnit4.class)
public final class HostedProcessRestartInstrumentedTest {
 private static final String STATE="hosted-restart-test:v1", SESSION="restart-fixture";
 private Context context(){org.junit.Assume.assumeTrue("Explicit isolated hosted campaign required", "true".equals(InstrumentationRegistry.getArguments().getString("alphaHostedProcessRestartFixture")));Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();assertTrue("Run against a test-mocks app build: only that build admits this fixture's loopback HTTP route (any other build refuses it, correctly)",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);assertFalse("Disposable secondary user required",c.getSystemService(UserManager.class).isSystemUser());return c;}
 private static String cipher(AlphaCredentialStore s,String slot)throws Exception {try(InputStream in=new FileInputStream(s.slotFile(s.slotHash(slot)).getBaseFile())){return android.util.Base64.encodeToString(in.readAllBytes(),android.util.Base64.NO_WRAP);}}
 private static void retained(AlphaCredentialStore s,JSONObject state)throws Exception {
  String slot=state.getString("slot");assertTrue("Saved record ciphertext changed",state.getString("cipher").equals(cipher(s,slot+":worker-run")));
  assertTrue("Saved record bytes changed",state.getString("raw").equals(s.readCredentialSlot(slot+":worker-run")));
  assertEquals("legacy-worker-client",new JSONObject(s.readCredentialSlot(slot)).getString("clientId"));
  assertTrue("Notice ledger changed on replay",state.getString("ledgerCipher").equals(cipher(s,HostedResultNotices.LEDGER)));
 }
 @Test public void prepareCommittedResultWithLostAck()throws Exception {
  Context c=context();AlphaCredentialStore s=new AlphaCredentialStore(c);
  for(String key:new String[]{STATE,HostedDelivery.ACTIVE,HostedResultNotices.LEDGER,HostedResultNotices.PENDING,"hosted-background:v1:preference"})assertNull("Fresh fixture required",s.readCredentialSlot(key));
  try(Fixture server=new Fixture(new JSONObject(),true)){
   String origin="http://127.0.0.1:"+server.socket.getLocalPort(),scope=HostedResultNotices.hash(new JSONArray().put(origin).put(server.owner).put(server.agent).toString()),slot="hosted-digests:v1:"+scope;
   String authSlot="remote:"+origin,deviceSlot="device:"+scope,generation=UUID.randomUUID().toString();
   String auth=new JSONObject().put("origin",origin).put("identityId",server.owner).put("sessionId",server.token).put("token",server.token).put("expiresAt",System.currentTimeMillis()+1800000).toString();
   String device=new JSONObject().put("installationId",UUID.randomUUID().toString()).put("key","b".repeat(64)).put("enrollmentId","worker-fixture").toString();
   JSONObject state=new JSONObject().put("owner",server.owner).put("agent",server.agent).put("token",server.token).put("port",server.socket.getLocalPort()).put("slot",slot).put("scope",scope).put("authSlot",authSlot).put("deviceSlot",deviceSlot).put("generation",generation).put("pid",android.os.Process.myPid()).put("phase","preparing");
   s.writeCredentialSlot(STATE,state.toString());s.writeCredentialSlot(authSlot,auth);s.writeCredentialSlot(deviceSlot,device);
   s.writeCredentialSlot(slot,new JSONObject().put("clientId","legacy-worker-client").put("ids",new JSONArray()).toString());
   s.writeCredentialSlot(HostedDelivery.ACTIVE,new JSONObject().put("version",1).put("mode","local").put("generation",generation).put("enabled",true).put("polling",true).put("sessionId",SESSION).put("origin",origin).put("ownerId",server.owner).put("agentId",server.agent).put("scope",scope).put("credentialSlot",authSlot).put("credentialDigest",HostedResultNotices.hash(auth)).put("deviceSlot",deviceSlot).put("deviceDigest",HostedResultNotices.hash(device)).toString());
   try{HostedDelivery.get(c).syncBackground(generation);fail("Lost ACK response must fail the transport");}catch(IOException expected){}
   assertTrue("ACK request reached server",server.acks>=1);assertNull("HTTP fixture failed",server.failure);
   assertEquals(1,HostedDelivery.get(c).history(SESSION).length());assertEquals(1,new JSONObject(s.readCredentialSlot(HostedResultNotices.LEDGER)).length());
   state.put("raw",s.readCredentialSlot(slot+":worker-run")).put("cipher",cipher(s,slot+":worker-run")).put("ledgerCipher",cipher(s,HostedResultNotices.LEDGER)).put("phase","prepared");s.writeCredentialSlot(STATE,state.toString());
  }
 }
 @Test public void resumeAfterProcessDeathRecoversAckOnce()throws Exception {
  Context c=context();AlphaCredentialStore s=new AlphaCredentialStore(c);JSONObject state=new JSONObject(s.readCredentialSlot(STATE));assertEquals("prepared",state.getString("phase"));assertNotEquals("Must run in a new target process",state.getInt("pid"),android.os.Process.myPid());retained(s,state);
  try(Fixture server=new Fixture(state,false)){
   String generation=state.getString("generation");
   WorkManager manager=WorkManager.getInstance(c);OneTimeWorkRequest request=new OneTimeWorkRequest.Builder(HostedDeliveryWorker.class).setInputData(new Data.Builder().putString("generation",generation).build()).build();
   try{manager.enqueue(request).getResult().get(10,TimeUnit.SECONDS);long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(70);WorkInfo info;
    do{info=manager.getWorkInfoById(request.getId()).get(5,TimeUnit.SECONDS);if(info!=null&&info.getState().isFinished())break;Thread.sleep(100);}while(System.nanoTime()<end);
    assertNotNull(info);assertEquals("Resumed real Worker must succeed",WorkInfo.State.SUCCEEDED,info.getState());
   }finally{manager.cancelWorkById(request.getId()).getResult().get(10,TimeUnit.SECONDS);}
   assertEquals(1,HostedDelivery.get(c).history(SESSION).length());assertEquals(1,server.acks);retained(s,state);
   assertEquals(1,HostedDelivery.get(c).syncBackground(generation).length());assertEquals("No duplicate ACK after server recovery",1,server.acks);retained(s,state);assertNull("HTTP fixture failed",server.failure);
   state.put("phase","resumed").put("resumePid",android.os.Process.myPid());s.writeCredentialSlot(STATE,state.toString());
  }
 }
 @Test public void verifySecondRestartAndCleanup()throws Exception {
  Context c=context();AlphaCredentialStore s=new AlphaCredentialStore(c);JSONObject state=new JSONObject(s.readCredentialSlot(STATE));assertEquals("resumed",state.getString("phase"));assertNotEquals(state.getInt("resumePid"),android.os.Process.myPid());retained(s,state);assertEquals(1,HostedDelivery.get(c).history(SESSION).length());
  HostedDelivery.get(c).disable();new HostedNoticePoster(c).cancel(HostedResultNotices.hash(state.getString("scope")+":worker-run"));
  for(String key:new String[]{state.getString("authSlot"),state.getString("deviceSlot"),state.getString("slot"),state.getString("slot")+":worker-run",HostedDelivery.ACTIVE,HostedResultNotices.LEDGER,HostedResultNotices.PENDING,STATE})s.removeCredentialSlot(key);
 }
 private static final class Fixture implements AutoCloseable {
  final ServerSocket socket; final boolean loseAck;final ExecutorService executor=Executors.newSingleThreadExecutor();volatile Throwable failure;volatile boolean closed;volatile int acks;final String owner,agent,token;final JSONObject result;
  Fixture(JSONObject saved,boolean lose)throws Exception {loseAck=lose;owner=saved.optString("owner",UUID.randomUUID().toString());agent=saved.optString("agent",UUID.randomUUID().toString());token=saved.optString("token",UUID.randomUUID().toString());socket=new ServerSocket();socket.setReuseAddress(true);socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),saved.optInt("port",0)),8);result=new JSONObject().put("cursor",1).put("runId","worker-run").put("workflowId","workflow").put("workflowVersionId","revision").put("templateVersion","morning-v1").put("scheduledAt","2026-10-01T10:00:00Z").put("startedAt","2026-10-01T10:00:00Z").put("completedAt","2026-10-01T10:00:01Z").put("source",new JSONObject()).put("status","completed").put("output","Private worker fixture").put("error",JSONObject.NULL);executor.submit(()->{while(!closed){try(Socket client=socket.accept()){client.setSoTimeout(5000);serve(client);}catch(Throwable e){if(!closed)failure=e;}}});}
  void serve(Socket client)throws Exception {BufferedReader reader=new BufferedReader(new InputStreamReader(client.getInputStream(),StandardCharsets.UTF_8));String request=reader.readLine();String path=request.split(" ")[1];int size=0;String authorization=null;for(String line;(line=reader.readLine())!=null&&!line.isEmpty();){int sep=line.indexOf(':');String name=line.substring(0,sep);String value=line.substring(sep+1).trim();if(name.equalsIgnoreCase("Content-Length"))size=Integer.parseInt(value);if(name.equalsIgnoreCase("Authorization"))authorization=value;}assertTrue("Fixture authorization mismatch",("Bearer "+token).equals(authorization));char[] body=new char[size];for(int got=0;got<size;){int n=reader.read(body,got,size-got);if(n<0)throw new EOFException();got+=n;}JSONObject response;
   if(path.equals("/api/auth/me"))response=new JSONObject().put("identity",new JSONObject().put("id",owner).put("kind","owner")).put("session",new JSONObject().put("id",token).put("kind","machine").put("expiresAt",System.currentTimeMillis()+300000)).put("access",new JSONObject().put("role","OWNER").put("mode","session"));
   else if(path.equals("/api/agents"))response=new JSONObject().put("agents",new JSONArray().put(new JSONObject().put("id",agent).put("status","running")));
   else if(path.equals("/api/workflow/status"))response=new JSONObject().put("hostedDigestProtocol",1);
   else if(path.equals("/api/workflow/hosted/results?clientId=legacy-worker-client"))response=new JSONObject().put("entries",acks==0?new JSONArray().put(result):new JSONArray());
   else if(path.equals("/api/workflow/hosted/results/ack")){JSONObject receipt=new JSONObject(new String(body));assertEquals("worker-run",receipt.getString("runId"));assertEquals(1,receipt.getInt("cursor"));acks++;if(loseAck)return;response=new JSONObject().put("acknowledged",1);}
   else throw new AssertionError("Unexpected effect route");byte[] bytes=response.toString().getBytes(StandardCharsets.UTF_8);OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(bytes);out.flush();
  }
  public void close()throws Exception {closed=true;socket.close();executor.shutdownNow();if(!executor.awaitTermination(5,TimeUnit.SECONDS))throw new IOException("Fixture did not stop");}
 }
}
