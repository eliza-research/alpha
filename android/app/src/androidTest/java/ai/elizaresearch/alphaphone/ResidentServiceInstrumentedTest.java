package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import android.system.Os;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;
import org.junit.Assume;
import org.junit.Test;
import static ai.elizaresearch.alphaphone.ResidentTestFixture.*;
import static org.junit.Assert.*;

/** Opt-in service-only resident test. No Activity, WebView, UI acceptance, or ordinary background-start claim. */
public final class ResidentServiceInstrumentedTest {
 private Context context;
 private JSONObject fixture;
 private final JSONArray traceDiagnostics=new JSONArray();
 private String ownerBearer, ownerIdentityId;
 private JSONObject nativeCall(String path,String method,JSONObject body,String bearer)throws Exception {
  JSONObject headers=new JSONObject();if(bearer!=null)headers.put("Authorization","Bearer "+bearer);
  JSONObject args=new JSONObject().put("path",path).put("method",method).put("headers",headers).put("timeoutMs",path.startsWith("/api/auth/")?10000:120000);
  if(body!=null)args.put("body",body.toString());
  JSONObject result=new JSONObject(ElizaAgentService.requestLocalAgent(args.toString()));
  if(result.getInt("status")!=200)throw new IOException("Resident API status "+result.getInt("status"));return new JSONObject(result.getString("body"));
 }
 private JSONObject request(String path,JSONObject body)throws Exception {return nativeCall(path,body==null?"GET":"POST",body,ownerBearer);}
 private void startAndEnroll()throws Exception {
  assertTrue(context.getSharedPreferences("CapacitorStorage",Context.MODE_PRIVATE).edit().putString("eliza:mobile-runtime-mode","cloud-hybrid").commit());
  ElizaAgentService.start(context);
  long deadline=SystemClock.elapsedRealtime()+90000;
  String root=null;JSONObject status=null;
  while(SystemClock.elapsedRealtime()<deadline){
   try {
    root=ElizaAgentService.localAgentToken(context);
    if(root!=null&&!root.isEmpty()){
     status=nativeCall("/api/auth/status","GET",null,ownerBearer==null?root:ownerBearer);
     if(ownerBearer!=null&&!status.optBoolean("authenticated"))status=null;
     else {status.getString("instanceId");break;}
    }
   } catch(IOException|JSONException unavailable){status=null;}
   SystemClock.sleep(250);
  }
  if(status==null)throw new AssertionError("Resident service readiness deadline; inspect OS FGS admission and boot diagnostics, do not retry blindly");
  // Restart preserves the owner session. A bootstrap bearer cannot mint another
  // owner session after the first owner has claimed the runtime.
  if(ownerBearer!=null){
   JSONObject who=request("/api/auth/me",null);
   assertTrue("Restarted native session must match",ownerBearer.equals(who.getJSONObject("session").getString("id")));
   assertEquals(ownerIdentityId,who.getJSONObject("identity").getString("id"));
   assertEquals("owner",who.getJSONObject("identity").getString("kind"));
   return;
  }
  // Pair-code issuance and pairing are deliberately outside readiness polling: never replay an ambiguous enrollment.
  JSONObject code=nativeCall("/api/auth/pair-code","GET",null,root);
  JSONObject paired=nativeCall("/api/auth/pair","POST",new JSONObject().put("code",code.getString("code")).put("instanceId",status.getString("instanceId")),root);
  assertEquals("owner",paired.getString("access"));assertEquals(status.getString("instanceId"),paired.getString("instanceId"));
  ownerBearer=paired.getString("token");ownerIdentityId=paired.getString("identityId");JSONObject who=request("/api/auth/me",null);
  assertTrue("Paired native session must match",ownerBearer.equals(who.getJSONObject("session").getString("id")));
  assertEquals(paired.getString("identityId"),who.getJSONObject("identity").getString("id"));
 }

