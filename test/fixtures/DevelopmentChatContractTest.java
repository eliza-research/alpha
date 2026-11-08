package ai.elizaresearch.alphaphone;

import org.json.JSONArray;
import org.json.JSONObject;

/** Host-JVM run of the development agent's /chat limits and proposal checks. Prints one JSON line. */
public final class DevelopmentChatContractTest {
 public static void main(String[] args) throws Exception {
  long phone = 1_800_000_000_000L, ahead = 120000;
  JSONObject context = new JSONObject().put("view","notes").put("revision",3), out = new JSONObject();
  out.put("text12000", DevelopmentChatContract.chatBody(body("a".repeat(12000), context)) != null);
  out.put("text12001", DevelopmentChatContract.chatBody(body("a".repeat(12001), context)) != null);
  out.put("wideText", DevelopmentChatContract.chatBody(body("€".repeat(11000), context)) != null);
  // The host stamped these on its clock, which is two minutes behind the phone's.
  long host = phone - ahead;
  JSONArray input = new JSONArray()
   .put(note("fresh", host + 120000, 3))
   .put(note("expired", host - 1000, 3))
   .put(note("stale-context", host + 120000, 2))
   .put(note("fresh", host + 120000, 3));
  out.put("withDate", DevelopmentChatContract.proposals(input, context, host, phone));
  out.put("withoutDate", DevelopmentChatContract.proposals(new JSONArray().put(note("skewed", phone - 30000, 3)).put(note("late", phone - 90000, 3)), context, 0, phone));
  JSONObject longest = note("longest", phone + 60000, 3), over = note("over", phone + 60000, 3);
  longest.getJSONObject("operation").put("title","N".repeat(256)).put("body","B".repeat(32000));
  over.getJSONObject("operation").put("title","N".repeat(257));
  out.put("noteLimits", DevelopmentChatContract.proposals(new JSONArray().put(longest).put(over), context, phone, phone));
  out.put("phone", phone);
  System.out.println(out);
 }
 private static JSONObject body(String text, JSONObject context) throws Exception {
  return new JSONObject().put("requestId","r1").put("text",text).put("context",context);
 }
 private static JSONObject note(String id, long expiresAt, long revision) throws Exception {
  return new JSONObject().put("id",id).put("title","Preview").put("description","Development simulation").put("expiresAt",expiresAt)
   .put("contextRevision",revision).put("simulated",true).put("operation",new JSONObject().put("type","create_note").put("title","N").put("body","B"));
 }
}
