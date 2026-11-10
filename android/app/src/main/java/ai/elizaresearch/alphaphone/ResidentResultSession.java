package ai.elizaresearch.alphaphone;

import org.json.*;

/** Native-only credential binding. The supplied store is the encrypted app credential store. */
final class ResidentResultSession {
 interface Runtime {
  String rootToken() throws Exception;
  JSONObject exchange(JSONObject request) throws Exception;
  /** Under the delivery gate: replaces the bound credential only if it is still previous; returns the bound digest. */
  String adopt(String previous,String replacement) throws Exception;
 }
 static final String PLACEHOLDER_AGENT="00000000-0000-0000-0000-000000000000";
 interface Guard {void check()throws Exception;}
 static JSONObject snapshot(String owner,String token,long expiry,String root)throws Exception {
  HostedInbox.id(owner);
  if(token==null||token.isEmpty()||token.length()>8192||token.contains("\r")||token.contains("\n")||
     root==null||root.isEmpty()||expiry<=System.currentTimeMillis())throw new SecurityException("Resident session unavailable");
  return new JSONObject().put("version",1).put("ownerId",owner).put("token",token).put("expiresAt",expiry).put("runtimeDigest",HostedResultNotices.hash(root));
 }
 static ResidentResultTransport open(HostedInbox.Store store,JSONObject requested,Runtime runtime,Guard guard)throws Exception {
  // Copy the binding so later caller mutation cannot change authority mid-request.
  JSONObject binding=new JSONObject(requested.toString());
  String owner=HostedInbox.id(binding.getString("ownerId")),agent=HostedInbox.id(binding.getString("agentId"));
  final String initialDigest=binding.getString("credentialDigest");
  class BoundChannel implements ResidentResultTransport.Channel {
   private String digest=initialDigest;
   private JSONObject credential()throws Exception {
    guard.check();String raw=store.read(binding.getString("credentialSlot"));
    // Another transport of this binding may already have adopted a restarted runtime.
    if(raw!=null&&!HostedResultNotices.hash(raw).equals(digest)&&HostedResultNotices.hash(raw).equals(runtime.adopt(digest,null)))digest=HostedResultNotices.hash(raw);
    if(raw==null||!HostedResultNotices.hash(raw).equals(digest))throw new SecurityException("Resident credential changed");
    JSONObject auth=session(raw);String root=runtime.rootToken();
    if(root==null||root.isEmpty())throw new java.io.IOException("Resident runtime not ready");
    if(HostedResultNotices.hash(root).equals(auth.getString("runtimeDigest")))return auth;
    adopt(auth,root);raw=store.read(binding.getString("credentialSlot"));
    if(raw==null||!HostedResultNotices.hash(raw).equals(digest))throw new SecurityException("Resident credential changed");
    JSONObject adopted=session(raw);
    if(!auth.getString("token").equals(adopted.getString("token"))||auth.getLong("expiresAt")!=adopted.getLong("expiresAt")||
       !root.equals(runtime.rootToken())||!HostedResultNotices.hash(root).equals(adopted.getString("runtimeDigest")))throw new SecurityException("Resident runtime changed");
    return adopted;
   }
   private JSONObject session(String raw)throws Exception {
    JSONObject auth=new JSONObject(raw);
    if(auth.getInt("version")!=1||!owner.equals(auth.getString("ownerId"))||auth.getLong("expiresAt")<=System.currentTimeMillis())throw new SecurityException("Resident session expired");
    String token=auth.getString("token");if(token.isEmpty()||token.length()>8192||token.contains("\r")||token.contains("\n"))throw new SecurityException("Invalid resident token");
    return auth;
   }
   // The service mints a new root token at every launch. The same machine session on the same
   // agent keeps its authority; adoption only rewrites runtimeDigest and never pairs or enrolls.
   private void adopt(JSONObject auth,String root)throws Exception {
    String token=auth.getString("token");
    JSONObject me=identity("/api/auth/me",token),identity=me.getJSONObject("identity"),access=me.getJSONObject("access"),machine=me.getJSONObject("session");
    if(!owner.equals(identity.getString("id"))||!"owner".equals(identity.getString("kind"))||!"OWNER".equals(access.getString("role"))||!"session".equals(access.getString("mode"))||
       !"machine".equals(machine.getString("kind"))||!token.equals(machine.getString("id"))||machine.getLong("expiresAt")!=auth.getLong("expiresAt"))throw new SecurityException("Resident owner changed");
    JSONArray agents=identity("/api/agents",token).getJSONArray("agents");
    if(agents.length()!=1)throw new SecurityException("Resident agent changed");
    JSONObject current=agents.getJSONObject(0);
    if(!"running".equals(current.getString("status"))||PLACEHOLDER_AGENT.equals(current.getString("id")))throw new java.io.IOException("Resident agent not ready");
    if(!agent.equals(current.getString("id")))throw new SecurityException("Resident agent changed");
    guard.check();digest=runtime.adopt(digest,new JSONObject(auth.toString()).put("runtimeDigest",HostedResultNotices.hash(root)).toString());
   }
   private JSONObject identity(String path,String token)throws Exception {
    guard.check();
    JSONObject response=runtime.exchange(new JSONObject().put("path",path).put("method","GET").put("timeoutMs",5000)
     .put("headers",new JSONObject().put("Accept","application/json").put("Authorization","Bearer "+token)));
    guard.check();int status=response.getInt("status");
    if(status==401||status==403)throw new SecurityException("Resident session revoked");
    if(status<200||status>=300)throw new java.io.IOException("Resident runtime unavailable");
    String body=response.getString("body");if(body.length()>65536)throw new SecurityException("Resident identity response invalid");
    return new JSONObject(body);
   }
   private JSONObject device()throws Exception {
    String raw=store.read(binding.getString("deviceSlot"));if(raw==null)throw new SecurityException("Resident device binding missing");
    JSONObject value=new JSONObject(raw);
    if(!HostedResultNotices.hash(value.toString()).equals(binding.getString("deviceDigest"))||
       !value.getString("key").matches("[a-f0-9]{64}")||!value.getString("installationId").matches("[a-f0-9-]{36}"))throw new SecurityException("Resident device binding changed");
    HostedInbox.id(value.getString("enrollmentId"));return value;
   }
   public void check()throws Exception {credential();device();guard.check();}
   public JSONObject exchange(String path,String method,JSONObject body,int timeoutMs)throws Exception {
    check();JSONObject auth=credential(),device=device();
    JSONObject headers=new JSONObject().put("Accept","application/json").put("Content-Type","application/json").put("Authorization","Bearer "+auth.getString("token"));
    if(path.startsWith("/api/workflow/"))headers.put("X-Eliza-Device-Id",device.getString("installationId")).put("X-Eliza-Device-Key",device.getString("key")).put("X-Eliza-Device-Capabilities","calendar.local-event.v1,notes.local-record.v1");
    JSONObject input=new JSONObject().put("path",path).put("method",method).put("headers",headers).put("timeoutMs",timeoutMs);
    if(body!=null)input.put("body",body.toString());
    check();JSONObject response=runtime.exchange(input);check();return response;
   }
  }
  BoundChannel channel=new BoundChannel();channel.check();
  return new ResidentResultTransport(channel,owner,agent,channel.credential().getString("token"));
 }
}