 private JSONObject ownedChild()throws Exception {return ResidentTestFixture.ownedChild(context,fixture.getString("processExecutableSha256"));}
 private void stopped(JSONObject child)throws Exception {ResidentTestFixture.stopped(context,child);}
 private JSONObject owner()throws Exception {return ResidentTestFixture.owner(request("/api/auth/me",null),ownerBearer);}
 private JSONObject agent()throws Exception {return ResidentTestFixture.agent(request("/api/agents",null));}
 private JSONArray history(String id)throws Exception{return request("/api/conversations/"+id+"/messages",null).getJSONArray("messages");}
 private JSONObject trace(String room,String messageId)throws Exception {
  long end=SystemClock.elapsedRealtime()+30000;
  while(SystemClock.elapsedRealtime()<end){JSONObject response=nativeGet("/api/trajectories?limit=100&roomId="+room,ownerBearer);assertEquals(200,response.getInt("status"));JSONObject list=new JSONObject(response.getString("body"));JSONArray entries=list.getJSONArray("trajectories");assertEquals(list.getInt("total"),entries.length());JSONObject found=null;
   for(int i=0;i<entries.length();i++){String id=entries.getJSONObject(i).getString("id");assertTrue(id.matches("[A-Za-z0-9_-]+"));JSONObject detail=new JSONObject(nativeGet("/api/trajectories/"+id+"?includePayloads=1",ownerBearer).getString("body"));JSONObject trajectory=detail.getJSONObject("trajectory"),meta=trajectory.optJSONObject("metadata");
    if(meta==null||!messageId.equals(meta.optString("messageId"))||meta.has("taskId"))continue;
    assertNull("Ambiguous initial trajectory",found);found=detail;
   }
   if(found!=null&&!found.getJSONObject("trajectory").isNull("endTime")){assertEquals("completed",found.getJSONObject("trajectory").getString("status"));assertTrue(found.getBoolean("payloadsIncluded"));assertEquals(room,found.getJSONObject("trajectory").getString("roomId"));JSONArray calls=found.getJSONArray("llmCalls");assertTrue(calls.length()>0&&calls.length()<=12);for(int i=0;i<calls.length();i++){JSONObject c=calls.getJSONObject(i);assertEquals("qwen-3.8-27b",c.getString("model"));assertTrue(c.getString("provider").toLowerCase(Locale.ROOT).contains("cerebras"));assertEquals(found.getJSONObject("trajectory").getString("id"),c.getString("trajectoryId"));traceDiagnostics.put(new JSONObject().put("index",i).put("model",c.optString("model")).put("provider",c.optString("provider")).put("responsePresent",c.has("response")).put("responseLength",c.optString("response").length()).put("toolCallCount",c.optJSONArray("toolCalls")==null?0:c.getJSONArray("toolCalls").length()).put("promptTokens",c.optLong("promptTokens",-1)).put("completionTokens",c.optLong("completionTokens",-1)).put("finishReason",c.optString("finishReason")).put("trajectoryStatus",found.getJSONObject("trajectory").optString("status")));assertTrue("Recorded call requires visible text or a valid normalized tool response; see traceDiagnostics",ResidentModelResponseContract.valid(c));}return new JSONObject().put("trajectoryId",found.getJSONObject("trajectory").getString("id")).put("modelCalls",calls.length());}
   SystemClock.sleep(250);
  }throw new AssertionError("Correlated initial resident trajectory not complete");
 }
 @Test public void serviceBootAuthenticatedChatAndRestartPersists()throws Throwable {
  Assume.assumeTrue("Explicit resident fixture required","1".equals(InstrumentationRegistry.getArguments().getString("residentService")));
  assertTrue(BuildConfig.DEBUG);assertEquals("arm64-v8a",Build.SUPPORTED_ABIS[0]);assertTrue("Never run in user0",Process.myUid()/100000>0);
  context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertTrue("Fixture user must be unlocked",context.getSystemService(android.os.UserManager.class).isUserUnlocked());File input=new File(context.getFilesDir(),"resident-provider-input.json");assertTrue(input.isFile());assertEquals(0,Os.stat(input.getPath()).st_mode&0077);assertEquals(Process.myUid(),Os.stat(input.getPath()).st_uid);
  try(InputStream stream=new FileInputStream(input)){fixture=new JSONObject(new String(bounded(stream,16384),StandardCharsets.UTF_8));}assertTrue(input.delete());
  assertEquals(InstrumentationRegistry.getArguments().getString("residentRunId"),fixture.getString("runId"));assertNull("Fresh credential slot",new AlphaCredentialStore(context).readCredentialSlot("local-agent-provider:v1"));
  File bun=new File(context.getApplicationInfo().nativeLibraryDir,"libeliza_bun.so");assertEquals(fixture.getString("bunSha256"),fileHash(bun));
  try(InputStream in=new FileInputStream(bun)){byte[] h=new byte[20];assertEquals(20,in.read(h));assertEquals(0x7f,h[0]&255);assertEquals('E',h[1]);assertEquals('L',h[2]);assertEquals('F',h[3]);assertEquals(2,h[4]);assertEquals(1,h[5]);assertEquals(183,(h[18]&255)|((h[19]&255)<<8));}
  try(InputStream in=context.getAssets().open("agent/agent-bundle.js")){assertEquals(fixture.getString("bundleSha256"),boundedHash(in,128L*1024*1024));}
  try(InputStream in=context.getAssets().open("agent/alpha-source.json")){assertEquals(fixture.getString("sourceSha256"),boundedHash(in,8L*1024*1024));}
  JSONObject child=null,proof=new JSONObject().put("runId",fixture.getString("runId")).put("scope","native-service-instrumentation").put("uiAcceptance",false).put("ordinaryBackgroundStartAcceptance",false).put("passed",false);
  Throwable failure=null;
  try {
    assertFalse(ElizaAgentService.getLocalAgentBootState(context).optBoolean("socketListening"));
    new AlphaCredentialStore(context).writeCredentialSlot("local-agent-provider:v1",new JSONObject().put("key",fixture.getString("apiKey")).put("model","qwen-3.8-27b").toString());fixture.remove("apiKey");
    startAndEnroll();proof.put("ownerEnrollmentCompleted",true);child=ownedChild();proof.put("firstProcess",child);
    assertEquals(fixture.getString("bundleSha256"),fileHash(new File(context.getFilesDir(),"agent/agent-bundle.js")));
    JSONObject who=owner(),agent=agent();proof.put("ownerAuthenticated",true);String ownerId=who.getJSONObject("identity").getString("id"),agentId=agent.getString("id");
    int denied=nativeGet("/api/conversations","synthetic-invalid-bearer").getInt("status");assertTrue("Explicit invalid bearer must deny",denied==401||denied==403);proof.put("invalidBearerDenied",true);

    String label="Resident fixture "+fixture.getString("runId");JSONObject conversation=request("/api/conversations",new JSONObject().put("title",label)).getJSONObject("conversation");String id=conversation.getString("id"),room=conversation.getString("roomId");assertTrue(id.matches("[A-Za-z0-9_-]+"));assertTrue(room.matches("[A-Za-z0-9_-]+"));assertEquals(0,history(id).length());
    JSONObject reply=request("/api/conversations/"+id+"/messages",new JSONObject().put("text",label+": Reply with the value of seven times eight. Do not use tools or create anything.").put("channelType","DM").put("clientMessageId",UUID.randomUUID().toString()));assertFalse("Actual resident reply required",reply.getString("text").trim().isEmpty());assertTrue(reply.getString("text").contains("56"));proof.put("syntheticReplyValidated",true).put("replyLength",reply.getString("text").length()).put("replySha256",hash(reply.getString("text").getBytes(StandardCharsets.UTF_8)));
    proof.put("model",trace(room,reply.getString("userMessageId")));JSONArray before=history(id);assertTrue(before.length()>=2);String historyHash=hash(before.toString().getBytes(StandardCharsets.UTF_8));
    ElizaAgentService.stop(context);stopped(child);JSONObject old=child;child=null;
    startAndEnroll();child=ownedChild();assertNotEquals("Real native process restart",old.getInt("pid"),child.getInt("pid"));
    assertEquals(ownerId,owner().getJSONObject("identity").getString("id"));assertEquals(agentId,agent().getString("id"));assertEquals(historyHash,hash(history(id).toString().getBytes(StandardCharsets.UTF_8)));
    proof.put("secondProcess",child).put("ownerId",ownerId).put("agentId",agentId).put("conversationId",id).put("historySha256",historyHash).put("passed",true);
  } catch(Throwable error) {failure=error;} finally {
    try {ElizaAgentService.stop(context);stopped(child);proof.put("socketStopped",true).put("serviceStopped",true);}
    catch(Throwable cleanup) {if(failure==null)failure=cleanup;else failure.addSuppressed(cleanup);proof.put("cleanupFailed",true);}
    // Write a scoped failure record even if stop verification failed; never replace the primary failure.
    try {
      proof.put("traceDiagnostics",traceDiagnostics);proof.put("passed",failure==null&&proof.optBoolean("passed"));
      try(FileOutputStream output=context.openFileOutput("resident-service-complete.json",Context.MODE_PRIVATE)){output.write(proof.toString().getBytes(StandardCharsets.UTF_8));}
    } catch(Throwable write) {if(failure==null)failure=write;else failure.addSuppressed(write);}
    ownerBearer=null;ownerIdentityId=null;
  }
  if(failure!=null)throw failure;
 }
}
