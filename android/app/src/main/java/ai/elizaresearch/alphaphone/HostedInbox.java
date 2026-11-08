package ai.elizaresearch.alphaphone;

import java.util.*;
import org.json.*;

/** One owner for foreground and background receipt persistence. Never executes a workflow. */
final class HostedInbox {
 interface Store { String read(String slot)throws Exception; void write(String slot,String value)throws Exception; void remove(String slot)throws Exception; }
 interface Transport { JSONObject request(String path,JSONObject body)throws Exception; void check()throws Exception; }
 interface DeliveryTransport extends Transport,AutoCloseable { void verify()throws Exception; void close(); }
 interface Fence { void check()throws Exception; }
 private final Store store;
 private final Object gate;
 private final HostedResultNotices notices;
 HostedInbox(Store store,Object gate,HostedResultNotices notices){this.store=store;this.gate=gate;this.notices=notices;}
 static String id(String value)throws Exception {if(value==null||!value.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))throw new IllegalArgumentException("Invalid result identity");return value;}
 static JSONObject parse(String raw)throws Exception {JSONObject value=new JSONObject(raw);if(raw.length()>200000)throw new IllegalArgumentException("Result too large");long cursor=value.getLong("cursor");if(cursor<1||cursor>9007199254740991L||value.getDouble("cursor")!=cursor)throw new IllegalArgumentException("Invalid cursor");for(String field:new String[]{"runId","workflowId","workflowVersionId","templateVersion"})id(value.getString(field));for(String field:new String[]{"scheduledAt","startedAt","completedAt"})java.time.Instant.parse(value.getString(field));value.getJSONObject("source");value.getString("status");JSONObject result=new JSONObject();for(String field:new String[]{"cursor","runId","workflowId","workflowVersionId","templateVersion","scheduledAt","source","status","startedAt","completedAt","output"})result.put(field,value.get(field));result.put("error",value.opt("error") instanceof String?value.get("error"):JSONObject.NULL);return result;}
 private JSONObject index(String slot)throws Exception {try{return readIndex(slot);}catch(HostedStorageFault e){throw e;}catch(Exception e){throw new HostedStorageFault(e);}}
 private JSONObject readIndex(String slot)throws Exception {String raw=store.read(slot);if(raw==null)return new JSONObject().put("clientId",UUID.randomUUID().toString()).put("ids",new JSONArray());JSONObject index=new JSONObject(raw);id(index.getString("clientId"));for(String key:new String[]{"ids","pendingRemoval","pendingNotices"}){JSONArray values=index.optJSONArray(key);if(values==null){if(index.has(key)||key.equals("ids"))throw new IllegalStateException("Invalid saved inbox");continue;}Set<String> seen=new HashSet<>();if(values.length()>200)throw new IllegalStateException("Invalid saved inbox");for(int i=0;i<values.length();i++)if(!seen.add(id(values.getString(i))))throw new IllegalStateException("Duplicate saved result");}return index;}
 private static List<String> ids(JSONObject value,String key)throws Exception {List<String> result=new ArrayList<>();JSONArray a=value.optJSONArray(key);if(a!=null)for(int i=0;i<a.length();i++)result.add(a.getString(i));return result;}
 JSONArray history(String slot)throws Exception {synchronized(gate){JSONObject index=index(slot);JSONArray out=new JSONArray();for(String run:ids(index,"ids")){String raw=store.read(slot+":"+run);if(raw==null)throw new HostedStorageFault(new IllegalStateException("Saved result missing"));JSONObject item;try{item=parse(raw);}catch(Exception e){throw new HostedStorageFault(e);}if(!run.equals(item.getString("runId")))throw new HostedStorageFault(new IllegalStateException("Saved result changed"));out.put(item);}return out;}}
 private void recover(String slot,JSONObject index)throws Exception {List<String> retained=ids(index,"ids");for(String run:ids(index,"pendingRemoval"))if(!retained.contains(run))store.remove(slot+":"+run);index.put("pendingRemoval",new JSONArray());store.write(slot,index.toString());}
 private void notifyPending(String slot,JSONObject index,JSONObject binding,Fence fence)throws Exception {List<String> pending=ids(index,"pendingNotices");for(String run:new ArrayList<>(pending)){fence.check();if(ids(index,"ids").contains(run)){JSONObject item=parse(store.read(slot+":"+run));JSONObject route=new JSONObject();for(String name:new String[]{"scope","origin","ownerId","agentId"})route.put(name,binding.get(name));for(String name:new String[]{"runId","workflowId","workflowVersionId"})route.put(name,item.get(name));try{notices.publish(route);}catch(Exception error){fence.check();continue;}}pending.remove(run);index.put("pendingNotices",new JSONArray(pending));store.write(slot,index.toString());}}
 /** Caller serializes sync runs; gate is held only for local commits, never HTTP. */
 JSONArray sync(JSONObject binding,Transport transport,Fence fence)throws Exception {
  String slot="hosted-digests:v1:"+binding.getString("scope");JSONObject index;
  synchronized(gate){fence.check();index=index(slot);history(slot);recover(slot,index);notifyPending(slot,index,binding,fence);}
  for(int page=0;page<2;page++){
   transport.check();JSONObject response=transport.request("/api/workflow/hosted/results?clientId="+id(index.getString("clientId")),null);JSONArray entries=response.getJSONArray("entries");if(entries.length()>50)throw new IllegalStateException("Invalid result page");if(entries.length()==0)break;
   List<JSONObject> parsed=new ArrayList<>();long previous=0;for(int i=0;i<entries.length();i++){JSONObject item=parse(entries.getJSONObject(i).toString());if(item.getLong("cursor")<=previous)throw new IllegalStateException("Unordered results");previous=item.getLong("cursor");parsed.add(item);}
   synchronized(gate){fence.check();transport.check();List<String> retained=ids(index,"ids"),pending=ids(index,"pendingNotices");for(JSONObject item:parsed){String run=item.getString("runId"),key=slot+":"+run;String old=store.read(key);boolean replaced=false;if(old!=null){JSONObject saved=parse(old);if(!equivalent(saved,item)){if(!acceptsReconciledReplacement(saved,item))throw new IllegalStateException("Saved result changed");store.write(key,item.toString());replaced=true;}}else store.write(key,item.toString()); // Preserve original bytes of every legacy/previous record.
     boolean added=!retained.contains(run);if(added)retained.add(run);if((added||replaced)&&!pending.contains(run))pending.add(run);}
    List<String> removed=ids(index,"pendingRemoval");while(retained.size()>100){String run=retained.remove(0);if(!removed.contains(run))removed.add(run);}pending.retainAll(retained);index.put("ids",new JSONArray(retained)).put("pendingNotices",new JSONArray(pending)).put("pendingRemoval",new JSONArray(removed));store.write(slot,index.toString());notifyPending(slot,index,binding,fence);
   }
   transport.check();synchronized(gate){fence.check();}JSONObject last=parsed.get(parsed.size()-1);transport.request("/api/workflow/hosted/results/ack",new JSONObject().put("clientId",index.getString("clientId")).put("cursor",last.getLong("cursor")).put("runId",last.getString("runId")));
   synchronized(gate){fence.check();recover(slot,index);}
  }
  synchronized(gate){fence.check();return history(slot);}
 }
 /** The agent may replace a provisional cancellation once the native terminal arrives; any other change is tampering. */
 static boolean acceptsReconciledReplacement(JSONObject saved,JSONObject next)throws Exception {for(String field:new String[]{"runId","workflowId","workflowVersionId","templateVersion","scheduledAt","source"})if(!equivalent(saved.get(field),next.get(field)))return false;return saved.getString("status").equals("cancelled")&&!next.getString("status").equals("cancelled")&&next.getLong("cursor")>saved.getLong("cursor");}
 private static boolean equivalent(Object a,Object b)throws Exception {if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;Iterator<String> keys=x.keys();while(keys.hasNext()){String key=keys.next();if(!y.has(key)||!equivalent(x.get(key),y.get(key)))return false;}return true;}if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!equivalent(x.get(i),y.get(i)))return false;return true;}if(a instanceof Number&&b instanceof Number)return new java.math.BigDecimal(a.toString()).compareTo(new java.math.BigDecimal(b.toString()))==0;return Objects.equals(a,b);}
}
