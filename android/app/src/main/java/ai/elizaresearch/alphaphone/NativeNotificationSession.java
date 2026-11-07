package ai.elizaresearch.alphaphone;

import org.json.*;

/** Restores an existing owner session; never pairs, enrolls, logs in or mints authority. */
final class NativeNotificationSession {
 static final class Superseded extends Exception {}
 static final String SLOT="canonical-notification-owner:v1";
 interface Ports {
  String saved()throws Exception;
  String provider()throws Exception;
  String installation()throws Exception;
  String root()throws Exception;
  void current()throws Exception;
  JSONObject get(String path,String bearer)throws Exception;
 }
 static JSONObject record(JSONObject session,JSONObject identity,String installation,String provider)throws Exception{
  if(!identity.getString("subjectUserId").equals(session.getString("ownerId")))throw new SecurityException("Notification owner mismatch");
  return new JSONObject().put("version",1).put("session",new JSONObject(session.toString())).put("agentId",identity.getString("agentId"))
   .put("installationId",installation).put("provider",provider).put("projectionOwner",HostedResultNotices.hash(identity.toString()));
 }
 static JSONObject restore(Ports ports,long now)throws Exception{
  ports.current();String saved=ports.saved();if(saved==null)return null;
  JSONObject record=new JSONObject(saved),session=record.getJSONObject("session");
  String provider=ports.provider(),installation=ports.installation(),root=ports.root();
  if(record.getInt("version")!=1||!provider.equals(record.getString("provider"))||!installation.equals(record.getString("installationId"))
    ||!installation.matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")||root==null||root.isEmpty())throw new SecurityException("Notification runtime changed");
  String owner=HostedInbox.id(session.getString("ownerId")),agent=HostedInbox.id(record.getString("agentId")),token=session.getString("token");
  long expiry=session.getLong("expiresAt");
  if(session.getInt("version")!=1||expiry<=now+30000||token.isEmpty()||token.length()>8192||token.contains("\r")||token.contains("\n"))throw new SecurityException("Notification session expired");
  class Current {void check()throws Exception{
   ports.current();if(!saved.equals(ports.saved())||!root.equals(ports.root()))throw new Superseded();
   if(!provider.equals(ports.provider())||!installation.equals(ports.installation()))throw new SecurityException("Notification restoration identity changed");
  }}
  Current current=new Current();current.check();
  JSONObject me=ports.get("/api/auth/me",token);current.check();
  JSONObject identity=me.getJSONObject("identity"),access=me.getJSONObject("access"),machine=me.getJSONObject("session");
  if(!owner.equals(identity.getString("id"))||!"owner".equals(identity.getString("kind"))||!"OWNER".equals(access.getString("role"))||!"session".equals(access.getString("mode"))
    ||!"machine".equals(machine.getString("kind"))||!token.equals(machine.getString("id"))||machine.getLong("expiresAt")!=expiry)throw new SecurityException("Notification owner session rejected");
  JSONArray agents=ports.get("/api/agents",token).getJSONArray("agents");current.check();
  if(agents.length()!=1||!agent.equals(agents.getJSONObject(0).getString("id"))||!"running".equals(agents.getJSONObject(0).getString("status")))throw new SecurityException("Notification agent changed");
  // The process bearer rotates on every service boot. Only verified existing
  // owner authority on this same installation may adopt its current value.
  return new JSONObject().put("session",ResidentResultSession.snapshot(owner,token,expiry,root)).put("agentId",agent)
   .put("saved",saved).put("provider",provider).put("installationId",installation).put("rootDigest",HostedResultNotices.hash(root));
 }
}
