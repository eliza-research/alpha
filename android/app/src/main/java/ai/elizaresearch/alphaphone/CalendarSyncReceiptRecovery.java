package ai.elizaresearch.alphaphone;
import org.json.JSONArray;
import org.json.JSONObject;
/** Observed local postconditions settle native receipts without redispatching a provider write. */
final class CalendarSyncReceiptRecovery {
 private CalendarSyncReceiptRecovery(){}
 static JSONArray observe(JSONObject document,String scope,String eventId,String revision,String semanticHash,JSONObject event)throws Exception{
  JSONArray recovered=new JSONArray();JSONObject operations=document.getJSONObject("operations");
  for(var keys=operations.keys();keys.hasNext();){String id=keys.next();JSONObject row=operations.getJSONObject(id);
   if(row.optBoolean("acknowledged")||!scope.equals(row.optString("scope"))||!"apply".equals(row.optString("kind"))||!eventId.equals(row.optString("eventId"))||!semanticHash.equals(row.optString("semanticHash")))continue;
   JSONObject outcome=row.optJSONObject("outcome");String status=outcome==null?"unknown":outcome.optString("status");
   if(!status.equals("unknown")&&!status.equals("saved"))continue;
   row.put("phase","terminal").put("outcome",new JSONObject().put("status","saved").put("recovered",true).put("snapshot",new JSONObject().put("eventId",eventId).put("revision",revision).put("event",new JSONObject(event.toString()))));recovered.put(id);
  }
  return recovered;
 }
 /** True once the deletion journal settled the queued operation (deleted, undone or conflict). */
 interface Settled{boolean test(String operationId)throws Exception;}
 /** At the 128-row cap, drop the oldest settled receipts (acknowledged first) down to 63 rows.
  * Dispatching or unconfirmed writes and queued deletions the journal has not settled remain fenced. */
 static void prune(JSONObject operations,Settled settled)throws Exception{
  java.util.ArrayList<String> terminal=new java.util.ArrayList<>();
  for(var keys=operations.keys();keys.hasNext();){String id=keys.next();JSONObject row=operations.getJSONObject(id),outcome=row.optJSONObject("outcome");
   if(!"terminal".equals(row.optString("phase"))||outcome==null)continue;
   if(!row.optBoolean("acknowledged")){
    String status=outcome.optString("status");
    if("queued".equals(status)){if(!settled.test(id))continue;}
    else if(!"saved".equals(status)&&!"conflict".equals(status))continue;
   }
   terminal.add(id);
  }
  terminal.sort(java.util.Comparator.<String,Boolean>comparing(id->!operations.optJSONObject(id).optBoolean("acknowledged")).thenComparingLong(id->operations.optJSONObject(id).optLong("createdAt")));
  for(String id:terminal){if(operations.length()<64)break;operations.remove(id);}
 }
}
