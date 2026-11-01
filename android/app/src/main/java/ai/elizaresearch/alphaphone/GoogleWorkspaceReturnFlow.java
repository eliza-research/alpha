package ai.elizaresearch.alphaphone;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Set;
import org.json.JSONObject;
import org.json.JSONArray;
import org.json.JSONTokener;

/** One pending Workspace return in the existing native store; never writes credentials.
 * The host invalidates pending state on logout or credential-authority replacement. UI session IDs are not durable identity. */
final class GoogleWorkspaceReturnFlow {
 interface Store {
  String credential() throws Exception;
  String pending() throws Exception;
  boolean comparePending(String expected,String value) throws Exception;
 }
 private final Store store;
 GoogleWorkspaceReturnFlow(Store store) {
  if(store==null)throw new IllegalArgumentException("Workspace store required");this.store=store;
 }
 static String credentialHash(String raw) {
  if(raw==null)throw new IllegalArgumentException("Workspace credential required");
  try {
   // Same authority tuple used by NativeProviderAdmission.sameCloudCredential;
   // expiry, formatting and unrelated metadata do not change credential ownership.
   JSONObject saved=object(raw);
   String canonical=new JSONArray().put("production").put(saved.getString("credentialId")).put(saved.opt("userId")).put(saved.opt("organizationId")).put(saved.getString("token")).toString();
   byte[] hash=MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
   StringBuilder result=new StringBuilder(64);
   for(byte value:hash)result.append(Character.forDigit((value>>>4)&15,16)).append(Character.forDigit(value&15,16));
   return result.toString();
  }catch(Exception invalid){throw new IllegalArgumentException("Invalid Workspace credential");}
 }
 static GoogleWorkspaceReturn.Binding binding(String environment,String userId,String organizationId,String credentialId,String rawCredential) {
  try {
   JSONObject saved=object(rawCredential);
   String token=saved.getString("token");
   if(!credentialId.equals(saved.getString("credentialId"))||token.trim().isEmpty())throw new IllegalArgumentException();
   return new GoogleWorkspaceReturn.Binding(environment,userId,organizationId,credentialId,credentialHash(rawCredential));
  }catch(Exception invalid){throw new IllegalArgumentException("Current Workspace credential required");}
 }
 private static JSONObject object(String raw) throws Exception {
  if(raw==null||raw.length()>262144)throw new IllegalArgumentException();
  JSONTokener parser=new JSONTokener(raw);Object value=parser.nextValue();
  if(!(value instanceof JSONObject)||parser.nextClean()!=0)throw new IllegalArgumentException();
  return (JSONObject)value;
 }
 private static GoogleWorkspaceReturn.Pending pending(String raw) {
  try {
   JSONObject value=object(raw);
   Set<String> expected=Set.of("environment","userId","organizationId","credentialId","credentialHash","state","createdAt");
   if(value.length()!=expected.size())return null;
   for(java.util.Iterator<String> keys=value.keys();keys.hasNext();)if(!expected.contains(keys.next()))return null;
   Object time=value.get("createdAt");if(!(time instanceof Number))return null;
   double decimal=((Number)time).doubleValue();long instant=((Number)time).longValue();
   if(!Double.isFinite(decimal)||decimal!=instant)return null;
   GoogleWorkspaceReturn.Binding owner=new GoogleWorkspaceReturn.Binding(value.getString("environment"),value.getString("userId"),value.getString("organizationId"),value.getString("credentialId"),value.getString("credentialHash"));
   return new GoogleWorkspaceReturn.Pending(owner,value.getString("state"),instant);
  }catch(Exception invalid){return null;}
 }
 private boolean current(GoogleWorkspaceReturn.Binding binding,long now) throws Exception {
  String raw=store.credential();
  if(binding==null||raw==null)return false;
  JSONObject saved=object(raw);
  if(saved.has("expiresAt")&&saved.getLong("expiresAt")<=now)return false;
  return binding.credentialHash.equals(credentialHash(raw));
 }
 String prepare(GoogleWorkspaceReturn.Binding binding,String nonce,long now) throws Exception {
  GoogleWorkspaceReturn.Pending next=new GoogleWorkspaceReturn.Pending(binding,nonce,now);
  if(!current(binding,now))throw new IllegalStateException("Workspace account changed");
  String before=store.pending();
  JSONObject value=new JSONObject().put("environment",binding.environment).put("userId",binding.userId).put("organizationId",binding.organizationId)
   .put("credentialId",binding.credentialId).put("credentialHash",binding.credentialHash).put("state",next.nonce).put("createdAt",now);
  String encoded=value.toString();
  if(!store.comparePending(before,encoded))throw new IllegalStateException("Workspace attempt changed");
  if(!current(binding,now)) {
   store.comparePending(encoded,null);
   throw new IllegalStateException("Workspace account changed");
  }
  return GoogleWorkspaceReturn.CALLBACK+"?state="+nonce;
 }
 /** Capture eligibility only; never consumes or replaces an incoming return. */
 boolean captureAllowed(String url,long now) throws Exception {
  GoogleWorkspaceReturn.Callback callback=GoogleWorkspaceReturn.parse(url);
  if(callback==null)return false;
  GoogleWorkspaceReturn.Pending retained=pending(store.pending());
  return retained!=null&&GoogleWorkspaceReturn.accepts(retained,retained.binding,callback,now)&&current(retained.binding,now);
 }
 /** Consume before the caller performs its canonical connection/account readback. */
 GoogleWorkspaceReturn.Callback consume(GoogleWorkspaceReturn.Binding binding,String url,long now) throws Exception {
  GoogleWorkspaceReturn.Callback callback=GoogleWorkspaceReturn.parse(url);
  if(callback==null)return null;
  String raw=store.pending();GoogleWorkspaceReturn.Pending retained=pending(raw);
  if(!GoogleWorkspaceReturn.accepts(retained,binding,callback,now)||!current(binding,now))return null;
  if(!store.comparePending(raw,null)||!current(binding,now))return null;
  return callback;
 }
 void cancel(String state) throws Exception {
  if(state==null||!state.matches("[A-Za-z0-9_-]{43}"))return;
  String raw=store.pending();GoogleWorkspaceReturn.Pending retained=pending(raw);
  if(retained!=null&&retained.nonce.equals(state))store.comparePending(raw,null);
 }
}
