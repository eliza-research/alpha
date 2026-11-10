package ai.elizaresearch.alphaphone;

import com.getcapacitor.PluginCall;
import org.json.JSONObject;
import java.io.IOException;

/** Credential lookup shared by reviewed speech. No credential passes through JS. */
final class PairedAgentCredential {
 final String token;
 final boolean cloud;
 private PairedAgentCredential(String token, boolean cloud) throws IOException {
  if(token==null||token.isBlank()||token.length()>16384||token.contains("\r")||token.contains("\n"))throw new IOException("Invalid credential");
  this.token=token;this.cloud=cloud;
 }
 static PairedAgentCredential resolve(PluginCall call, AlphaConnectionPlugin store) throws Exception {
  String origin=call.getString("origin"),owner=call.getString("ownerId"),session=call.getString("sessionId");Long expires=call.getLong("expiresAt");
  if(origin==null||owner==null||session==null||!session.matches("[A-Za-z0-9-]{1,128}")||expires==null||expires<=System.currentTimeMillis())throw new IOException("Expired selection");
  String saved=store.readCredentialSlot("cloud-runtime:"+session);
  if(saved!=null){
   JSONObject binding=new JSONObject(saved);
   if(!origin.equals(binding.getString("origin"))||!owner.equals(binding.getString("ownerId"))||!session.equals(binding.getString("sessionId"))||expires!=binding.getLong("expiresAt"))throw new IOException("Cloud selection changed");
   String environment=binding.getString("environment"),agent=binding.getString("agentId");
   if(!agent.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"))throw new IOException("Invalid agent");
   String suffix="production".equals(environment)?CloudDeployment.PRODUCTION_SERVICES_HOST:"staging".equals(environment)?CloudDeployment.STAGING_SERVICES_HOST:null;
   if(suffix==null||!origin.equals("https://"+agent+"."+suffix))throw new IOException("Invalid Cloud target");
   JSONObject credential=new JSONObject(store.readCredentialSlot("cloud:"+environment));
   if(!binding.getString("credentialId").equals(credential.getString("credentialId"))||(credential.has("expiresAt")&&credential.getLong("expiresAt")<=System.currentTimeMillis())||(credential.has("userId")&&!credential.getString("userId").equals(binding.getString("userId"))))throw new IOException("Cloud credential changed");
   return new PairedAgentCredential(credential.getString("token"),true);
  }
  JSONObject credential=new JSONObject(store.readCredentialSlot("remote:"+origin));
  if(!origin.equals(credential.getString("origin"))||!owner.equals(credential.getString("identityId"))||expires!=credential.getLong("expiresAt"))throw new IOException("Paired selection changed");
  return new PairedAgentCredential(credential.getString("token"),false);
 }
}
