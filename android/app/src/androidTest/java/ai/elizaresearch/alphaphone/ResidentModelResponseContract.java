package ai.elizaresearch.alphaphone;

import java.util.HashSet;
import org.json.JSONArray;
import org.json.JSONObject;

/** Fixture validation of Eliza Cloud's normalized Cerebras model result. */
final class ResidentModelResponseContract {
 private ResidentModelResponseContract() {}
 static boolean valid(JSONObject call) {
  Object response=call.opt("response");
  if(response instanceof String && !((String)response).trim().isEmpty())return true;
  if(!(response instanceof String) || !"tool-calls".equals(call.optString("finishReason")))return false;
  JSONArray calls=call.optJSONArray("toolCalls");
  if(calls==null || calls.length()==0)return false;
  HashSet<String> ids=new HashSet<>();
  for(int i=0;i<calls.length();i++) {
   JSONObject tool=calls.optJSONObject(i);
   if(tool==null)return false;
   Object id=tool.opt("id"),name=tool.opt("name");
   if(!(id instanceof String) || ((String)id).trim().isEmpty() || !ids.add((String)id)
      || !(name instanceof String) || ((String)name).trim().isEmpty()
      || !(tool.opt("arguments") instanceof JSONObject))return false;
  }
  return true;
 }
}
