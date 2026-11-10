package ai.elizaresearch.alphaphone;
import ai.eliza.plugins.notifications.NoticeRecovery;
import java.nio.charset.StandardCharsets;import java.security.MessageDigest;import java.util.*;import org.json.*;
public final class WorkflowNoticeRecoveryTest {
 static void check(boolean condition){if(!condition)throw new AssertionError();}
 static String hash(JSONArray parts)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(parts.toString().getBytes(StandardCharsets.UTF_8)))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
 public static void main(String[] args)throws Exception{
  String scope="a".repeat(64),id="proposal",operationId="notice";JSONObject operation=new JSONObject().put("type","post_notification").put("title","Reviewed title").put("body","Reviewed body");
  JSONObject record=new JSONObject().put("ownerId","owner").put("agentId","agent").put("sessionId","session").put("origin","https://agent.test").put("installationId","installation").put("enrollmentId","enrollment").put("digest","digest").put("operation",operation).put("workflow",new JSONObject().put("runId","run"));
  JSONObject entry=new JSONObject().put("scope",scope).put("proposalId",id).put("operationId",operationId).put("record",record).put("phase","applying").put("attemptId","attempt");String binding=hash(new JSONArray().put(scope).put("owner").put("agent").put("session").put("https://agent.test").put("installation").put("enrollment").put(id).put("digest").put(operationId));
  Map<String,String> saved=new HashMap<>();int[] posts={0};boolean[] visible={true};WorkflowNoticeDelivery delivery=new WorkflowNoticeDelivery(new WorkflowNoticeDelivery.Storage(){public String read(String key){return saved.get(key);}public void write(String key,String value){saved.put(key,value);}},new WorkflowNoticeDelivery.Poster(){public boolean allowed(){return true;}public void post(String id,String title,String body){posts[0]++;}public boolean matches(String id,String title,String body){return visible[0];}});
  check(NoticeRecovery.recover(entry,scope,id,binding,delivery::receipt)==entry);check(posts[0]==0);
  delivery.publish(operationId,binding,"Reviewed title","Reviewed body");visible[0]=false;
  JSONObject recovered=NoticeRecovery.recover(entry,scope,id,binding,delivery::receipt);check(recovered.getString("status").equals("succeeded"));check(entry.getString("phase").equals("applying"));check(posts[0]==1);
  check(NoticeRecovery.recover(recovered,scope,id,binding,delivery::receipt)==recovered);
  JSONObject unknown=new JSONObject(entry.toString()).put("phase","terminal").put("status","unknown");check(NoticeRecovery.recover(unknown,scope,id,binding,delivery::receipt).getString("status").equals("succeeded"));
  for(String changed:List.of("ownerId","sessionId","enrollmentId","digest")){JSONObject bad=new JSONObject(entry.toString());bad.getJSONObject("record").put(changed,"changed");try{NoticeRecovery.recover(bad,scope,id,binding,delivery::receipt);throw new AssertionError();}catch(IllegalStateException expected){}}
  JSONObject changed=new JSONObject(entry.toString());changed.getJSONObject("record").getJSONObject("operation").put("body","changed");try{NoticeRecovery.recover(changed,scope,id,binding,delivery::receipt);throw new AssertionError();}catch(IllegalStateException expected){}
  for(String phase:List.of("reserved","invalid")){JSONObject bad=new JSONObject(entry.toString()).put("phase",phase);try{NoticeRecovery.recover(bad,scope,id,binding,delivery::receipt);throw new AssertionError();}catch(IllegalStateException expected){}}
  JSONObject failed=new JSONObject(entry.toString()).put("phase","terminal").put("status","failed");check(NoticeRecovery.recover(failed,scope,id,binding,delivery::receipt)==failed);check(posts[0]==1);
  System.out.println("PASS workflow recovery");
 }
}
