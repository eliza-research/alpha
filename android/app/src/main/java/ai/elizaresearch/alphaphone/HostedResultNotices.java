package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.notifications.NoticeOwner;
import org.json.JSONArray;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.UUID;

/** Durable, redacted notice projection; it never schedules or executes a workflow. */
final class HostedResultNotices {
 interface Storage { String read(String slot)throws Exception; void write(String slot,String value)throws Exception; }
 interface Poster { boolean allowed(); boolean active(String key); void post(String key); void cancel(String key); }
 /** A daily brief supersedes the previous one; an unopened result notice withdraws itself after a day. History stays in the inbox. */
 static final long SUPERSEDE_AFTER_MS=24L*3600000;
 /** Source renewal notices appear within the final 24 hours of a reviewed source and withdraw themselves at expiry. */
 static final long RENEWAL_WINDOW_MS=24L*3600000, MAXIMUM_SOURCE_MS=7L*86400000+3600000;
 static String sourceId(String value){if(value==null||!value.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}"))throw new IllegalArgumentException("Invalid source identity");return value;}
 /** Delay before the renewal notice, or -1 when the source already expired (nothing to renew in place). */
 static long renewalDelay(long expiresAt,long now){if(expiresAt-now>MAXIMUM_SOURCE_MS)throw new IllegalArgumentException("Source expiry exceeds the reviewed bound");if(expiresAt<=now)return -1;return Math.max(0,expiresAt-RENEWAL_WINDOW_MS-now);}
 /** The renewal notice disappears when the source expires; the in-app notice then shows the paused loop. */
 static long renewalTimeout(long expiresAt,long now){return Math.max(1,expiresAt-now);}
 static final String LEDGER="hosted-notices:v1", PENDING="hosted-notices:pending:v1", OWNER="hosted-notices:owner:v1";
 private final Storage storage; private final Poster poster;
 HostedResultNotices(Storage storage,Poster poster){this.storage=storage;this.poster=poster;}
 static String hash(String value)throws Exception {byte[] digest=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:digest)out.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return out.toString();}
 private JSONObject read(String slot)throws Exception {String value=storage.read(slot);return value==null?new JSONObject():new JSONObject(value);}
 private void write(String slot,JSONObject value)throws Exception {storage.write(slot,value.toString());}
 private static String required(JSONObject value,String name)throws Exception {String text=value.getString(name);if(text.isBlank()||text.length()>2048)throw new IllegalArgumentException("Invalid notice identity");return text;}
 private JSONObject result(JSONObject route)throws Exception {
  String scope=required(route,"scope"),origin=required(route,"origin"),owner=required(route,"ownerId"),agent=required(route,"agentId"),run=required(route,"runId");
  if(!scope.matches("[a-f0-9]{64}")||!run.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")||!scope.equals(hash(new JSONArray().put(origin).put(owner).put(agent).toString())))throw new IllegalArgumentException("Notice scope mismatch");
  String slot="hosted-digests:v1:"+scope;JSONObject index=read(slot);JSONArray ids=index.optJSONArray("ids");boolean found=false;
  if(ids!=null)for(int i=0;i<ids.length();i++)if(run.equals(ids.getString(i)))found=true;
  if(!found)throw new IllegalStateException("Result is not retained");
  JSONObject result=read(slot+":"+run);
  if(!run.equals(result.optString("runId"))||!required(route,"workflowId").equals(result.optString("workflowId"))||!required(route,"workflowVersionId").equals(result.optString("workflowVersionId")))throw new IllegalStateException("Retained result mismatch");
  return result;
 }
 private boolean ownerMatches(JSONObject route)throws Exception {String raw=storage.read(OWNER);if(raw==null)return true;return NoticeOwner.matches(new JSONObject(raw).optJSONObject("owner"),route);}
 synchronized void withdrawOtherOwners(JSONObject owner)throws Exception {
  write(OWNER,new JSONObject().put("owner",owner==null?JSONObject.NULL:NoticeOwner.identity(owner)));JSONObject ledger=read(LEDGER),pending=read(PENDING);
  ArrayList<String> keys=new ArrayList<>();ledger.keys().forEachRemaining(keys::add);
  for(String key:keys){JSONObject record=ledger.getJSONObject(key);if(ownerMatches(record))continue;record.put("phase","owner-withdrawn");write(LEDGER,ledger);poster.cancel(key);if(key.equals(pending.optString("key")))write(PENDING,new JSONObject());}
 }
 synchronized String publish(JSONObject requested)throws Exception {
  if(!ownerMatches(requested))return "owner-changed";
  JSONObject result=result(requested);String digest=hash(result.toString()),key=hash(requested.getString("scope")+":"+requested.getString("runId"));
  JSONObject ledger=read(LEDGER),record=ledger.optJSONObject(key);
  if(record!=null){
   if(!digest.equals(record.getString("digest")))throw new IllegalStateException("Retained result changed");
   String phase=record.getString("phase");
   if(phase.equals("dispatching")){record.put("phase",poster.active(key)?"posted":"uncertain");write(LEDGER,ledger);}
   return record.getString("phase");
  }
  record=new JSONObject();for(String field:new String[]{"scope","origin","ownerId","agentId","runId","workflowId","workflowVersionId"})record.put(field,required(requested,field));
  record.put("key",key).put("digest",digest).put("createdAt",System.currentTimeMillis()).put("phase",poster.allowed()?"dispatching":"denied");
  ledger.put(key,record);
  // Bound encrypted metadata across accounts. A pending tap is never evicted.
  String pendingKey=read(PENDING).optString("key");ArrayList<String> keys=new ArrayList<>();ledger.keys().forEachRemaining(keys::add);keys.sort(Comparator.comparingLong(k->ledger.optJSONObject(k).optLong("createdAt")));
  while(ledger.length()>200){String oldest=null;for(String candidate:keys)if(!candidate.equals(key)&&!candidate.equals(pendingKey)){oldest=candidate;break;}if(oldest==null)throw new IllegalStateException("Notice history full");keys.remove(oldest);ledger.remove(oldest);poster.cancel(oldest);}
  // A newer result from the same scheduled loop supersedes its earlier unopened notice.
  for(String other:keys){JSONObject prior=ledger.optJSONObject(other);if(prior==null||other.equals(key)||other.equals(pendingKey)||!"posted".equals(prior.optString("phase"))||!record.getString("scope").equals(prior.optString("scope"))||!record.getString("workflowId").equals(prior.optString("workflowId")))continue;prior.put("phase","superseded");poster.cancel(other);}
  write(LEDGER,ledger); // Exact route and uncertain dispatch state precede any OS effect.
  if(record.getString("phase").equals("denied"))return "denied";
  try {poster.post(key);record.put("phase","posted");write(LEDGER,ledger);return "posted";}
  catch(SecurityException denied){record.put("phase","denied");write(LEDGER,ledger);return "denied";}
 }
 synchronized void capture(String key)throws Exception {
  capture(key,false);
 }
 synchronized void capture(String key,boolean question)throws Exception {
  if(key==null||!key.matches("[a-f0-9]{64}"))return;
  JSONObject ledger=read(LEDGER),record=ledger.optJSONObject(key);if(record==null||!ownerMatches(record)||!"posted".equals(record.optString("phase")))return;
  JSONObject previous=read(PENDING);if(key.equals(previous.optString("key"))&&question==previous.optBoolean("question"))return;
  write(PENDING,new JSONObject().put("key",key).put("question",question).put("token",UUID.randomUUID().toString()));
 }
 synchronized JSONObject peek()throws Exception {
  JSONObject pending=read(PENDING),record=read(LEDGER).optJSONObject(pending.optString("key"));
  if(record==null||!ownerMatches(record))return new JSONObject();
  JSONObject out=new JSONObject(record.toString());out.remove("digest");out.remove("createdAt");out.remove("phase");out.put("token",pending.getString("token"));
  try{JSONObject result=result(record);if(!hash(result.toString()).equals(record.getString("digest")))throw new IllegalStateException();out.put("retained",true);}catch(Exception missing){out.put("retained",false);}
  out.put("question",pending.optBoolean("question"));return out;
 }
 synchronized void releaseQuestion(String token)throws Exception {
  JSONObject pending=read(PENDING);if(!token.equals(pending.optString("token"))||!pending.optBoolean("question"))throw new IllegalStateException("Question changed");
  write(PENDING,new JSONObject()); // Explicit Cancel keeps the original notice route usable.
 }
 synchronized void consume(String token)throws Exception {
  JSONObject pending=read(PENDING);if(!token.equals(pending.optString("token")))throw new IllegalStateException("Tap changed");
  String key=pending.getString("key");JSONObject ledger=read(LEDGER),record=ledger.optJSONObject(key);
  if(record!=null){record.put("phase","opened");write(LEDGER,ledger);}write(PENDING,new JSONObject());poster.cancel(key);
 }
}
