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

/** Real WorkManager/HTTP/Keystore flow without an Activity. Requires a fresh isolated Android user. */
@RunWith(AndroidJUnit4.class)
public final class HostedBackgroundWorkerInstrumentedTest {
 @Test public void workerReceivesThenReplaysWithoutNewNoticeAndPreservesCiphertext()throws Exception {
  org.junit.Assume.assumeTrue("Explicit isolated hosted campaign required", "true".equals(InstrumentationRegistry.getArguments().getString("alphaHostedBackgroundFixture")));
  Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  assertTrue("Run against a test-mocks app build: only that build admits this fixture's loopback HTTP route (any other build refuses it, correctly)",BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);
  assertFalse("Run only in a disposable secondary user",context.getSystemService(UserManager.class).isSystemUser());
  AlphaCredentialStore storage=new AlphaCredentialStore(context);
  assertNull("Refuse to replace an existing delivery binding",storage.readCredentialSlot(HostedDelivery.ACTIVE));
  assertNull("Refuse existing background preference",storage.readCredentialSlot("hosted-background:v1:preference"));
  assertNull("Refuse to replace existing notice history",storage.readCredentialSlot(HostedResultNotices.LEDGER));
  try(Fixture server=new Fixture()){
   String origin="http://127.0.0.1:"+server.socket.getLocalPort(),scope=HostedResultNotices.hash(new JSONArray().put(origin).put(server.owner).put(server.agent).toString()),slot="hosted-digests:v1:"+scope,authSlot="remote:"+origin,deviceSlot="device:"+scope;
   String auth=new JSONObject().put("origin",origin).put("identityId",server.owner).put("sessionId",server.token).put("token",server.token).put("expiresAt",System.currentTimeMillis()+300000).toString();
   String device=new JSONObject().put("installationId",UUID.randomUUID().toString()).put("key","b".repeat(64)).put("enrollmentId","worker-fixture").toString();
   String raw=" \n"+server.result.toString()+"  ";String generation=UUID.randomUUID().toString();
   List<String> slots=Arrays.asList(HostedDelivery.ACTIVE,HostedResultNotices.LEDGER,HostedResultNotices.PENDING,"hosted-background:v1:preference",authSlot,deviceSlot,slot,slot+":worker-run");UUID workId=null;
   try{
    storage.writeCredentialSlot(authSlot,auth);storage.writeCredentialSlot(deviceSlot,device);storage.writeCredentialSlot(slot,new JSONObject().put("clientId","legacy-worker-client").put("ids",new JSONArray().put("worker-run")).put("pendingNotices",new JSONArray().put("worker-run")).toString());storage.writeCredentialSlot(slot+":worker-run",raw);
    byte[] before=read(storage.slotFile(storage.slotHash(slot+":worker-run")).getBaseFile());
    JSONObject binding=new JSONObject().put("version",1).put("mode","local").put("generation",generation).put("enabled",true).put("polling",true).put("sessionId","fixture-session").put("origin",origin).put("ownerId",server.owner).put("agentId",server.agent).put("scope",scope).put("credentialSlot",authSlot).put("credentialDigest",HostedResultNotices.hash(auth)).put("deviceSlot",deviceSlot).put("deviceDigest",HostedResultNotices.hash(device));storage.writeCredentialSlot(HostedDelivery.ACTIVE,binding.toString());
    WorkManager manager=WorkManager.getInstance(context);
    for(int iteration=0;iteration<2;iteration++){
     OneTimeWorkRequest request=new OneTimeWorkRequest.Builder(HostedDeliveryWorker.class).setInputData(new Data.Builder().putString("generation",generation).build()).build();workId=request.getId();manager.enqueue(request).getResult().get(10,TimeUnit.SECONDS);
     long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(70);WorkInfo info;
     do{info=manager.getWorkInfoById(workId).get(5,TimeUnit.SECONDS);if(info!=null&&info.getState().isFinished())break;Thread.sleep(100);}while(System.nanoTime()<end);
     assertNotNull(info);assertEquals("Actual Worker must finish",WorkInfo.State.SUCCEEDED,info.getState());
     assertEquals(raw,storage.readCredentialSlot(slot+":worker-run"));assertArrayEquals("Legacy ciphertext must not be rewritten",before,read(storage.slotFile(storage.slotHash(slot+":worker-run")).getBaseFile()));
     assertEquals("legacy-worker-client",new JSONObject(storage.readCredentialSlot(slot)).getString("clientId"));assertEquals(1,HostedDelivery.get(context).history("fixture-session").length());
    }
    HostedDelivery.get(context).polling(false);
    assertFalse(HostedDelivery.get(context).status().getBoolean("backgroundEnabled"));
    assertEquals("Pausing background checks preserves foreground reads",1,HostedDelivery.get(context).sync(generation).length());
    try{HostedDelivery.get(context).checkBackground(generation);fail("Background polling must stay paused");}catch(HostedDeliveryCancelled expected){}
    assertEquals(1,server.acks);assertEquals(1,new JSONObject(storage.readCredentialSlot(HostedResultNotices.LEDGER)).length());assertNull("HTTP fixture failed",server.failure);
    String oldAttempt=UUID.randomUUID().toString(),newAttempt=UUID.randomUUID().toString();
    HostedDelivery.get(context).begin(oldAttempt);HostedDelivery.get(context).begin(newAttempt);HostedDelivery.get(context).cancel(oldAttempt);
    JSONObject newest=new JSONObject(storage.readCredentialSlot(HostedDelivery.ACTIVE));assertEquals(newAttempt,newest.getString("attemptId"));
    newest.put("sessionId","newer-session");storage.writeCredentialSlot(HostedDelivery.ACTIVE,newest.toString());
    HostedDelivery.get(context).disableSession("older-session");assertEquals("newer-session",new JSONObject(storage.readCredentialSlot(HostedDelivery.ACTIVE)).getString("sessionId"));
   }finally{
    if(workId!=null)WorkManager.getInstance(context).cancelWorkById(workId).getResult().get(10,TimeUnit.SECONDS);
    HostedDelivery.get(context).disable();new HostedNoticePoster(context).cancel(HostedResultNotices.hash(scope+":worker-run"));
    for(String key:slots)storage.removeCredentialSlot(key);
   }
  }
 }
 private static byte[] read(File file)throws Exception {try(InputStream in=new FileInputStream(file)){return in.readAllBytes();}}
 private static final class Fixture implements AutoCloseable {
  final ServerSocket socket=new ServerSocket(0,8,InetAddress.getByName("127.0.0.1"));final ExecutorService executor=Executors.newSingleThreadExecutor();volatile Throwable failure;volatile boolean closed;volatile int acks;final String owner=UUID.randomUUID().toString(),agent=UUID.randomUUID().toString(),token=UUID.randomUUID().toString();final JSONObject result;
  Fixture()throws Exception {result=new JSONObject().put("cursor",1).put("runId","worker-run").put("workflowId","workflow").put("workflowVersionId","revision").put("templateVersion","morning-v1").put("scheduledAt","2026-10-01T10:00:00Z").put("startedAt","2026-10-01T10:00:00Z").put("completedAt","2026-10-01T10:00:01Z").put("source",new JSONObject()).put("status","completed").put("output","Private worker fixture").put("error",JSONObject.NULL);executor.submit(()->{while(!closed){try(Socket client=socket.accept()){client.setSoTimeout(5000);serve(client);}catch(Throwable e){if(!closed)failure=e;}}});}
  void serve(Socket client)throws Exception {BufferedReader reader=new BufferedReader(new InputStreamReader(client.getInputStream(),StandardCharsets.UTF_8));String request=reader.readLine();String path=request.split(" ")[1];int size=0;String authorization=null;for(String line;(line=reader.readLine())!=null&&!line.isEmpty();){int sep=line.indexOf(':');String name=line.substring(0,sep);String value=line.substring(sep+1).trim();if(name.equalsIgnoreCase("Content-Length"))size=Integer.parseInt(value);if(name.equalsIgnoreCase("Authorization"))authorization=value;}assertEquals("Bearer "+token,authorization);char[] body=new char[size];for(int got=0;got<size;){int n=reader.read(body,got,size-got);if(n<0)throw new EOFException();got+=n;}JSONObject response;
   if(path.equals("/api/auth/me"))response=new JSONObject().put("identity",new JSONObject().put("id",owner).put("kind","owner")).put("session",new JSONObject().put("id",token).put("kind","machine").put("expiresAt",System.currentTimeMillis()+300000)).put("access",new JSONObject().put("role","OWNER").put("mode","session"));
   else if(path.equals("/api/agents"))response=new JSONObject().put("agents",new JSONArray().put(new JSONObject().put("id",agent).put("status","running")));
   else if(path.equals("/api/workflow/status"))response=new JSONObject().put("hostedDigestProtocol",1);
   else if(path.equals("/api/workflow/hosted/results?clientId=legacy-worker-client"))response=new JSONObject().put("entries",acks==0?new JSONArray().put(result):new JSONArray());
   else if(path.equals("/api/workflow/hosted/results/ack")){JSONObject receipt=new JSONObject(new String(body));assertEquals("worker-run",receipt.getString("runId"));assertEquals(1,receipt.getInt("cursor"));acks++;response=new JSONObject().put("acknowledged",1);}
   else throw new AssertionError("Unexpected effect route");byte[] bytes=response.toString().getBytes(StandardCharsets.UTF_8);OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: "+bytes.length+"\r\n\r\n").getBytes(StandardCharsets.US_ASCII));out.write(bytes);out.flush();
  }
  public void close()throws Exception {closed=true;socket.close();executor.shutdownNow();if(!executor.awaitTermination(5,TimeUnit.SECONDS))throw new IOException("Fixture did not stop");}
 }
}
