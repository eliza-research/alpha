package ai.elizaresearch.alphaphone;

import android.content.Context;
import android.util.AtomicFile;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
import java.io.File;
import java.nio.charset.StandardCharsets;

/** Product identity and limits for the installed shared JSON-slot format. */
final class AlphaCredentialStore {
 /** Definite refusal before any byte is written: the value exceeds its slot's cap. */
 static final class StorageFullException extends Exception {
  StorageFullException(){super("Secure storage slot is full");}
 }
 static final String NOTES_RECORDS="notes-records:v1:device";
 static final String NOTES_TRASH="notes-trash:v1:device";
 /** Encrypted copy of Notes edits whose collection commit failed or is uncertain. */
 static final String NOTES_DRAFT="notes-draft:v1:device";
 /** Reminder-to-note back-references: identity only, at most 200 links (runtime/note-origin.ts). */
 static final String NOTE_ORIGINS="note-origins:v1:device";
 interface CloudChangeObserver {void changed()throws Exception;}
 private static CloudChangeObserver cloudChange=()->{};
 static void observeCloudChanges(CloudChangeObserver observer){synchronized(JsonCredentialSlots.LOCK){cloudChange=observer;}}
 private final JsonCredentialSlots slots;
 private final Context context;
 private final Runnable assertOwner;
 AlphaCredentialStore(Context context){this(context,()->{});}
 AlphaCredentialStore(Context context,Runnable assertOwner){
  this.context=context.getApplicationContext();this.assertOwner=assertOwner;
  slots=new JsonCredentialSlots(new File(context.getApplicationContext().getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",AlphaCredentialStore::slotLimit,AlphaCredentialStore::retainedLimit);
 }
 static int slotLimit(String name){
  if("sms-send-ledger:v1:device".equals(name))return 1024*1024;
  if("gmail-background:v1".equals(name))return 2*1024*1024;
  if("native-delete-journal:v1".equals(name)||"native-calendar-sync:v1".equals(name))return 4*1024*1024;
  if("notes-audio-deletions:v1:device".equals(name))return 1024*1024;
  if(name!=null&&name.matches("note-audio-metadata:v1:[A-Za-z0-9_-]{1,100}"))return 512*1024;
  if(NOTES_RECORDS.equals(name))return 32*1024*1024;
  // Restorable copies of deleted notes, purged three days after deletion. The cap is the Trash
  // policy's byte limit (runtime/notes-trash-policy.ts NOTES_TRASH_MAX_BYTES); a document written
  // under the earlier 32 MiB cap stays readable and shrinkable through retainedLimit.
  if(NOTES_TRASH.equals(name))return NOTES_TRASH_BYTES;
  if(NOTES_DRAFT.equals(name))return 32*1024*1024;
  // 200 links of bounded ids and a hash stay well under this; a larger value is not a valid index.
  if(NOTE_ORIGINS.equals(name))return 512*1024;
  if(name!=null&&(name.startsWith("inbox-drafts:v1:")||name.matches("inbox-operation:v1:[a-f0-9]{64}")))return 8*1024*1024;
  if(name!=null&&name.matches("calendar-linked-sync:v1:[a-f0-9]{64}"))return 4*1024*1024;
  if(name!=null&&name.matches("connected-read-cache:v1:[a-f0-9]{64}"))return 4*1024*1024;
  return 256*1024;
 }
 /** Notes Trash policy limit (30 MiB), now also its slot cap. */
 static final int NOTES_TRASH_BYTES=30*1024*1024;
 /** The cap a slot had before it was lowered. Data stored under it stays readable, and a write
  * that does not grow it is accepted, until it fits the current cap (JsonCredentialSlots,
  * elizaOS/eliza#35910). Never below slotLimit. */
 static int retainedLimit(String name){
  if(NOTES_TRASH.equals(name))return 32*1024*1024;
  return slotLimit(name);
 }
 /** Refuses only what no stored value can admit (above the retained cap) before any shutdown or
  * write. Values between the cap and the retained cap are decided by the shared slot, whose
  * CapacityException mutateSlot reports as StorageFullException. */
 private static void requireCapacity(String name,String value)throws StorageFullException{
  if(value==null)return;
  // UTF-8 never encodes a char in fewer than 1 byte, so a short string cannot exceed the cap.
  if(value.length()<=retainedLimit(name)/3)return;
  if(value.getBytes(StandardCharsets.UTF_8).length>retainedLimit(name))throw new StorageFullException();
 }
 String slotHash(String name)throws Exception{return slots.slotHash(CloudDeployment.storageSlot(name));}
 AtomicFile slotFile(String hash)throws Exception{return slots.slotFile(hash);}
 String readCredentialSlot(String name)throws Exception{return slots.read(CloudDeployment.storageSlot(name));}
 /** Reads a saved slot before Application startup during pending reset recovery. */
 static String readSlotBeforeAttach(Context base,String name)throws Exception{
  return new JsonCredentialSlots(new File(base.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",AlphaCredentialStore::slotLimit).read(CloudDeployment.storageSlot(name));
 }
 /** Critical credential changes cannot leave a child process using the old environment. */
 void writeCredentialSlot(String name,String value)throws Exception{if(value==null)throw new IllegalArgumentException("Credential value required");requireCapacity(name,value);mutateSlot(name,null,value,false);}
 void removeCredentialSlot(String name)throws Exception{mutateSlot(name,null,null,false);}
 boolean compareExchangeCredentialSlot(String name,String expected,String value)throws Exception{requireCapacity(name,value);return mutateSlot(name,expected,value,true);}
 private boolean mutateSlot(String name,String expected,String value,boolean compare)throws Exception{
  // The shared slot refuses an oversized value before writing any byte; that is a full slot.
  try{return mutateSlotOnce(name,expected,value,compare);}
  catch(JsonCredentialSlots.CapacityException full){throw new StorageFullException();}
 }
 private boolean mutateSlotOnce(String name,String expected,String value,boolean compare)throws Exception{
  if(!"cloud:production".equals(name)&&!"cloud:staging".equals(name)&&!LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name)){
   return AlphaLocalAgentPlugin.withCredentialSlotMutation(assertOwner,()->{
    if(compare&&!java.util.Objects.equals(slots.read(CloudDeployment.storageSlot(name)),expected))return false;
    if(value==null)slots.remove(CloudDeployment.storageSlot(name));else slots.write(CloudDeployment.storageSlot(name),value);return true;
   });
  }
  return AlphaLocalAgentPlugin.mutateCredentials(context,assertOwner,new AlphaLocalAgentPlugin.CredentialMutation<Boolean>(){
   String before,provider;boolean conflict;
   public boolean requiresShutdown()throws Exception{
    before=slots.read(CloudDeployment.storageSlot(name));provider=slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
    conflict=compare&&!java.util.Objects.equals(before,expected);
    if(conflict)return false;
    legacyRecovery().block();
    if(LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name))return before!=null||value!=null;
    if(java.util.Objects.equals(before,value))return false;
    // No stored provider: the running agent was launched unbound (removing a provider stops it),
    // so no process holds a Cloud key and a sign-in change never needs to stop the agent.
    if(provider==null)return false;
    String environment=provider==null?"production":new org.json.JSONObject(provider).optString("environment","production");
    return name.equals("cloud:"+environment)&&!LocalAgentProviderAdmission.sameCloudCredential(before,value);
   }
   public Boolean commit()throws Exception{
    if(conflict)return false;
    if(!LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name)&&java.util.Objects.equals(before,value))return true;
    if(!java.util.Objects.equals(before,slots.read(CloudDeployment.storageSlot(name)))||!java.util.Objects.equals(provider,slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT))))throw new IllegalStateException("Credential changed");
    // Only a replaced or removed Cloud key retires Cloud-bound background state; changing the agent's
    // inference provider does not (background Gmail binds the Cloud credential, not the provider).
    if("cloud:production".equals(name)&&!LocalAgentProviderAdmission.sameCloudCredential(before,value))cloudChange.changed();
    String committed=LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name)&&value!=null?LocalAgentProviderAdmission.withoutAdmission(value):value;
    // Metadata/valid expiry refresh is not replacement; use the same canonical credential
    // comparison that retains provider admission. Provider writes still strip admission.
    boolean authorityChanged=LocalAgentProviderAdmission.PROVIDER_SLOT.equals(name)
      ?!java.util.Objects.equals(before,committed):!LocalAgentProviderAdmission.sameCloudCredential(before,committed);
    if(authorityChanged)AlphaLocalAgentPlugin.powerAuthorizationChanged();
    invalidateProviderAdmission(name,value);
    if("cloud:production".equals(name)&&authorityChanged)slots.remove(CloudDeployment.storageSlot(GoogleWorkspaceReturn.SLOT));
    if(value==null)slots.remove(CloudDeployment.storageSlot(name));
    else slots.write(CloudDeployment.storageSlot(name),committed);
    return true;
   }
  });
 }
 private LegacyCloudRecovery legacyRecovery(){return new LegacyCloudRecovery(slots,CloudDeployment.STORAGE_NAMESPACE,assertOwner);}
 /** Reads and commits use the SAME lifecycle→vault order as all credential mutations. */
 private <T>T recoveryStep(java.util.concurrent.Callable<T> step)throws Exception{
  return AlphaLocalAgentPlugin.mutateCredentials(context,assertOwner,new AlphaLocalAgentPlugin.CredentialMutation<T>(){
   public boolean requiresShutdown(){return false;}
   public T commit()throws Exception{return step.call();}
  });
 }
 /** Automatic startup unbind is a no-op when native confirms there is no provider.
  * Explicit clear still uses removeCredentialSlot and durably blocks legacy recovery. */
 void removeProviderIfPresent()throws Exception{
  String before=recoveryStep(()->slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT)));
  if(before==null)return;
  if(!compareExchangeCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT,before,null))throw new IllegalStateException("Provider changed");
 }
 /** Opaque cleanup authority for the exact binding and existing intent, never a credential. */
 String providerBindingGuard(String expected)throws Exception{
  long authority=AlphaLocalAgentPlugin.credentialAuthorityEpoch();
  return AlphaLocalAgentPlugin.withCredentialAuthority(authority,()->{
   assertOwner.run();
   String provider=slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
   if(provider==null||expected!=null&&!expected.equals(provider))throw new SecurityException("Provider changed");
   String cloud=slots.read(CloudDeployment.storageSlot("cloud:production"));
   String value=new org.json.JSONArray().put(provider).put(cloud).put(authority).put(AlphaLocalAgentPlugin.currentCredentialIntent()).toString();
   byte[] bytes=java.security.MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
   StringBuilder hash=new StringBuilder();for(byte b:bytes)hash.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return hash.toString();
  });
 }
 static final class ProviderChanged extends Exception {}
 /** Automatic cleanup never reserves an intent or alters a different binding. */
 boolean removeProviderIfCurrent(String guard)throws Exception{
  if(guard==null||!guard.matches("[a-f0-9]{64}"))throw new IllegalArgumentException("Invalid binding guard");
  final long[] intent={-1};
  try{
   return AlphaLocalAgentPlugin.mutateCredentials(context,()->{
    assertOwner.run();if(intent[0]>=0)AlphaLocalAgentPlugin.requireCredentialIntent(intent[0]);
   },new AlphaLocalAgentPlugin.CredentialMutation<Boolean>(){
    String provider,cloud;long authority;
    public boolean requiresShutdown()throws Exception{
     try{if(!guard.equals(providerBindingGuard(null)))throw new ProviderChanged();}
     catch(SecurityException changed){throw new ProviderChanged();}
     provider=slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
     cloud=slots.read(CloudDeployment.storageSlot("cloud:production"));
     authority=AlphaLocalAgentPlugin.credentialAuthorityEpoch();
     intent[0]=AlphaLocalAgentPlugin.reserveCredentialIntent();
     legacyRecovery().block();return true;
    }
    public Boolean commit()throws Exception{
     if(authority!=AlphaLocalAgentPlugin.credentialAuthorityEpoch()
       ||!java.util.Objects.equals(provider,slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT)))
       ||!java.util.Objects.equals(cloud,slots.read(CloudDeployment.storageSlot("cloud:production"))))throw new ProviderChanged();
     AlphaLocalAgentPlugin.powerAuthorizationChanged();
     slots.remove(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
     if(slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT))!=null)throw new IllegalStateException("Provider removal unconfirmed");
     return true;
    }
   });
  }catch(ProviderChanged changed){return false;}
  catch(Exception failure){if(intent[0]>=0&&AlphaLocalAgentPlugin.currentCredentialIntent()!=intent[0])return false;throw failure;}
 }
 boolean legacyCloudRecoveryEligible()throws Exception{return recoveryStep(()->legacyRecovery().eligible());}
 boolean restoreLegacyCloudCredential()throws Exception{
  LegacyCloudRecovery.Snapshot before=recoveryStep(()->legacyRecovery().snapshot());
  if(before==null)return false;
  // Never hold lifecycle or vault locks across HTTP. The second critical section rechecks
  // intent/owner, exact old bytes, journal and absent targets before committing.
  AlphaConnectionPlugin.readCloudIdentity(before.token());
  return recoveryStep(()->{boolean restored=legacyRecovery().commit(before);if(restored)AlphaLocalAgentPlugin.powerAuthorizationChanged();return restored;});
 }
 void assertCurrent(){assertOwner.run();}
 private void invalidateProviderAdmission(String changedSlot,String replacement)throws Exception{
  if(!"cloud:production".equals(changedSlot)&&!"cloud:staging".equals(changedSlot))return;
  String saved=slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
  if(saved==null)return;
  org.json.JSONObject provider=new org.json.JSONObject(saved);
  if(!changedSlot.equals("cloud:"+provider.optString("environment","production")))return;
  String previous=slots.read(CloudDeployment.storageSlot(changedSlot));
  if(replacement!=null&&LocalAgentProviderAdmission.currentGeneration(saved,previous)!=null
     &&LocalAgentProviderAdmission.sameCloudCredential(previous,replacement))return;
  slots.write(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT),LocalAgentProviderAdmission.withoutAdmission(saved));
 }
 /** Only explicit, validated native provider configuration may establish admission identity. */
 String compareExchangeProviderAdmission(String expected,String selection,String credentialSlot,String expectedCredential,org.json.JSONObject verifiedIdentity)throws Exception{
  return AlphaLocalAgentPlugin.mutateCredentials(context,assertOwner,new AlphaLocalAgentPlugin.CredentialMutation<String>(){
   String admitted;boolean conflict;
   public boolean requiresShutdown()throws Exception{
    conflict=credentialSlot!=null&&!java.util.Objects.equals(slots.read(CloudDeployment.storageSlot(credentialSlot)),expectedCredential)
      ||!java.util.Objects.equals(slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT)),expected);
    if(conflict)return false;
    legacyRecovery().block();
    org.json.JSONObject requested=new org.json.JSONObject(selection);
    boolean cloud="elizacloud".equals(requested.optString("provider"));
    if(cloud?!"cloud:production".equals(credentialSlot):credentialSlot!=null||expectedCredential!=null||verifiedIdentity!=null)throw new IllegalArgumentException();
    admitted=LocalAgentProviderAdmission.admit(expected,selection,expectedCredential,verifiedIdentity);
    String oldGeneration=expected==null?null:LocalAgentProviderAdmission.currentGeneration(expected,expectedCredential);
    return oldGeneration==null||!oldGeneration.equals(LocalAgentProviderAdmission.currentGeneration(admitted,expectedCredential));
   }
   public String commit()throws Exception{
    if(conflict)return null;
    if(credentialSlot!=null&&!java.util.Objects.equals(slots.read(CloudDeployment.storageSlot(credentialSlot)),expectedCredential)
      ||!java.util.Objects.equals(slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT)),expected))throw new IllegalStateException("Provider changed");
    if(LocalAgentProviderAdmission.currentGeneration(admitted,expectedCredential)==null)throw new IllegalStateException("Provider credential expired");
    // admit() retains generation only when the native canonical fingerprint is unchanged.
    // A fresh random request revision alone must not revoke a protected cold-start grant.
    String previousGeneration=expected==null?null:LocalAgentProviderAdmission.currentGeneration(expected,expectedCredential);
    String admittedGeneration=LocalAgentProviderAdmission.currentGeneration(admitted,expectedCredential);
    if(previousGeneration==null||!previousGeneration.equals(admittedGeneration))AlphaLocalAgentPlugin.powerAuthorizationChanged();
    slots.write(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT),admitted);return admitted;
   }
  });
 }
 /** Account invalidation may strip this admission, but never overwrite a newer CAS revision. */
 void rollbackProviderAdmission(String admitted,String previous)throws Exception{
  AlphaLocalAgentPlugin.mutateCredentials(context,assertOwner,new AlphaLocalAgentPlugin.CredentialMutation<Void>(){
   String current;boolean owned;
   public boolean requiresShutdown()throws Exception{
    current=slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
    if(current==null)return false;
    org.json.JSONObject held=new org.json.JSONObject(current);
    owned=java.util.Objects.equals(current,admitted)
      ||!held.has("admissionGeneration")&&!held.has("admissionFingerprint")
       &&LocalAgentProviderAdmission.withoutAdmission(admitted).equals(held.toString());
    return owned;
   }
   public Void commit()throws Exception{
    if(!owned)return null;
    if(!java.util.Objects.equals(current,slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT))))throw new IllegalStateException("Provider changed");
    AlphaLocalAgentPlugin.powerAuthorizationChanged();
    if(previous==null)slots.remove(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
    else slots.write(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT),LocalAgentProviderAdmission.withoutAdmission(previous));
    return null;
   }
  });
 }
 /** Read-only correlation, not an authorization or migration API. Legacy selections remain unavailable. */
 String providerAdmissionGeneration()throws Exception{
  synchronized(JsonCredentialSlots.LOCK){
   String saved=slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
   if(saved==null||!AlphaLocalAgentPlugin.providerAdmissionReadable())return null;
   org.json.JSONObject selected=new org.json.JSONObject(saved);
   String credential="elizacloud".equals(selected.optString("provider"))?slots.read(CloudDeployment.storageSlot("cloud:production")):null;
   return LocalAgentProviderAdmission.currentGeneration(saved,credential);
  }
 }
 /** Private whitelist only; neither the logical fingerprint nor billing credentials leave the store. */
 org.json.JSONObject providerAdmissionSnapshot()throws Exception{
  synchronized(JsonCredentialSlots.LOCK){
   String saved=slots.read(CloudDeployment.storageSlot(LocalAgentProviderAdmission.PROVIDER_SLOT));
   if(saved==null||!AlphaLocalAgentPlugin.providerAdmissionReadable())throw new SecurityException("Native provider binding unavailable");
   org.json.JSONObject selected=new org.json.JSONObject(saved);
   String kind=selected.optString("provider","cerebras");
   String cloud="elizacloud".equals(kind)?slots.read(CloudDeployment.storageSlot("cloud:production")):null;
   String generation=LocalAgentProviderAdmission.currentGeneration(saved,cloud);
   if(generation==null)throw new SecurityException("Native provider binding unavailable");
   String accountRef="elizacloud".equals(kind)?LocalAgentProviderAdmission.cloudAccountRef(selected):"native-local";
   return new org.json.JSONObject().put("provider",kind).put("environment","production").put("accountRef",accountRef).put("sessionGeneration",generation);
  }
 }

}
