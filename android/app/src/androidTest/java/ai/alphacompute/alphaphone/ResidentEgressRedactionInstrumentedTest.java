package ai.alphacompute.alphaphone;

import static org.junit.Assert.*;

import android.content.Context;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Resident agent with ELIZA_SECRET_SWAP_ENABLED/ELIZA_PII_SWAP_ENABLED on: the turn completes, and the recorded
 * provider request carries swap placeholders, never the raw identifiers. Requires an explicit fixture
 * (scripts/android-resident-instrumentation.ts); a recorded trajectory is the request after the swap.
 * Besides the contact identifiers, each RELEASE content class (a vault entry, a TOTP code, recovery
 * codes, an API-key-shaped token, and selected note, mail and file context) is sent in its own
 * conversation; its recorded requests must carry a placeholder and none of its raw value.
 */
@RunWith(AndroidJUnit4.class)
public class ResidentEgressRedactionInstrumentedTest {
 private static final String[] RAW={"jane.okafor@acmecapital.com","4111 1111 1111 1111","123-45-6789"};
 /** {class, context text, raw value that must never reach the provider}. Synthetic values only. */
 private static final String[][] CLASSES={
  {"vault-entry","Saved login for synthetic.example.invalid: username jane, password \"VaultTailQ4xR9!\"","VaultTailQ4xR9!"},
  {"totp","Your one-time verification code is 480216. It expires in 30 seconds.","480216"},
  {"recovery-codes","Recovery codes: RCVY-4K9M-2P7X RCVY-8D3N-5T1V RCVY-6H2J-9Q4W","RCVY-4K9M-2P7X"},
  {"api-key","API key: sk-synthetic-2b7f3c9d4e1a6b8c0d2e4f6a8b0c1d3e","sk-synthetic-2b7f3c9d4e1a6b8c0d2e4f6a8b0c1d3e"},
  {"selected-note","Selected note \"Accounts\": the passphrase is \"NoteTail Kp2 Vw8\"","NoteTail Kp2 Vw8"},
  {"selected-mail","Selected mail from billing@example.invalid: your password was reset to \"MailTailM3nB7\"","MailTailM3nB7"},
  {"selected-file","Selected file credentials.txt: DB_PASSWORD=FileTailZ5cL1","FileTailZ5cL1"},
 };
 private Context context;private String root;
 private static String sha256(String text)throws Exception{StringBuilder value=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))value.append(String.format(Locale.ROOT,"%02x",b&255));return value.toString();}
 private JSONObject call(String path,String method,JSONObject body)throws Exception{
  JSONObject headers=new JSONObject().put("Authorization","Bearer "+root);
  JSONObject args=new JSONObject().put("path",path).put("method",method).put("headers",headers).put("timeoutMs",120000);
  if(body!=null)args.put("body",body.toString());
  JSONObject result=new JSONObject(ElizaAgentService.requestLocalAgent(args.toString()));
  assertEquals("HTTP "+path+" "+result.optString("body"),200,result.getInt("status"));return new JSONObject(result.getString("body"));
 }
 /**
  * The provider requests recorded for every trajectory of one room, task trajectories included (the request after
  * the swap). Polls until the room's trajectories and their end times stay unchanged for a settle window, so a
  * model call that finishes after the reply is still inspected; fails if any is unfinished at the deadline.
  */
 private JSONArray recordedCalls(String room)throws Exception{
  long end=SystemClock.elapsedRealtime()+60000,stableSince=0;String seen=null;boolean finished=false;JSONArray llm=new JSONArray();
  while(SystemClock.elapsedRealtime()<end){
   JSONArray list=call("/api/trajectories?limit=100&roomId="+room,"GET",null).getJSONArray("trajectories");
   java.util.TreeMap<String,String> state=new java.util.TreeMap<>();JSONArray calls=new JSONArray();finished=true;
   for(int i=0;i<list.length();i++){String trajectory=list.getJSONObject(i).getString("id");JSONObject d=call("/api/trajectories/"+trajectory+"?includePayloads=1","GET",null);
    boolean done=!d.getJSONObject("trajectory").isNull("endTime");finished&=done;state.put(trajectory,done?d.getJSONObject("trajectory").get("endTime").toString():"");
    if(d.has("llmCalls"))for(int j=0;j<d.getJSONArray("llmCalls").length();j++)calls.put(d.getJSONArray("llmCalls").getJSONObject(j));}
   String now=state.toString();long at=SystemClock.elapsedRealtime();
   if(!now.equals(seen)){seen=now;stableSince=at;}
   llm=calls;
   if(finished&&!state.isEmpty()&&at-stableSince>=5000)return llm;
   SystemClock.sleep(500);}
  assertTrue("Room "+room+" has a trajectory still unfinished at the deadline: "+seen,finished);
  return llm;
 }
 @Test public void swappedTurnCompletesWithoutRawIdentifiers()throws Exception{
  Assume.assumeTrue("1".equals(InstrumentationRegistry.getArguments().getString("residentService")));
  context=InstrumentationRegistry.getInstrumentation().getTargetContext();
  File input=new File(context.getFilesDir(),"resident-provider-input.json");
  JSONObject fixture=new JSONObject(new String(Files.readAllBytes(input.toPath()),StandardCharsets.UTF_8));assertTrue(input.delete());
  new AlphaCredentialStore(context).writeCredentialSlot("local-agent-provider:v1",new JSONObject().put("key",fixture.getString("apiKey")).put("model","qwen-3.8-27b").toString());
  assertTrue(context.getSharedPreferences("CapacitorStorage",Context.MODE_PRIVATE).edit().putString("eliza:mobile-runtime-mode","cloud-hybrid").commit());
  JSONObject proof=new JSONObject().put("runId",fixture.getString("runId")).put("scope","resident-egress-redaction").put("passed",false);
  try{
   ElizaAgentService.start(context);
   long deadline=SystemClock.elapsedRealtime()+90000;JSONObject status=null;
   while(SystemClock.elapsedRealtime()<deadline&&status==null){try{root=ElizaAgentService.localAgentToken(context);if(root!=null&&!root.isEmpty())status=call("/api/auth/status","GET",null);}catch(Exception e){status=null;}if(status==null)SystemClock.sleep(250);}
   assertNotNull("resident readiness",status);
   JSONObject conversation=call("/api/conversations","POST",new JSONObject().put("title","Redaction probe")).getJSONObject("conversation");
   String id=conversation.getString("id"),room=conversation.getString("roomId");
   JSONObject reply=call("/api/conversations/"+id+"/messages","POST",new JSONObject().put("text","Context only, do not repeat it: email "+RAW[0]+", card "+RAW[1]+", SSN "+RAW[2]+". Reply with the value of seven times eight. Do not use tools or create anything.").put("channelType","DM").put("clientMessageId",UUID.randomUUID().toString()));
   String text=reply.getString("text");proof.put("replyLength",text.length()).put("replySha256",sha256(text)).put("replyHas56",text.contains("56"));
   for(String raw:RAW)proof.put("replyContains:"+raw,text.contains(raw));
   JSONArray llm=recordedCalls(room);
   String recorded=llm.toString();proof.put("recordedLlmCalls",llm.length()).put("recordedHasSecretPlaceholder",recorded.contains("__ELIZA_SECRET_"));
   for(String raw:RAW)proof.put("recordedContains:"+raw,recorded.contains(raw));
   boolean clean=llm.length()>0&&recorded.contains("__ELIZA_SECRET_");for(String raw:RAW)clean&=!recorded.contains(raw);
   // Content classes: one conversation each, so a recorded request belongs to exactly one class.
   boolean classesClean=true;JSONObject classes=new JSONObject();
   for(String[] probe:CLASSES){
    JSONObject owned=call("/api/conversations","POST",new JSONObject().put("title","Redaction probe "+probe[0])).getJSONObject("conversation");
    JSONObject answer=call("/api/conversations/"+owned.getString("id")+"/messages","POST",new JSONObject().put("text","Here is context I selected:\n"+probe[1]+"\nReply only with the word noted. Do not repeat the context, send anything or use tools.").put("channelType","DM").put("clientMessageId",UUID.randomUUID().toString()));
    String calls=recordedCalls(owned.getString("roomId")).toString();
    boolean placeholder=calls.contains("__ELIZA_SECRET_"),raw=calls.contains(probe[2]),replied=answer.getString("text").contains(probe[2]);
    classes.put(probe[0],new JSONObject().put("recorded",calls.length()>2).put("placeholder",placeholder).put("rawRecorded",raw).put("rawInReply",replied));
    classesClean&=calls.length()>2&&placeholder&&!raw&&!replied;
   }
   proof.put("contentClasses",classes).put("contentClassesClean",classesClean);
   proof.put("passed",text.contains("56")&&clean&&classesClean);
  }finally{
   ElizaAgentService.stop(context);
   try(java.io.FileOutputStream out=context.openFileOutput("resident-redaction-complete.json",Context.MODE_PRIVATE)){out.write(proof.toString().getBytes(StandardCharsets.UTF_8));}
  }
  assertTrue("Swapped turn must complete and egress no raw identifiers: "+proof,proof.getBoolean("passed"));
 }
}
