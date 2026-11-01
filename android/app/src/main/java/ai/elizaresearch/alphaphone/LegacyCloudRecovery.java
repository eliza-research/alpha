package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.util.Objects;
import org.json.JSONObject;

/** Explicit recovery of this product's pre-deployment production sign-in. Never a read fallback. */
final class LegacyCloudRecovery {
 static final String LEGACY_NAMESPACE="cloud-deployment:897efc6f09b9d4db345c61226d8301a9f1257ad98f0491e8591f63d4f4515874:";
 static final String JOURNAL="cloud-signin:legacy-recovery:v1";
 static final String CLOUD="cloud:production";
 static final String PROVIDER="local-agent-provider:v1";
 private final JsonCredentialSlots slots;
 private final String namespace;
 private final Runnable current;
 LegacyCloudRecovery(JsonCredentialSlots slots,String namespace,Runnable current){this.slots=slots;this.namespace=namespace;this.current=current;}
 private String scoped(String slot){return namespace+slot;}
 private boolean compatible(){return LEGACY_NAMESPACE.equals(namespace);}
 /** Explicit sign-out/configuration wins even if no scoped credential was ever written. */
 void block()throws Exception {synchronized(JsonCredentialSlots.LOCK){current.run();slots.write(scoped(JOURNAL),"{\"status\":\"blocked\"}");}}
 private boolean pending(String journal)throws Exception {
  if(journal==null)return true;
  return "pending".equals(new JSONObject(journal).getString("status"));
 }
 /** Metadata only. Missing journal is not consent: snapshot/commit must be explicitly invoked. */
 boolean eligible()throws Exception {
  synchronized(JsonCredentialSlots.LOCK){
   current.run();
   return compatible()&&slots.read(scoped(CLOUD))==null&&slots.read(scoped(PROVIDER))==null
     &&pending(slots.read(scoped(JOURNAL)))&&slots.read(CLOUD)!=null;
  }
 }
 /** Kept only in native memory across the canonical identity read. */
 static final class Snapshot {
  final String legacy,journal;
  Snapshot(String legacy,String journal){this.legacy=legacy;this.journal=journal;}
  String token()throws Exception{return LocalAgentProviderAdmission.cloudProviderToken(legacy,new JSONObject(legacy).getString("credentialId"),System.currentTimeMillis());}
 }
 /** Caller owns the existing lifecycle→vault critical section; no network occurs here. */
 Snapshot snapshot()throws Exception {
  synchronized(JsonCredentialSlots.LOCK){
   if(!eligible())return null;
   return new Snapshot(slots.read(CLOUD),slots.read(scoped(JOURNAL)));
  }
 }
 /** Same critical section on return from HTTP. No legacy provider or pending attempt is copied. */
 boolean commit(Snapshot before)throws Exception {
  synchronized(JsonCredentialSlots.LOCK){
   current.run();
   if(!eligible()||!Objects.equals(before.legacy,slots.read(CLOUD))||!Objects.equals(before.journal,slots.read(scoped(JOURNAL))))return false;
   before.token();
   slots.write(scoped(JOURNAL),"{\"status\":\"pending\"}");
   current.run();
   slots.remove(CloudDeployment.storageSlot(GoogleWorkspaceReturn.SLOT));
   slots.write(scoped(CLOUD),before.legacy);
   slots.write(scoped(JOURNAL),"{\"status\":\"complete\"}");
   return true;
  }
 }
}
