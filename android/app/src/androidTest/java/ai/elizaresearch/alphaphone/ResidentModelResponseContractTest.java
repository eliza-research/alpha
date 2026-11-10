package ai.elizaresearch.alphaphone;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public final class ResidentModelResponseContractTest {
 private JSONObject tool() throws Exception {
  return new JSONObject().put("id","synthetic-call").put("name","respond").put("arguments",new JSONObject().put("text","56"));
 }
 private JSONObject response() throws Exception {
  return new JSONObject().put("response","").put("finishReason","tool-calls").put("toolCalls",new JSONArray().put(tool()));
 }
 @Test public void normalizedToolOnlyResponseIsValid()throws Exception {
  assertTrue(ResidentModelResponseContract.valid(response()));
 }
 @Test public void visibleTextResponseIsValid()throws Exception {
  assertTrue(ResidentModelResponseContract.valid(new JSONObject().put("response","56")));
 }
 @Test public void emptyOrMalformedStructuredResponseIsRejected()throws Exception {
  assertFalse(ResidentModelResponseContract.valid(new JSONObject().put("response","")));
  assertFalse(ResidentModelResponseContract.valid(response().put("toolCalls",new JSONArray())));
  assertFalse(ResidentModelResponseContract.valid(response().put("finishReason","stop")));
  for(String field:new String[]{"id","name","arguments"}) {
   JSONObject malformed=tool();malformed.remove(field);
   assertFalse(ResidentModelResponseContract.valid(response().put("toolCalls",new JSONArray().put(malformed))));
  }
  assertFalse(ResidentModelResponseContract.valid(response().put("toolCalls",new JSONArray().put(tool().put("arguments","{}")))));
  assertFalse(ResidentModelResponseContract.valid(response().put("toolCalls",new JSONArray().put(tool()).put(tool()))));
  assertFalse(ResidentModelResponseContract.valid(response().put("response",JSONObject.NULL)));
 }
}
