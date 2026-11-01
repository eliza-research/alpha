package ai.elizaresearch.alphaphone;
import java.io.File;
import ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots;
public final class StoreIntegrationTest {
 static void check(boolean value,String why){if(!value)throw new AssertionError(why);}
 public static void main(String[] args)throws Exception{
  for(String operation:new String[]{"restore","remove","same-remove","write","provider","explicit-provider-clear"}){
   android.content.Context context=new android.content.Context(new File(args[0],operation));
   JsonCredentialSlots raw=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
   raw.write("cloud:production",LegacyCloudRecoveryTest.SAVED);
   AlphaCredentialStore store=new AlphaCredentialStore(context);
   check(store.readCredentialSlot("cloud:production")==null,"original scoped lookup preserves isolation");
   if(operation.equals("restore")){
    check(store.restoreLegacyCloudCredential(),"actual store restore");check(AlphaConnectionPlugin.verified==1,"canonical native identity route invoked");
    check(LegacyCloudRecoveryTest.SAVED.equals(store.readCredentialSlot("cloud:production")),"actual store readback");
    check(store.readCredentialSlot("local-agent-provider:v1")==null,"existing normal admission still required");
    AlphaLocalAgentPlugin.bindCloudProvider(store,LegacyCloudRecoveryTest.ID,LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL);
    String selected=store.readCredentialSlot("local-agent-provider:v1");
    check(LocalAgentProviderAdmission.currentGeneration(selected,store.readCredentialSlot("cloud:production"))!=null,"absent provider receives fresh canonical admission");
    check(LocalAgentProviderAdmission.providerStatus(selected,store.readCredentialSlot("cloud:production"),System.currentTimeMillis()).optBoolean("configured"),"normal Cloud provider configured");
    check(AlphaConnectionPlugin.verified==2,"normal admission rechecks canonical identity instead of reusing old proof");
   }else{
    if(operation.equals("remove")||operation.equals("same-remove"))store.removeCredentialSlot("cloud:production");
    else if(operation.equals("explicit-provider-clear"))AlphaLocalAgentPlugin.clearProviderSlot(store,false);
    else if(operation.equals("write"))store.writeCredentialSlot("cloud:production",LegacyCloudRecoveryTest.SAVED);
    else store.writeCredentialSlot("local-agent-provider:v1","{\"provider\":\"cerebras\",\"model\":\"qwen-3.8-27b\"}");
    check(!store.legacyCloudRecoveryEligible(),"actual explicit mutation suppresses future restore: "+operation);
    check(raw.read(CloudDeployment.STORAGE_NAMESPACE+LegacyCloudRecovery.JOURNAL).contains("blocked"),"durable tombstone");
   }
   check(LegacyCloudRecoveryTest.SAVED.equals(raw.read("cloud:production")),"legacy copy preserved");
  }
  android.content.Context context=new android.content.Context(new File(args[0],"failed-tombstone"));
  JsonCredentialSlots raw=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  raw.write(CloudDeployment.STORAGE_NAMESPACE+"cloud:production",LegacyCloudRecoveryTest.SAVED);
  android.util.AtomicFile.failAfterStarts=0;
  try{new AlphaCredentialStore(context).removeCredentialSlot("cloud:production");throw new AssertionError("failed tombstone allowed removal");}catch(java.io.IOException expected){}
  check(LegacyCloudRecoveryTest.SAVED.equals(raw.read(CloudDeployment.STORAGE_NAMESPACE+"cloud:production")),"failed tombstone keeps current key");
  android.content.Context startup=new android.content.Context(new File(args[0],"passive-startup"));
  JsonCredentialSlots startupRaw=new JsonCredentialSlots(new File(startup.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  startupRaw.write("cloud:production",LegacyCloudRecoveryTest.SAVED);
  AlphaCredentialStore startupStore=new AlphaCredentialStore(startup);
  check(!AlphaLocalAgentPlugin.clearProviderSlot(startupStore,true).optBoolean("configured"),"startup confirms genuinely empty provider");
  check(startupStore.legacyCloudRecoveryEligible()&&startupRaw.read(CloudDeployment.STORAGE_NAMESPACE+LegacyCloudRecovery.JOURNAL)==null,"automatic empty unbind preserves recovery instead of manufacturing signout");
  startupRaw.write(CloudDeployment.STORAGE_NAMESPACE+"local-agent-provider:v1","{}");
  AlphaLocalAgentPlugin.clearProviderSlot(startupStore,true);
  check(startupStore.readCredentialSlot("local-agent-provider:v1")==null&&!startupStore.legacyCloudRecoveryEligible(),"present provider removal still clears and tombstones even if malformed");
  // Hold the REAL lifecycle lock while recovery starts. Correct code waits before acquiring
  // the vault. The previous Json→intent path occupies the vault and fails this bounded test.
  android.content.Context contention=new android.content.Context(new File(args[0],"lock-order"));
  JsonCredentialSlots retained=new JsonCredentialSlots(new File(contention.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  retained.write("cloud:production",LegacyCloudRecoveryTest.SAVED);
  java.util.concurrent.CountDownLatch lifecycleHeld=new java.util.concurrent.CountDownLatch(1),releaseLifecycle=new java.util.concurrent.CountDownLatch(1),recoveryStarted=new java.util.concurrent.CountDownLatch(1),vaultAvailable=new java.util.concurrent.CountDownLatch(1);
  java.util.concurrent.atomic.AtomicReference<Throwable> problem=new java.util.concurrent.atomic.AtomicReference<>();
  Thread normal=new Thread(()->{synchronized(AlphaLocalAgentPlugin.lifecycleLock){lifecycleHeld.countDown();try{releaseLifecycle.await();synchronized(JsonCredentialSlots.LOCK){}}catch(Exception failure){problem.set(failure);}}});normal.setDaemon(true);normal.start();check(lifecycleHeld.await(2,java.util.concurrent.TimeUnit.SECONDS),"lifecycle fixture held");
  Thread recoveryThread=new Thread(()->{recoveryStarted.countDown();try{new AlphaCredentialStore(contention,()->AlphaLocalAgentPlugin.requireCredentialIntent(1)).legacyCloudRecoveryEligible();}catch(Throwable failure){problem.set(failure);}});recoveryThread.setDaemon(true);recoveryThread.start();check(recoveryStarted.await(2,java.util.concurrent.TimeUnit.SECONDS),"recovery fixture started");
  // Wait for recovery either to acquire the vault (old bug) or block on lifecycle (fixed).
  long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(2);
  while(recoveryThread.getState()!=Thread.State.BLOCKED&&System.nanoTime()<deadline)Thread.yield();
  check(recoveryThread.getState()==Thread.State.BLOCKED,"recovery reached real lock boundary");
  Thread vaultProbe=new Thread(()->{synchronized(JsonCredentialSlots.LOCK){vaultAvailable.countDown();}});vaultProbe.setDaemon(true);vaultProbe.start();
  boolean ordered=vaultAvailable.await(1,java.util.concurrent.TimeUnit.SECONDS);releaseLifecycle.countDown();
  check(ordered,"recovery must not hold vault while waiting for lifecycle");normal.join(2000);recoveryThread.join(2000);check(!normal.isAlive()&&!recoveryThread.isAlive()&&problem.get()==null,"concurrent signout/recovery completes");
  workspaceReturns(args[0]);
  System.out.println("PASS actual AlphaCredentialStore restore, canonical identity, no-op clears and explicit writes");
 }
 static void workspaceReturns(String root)throws Exception{
  String original=LegacyCloudRecoveryTest.SAVED,pending="synthetic-workspace-pending";
  String changed=new org.json.JSONObject(original).put("token","replacement-synthetic-token").toString();
  String metadata=new org.json.JSONObject(original).put("expiresAt",System.currentTimeMillis()+7200000).put("description","refreshed metadata").toString();
  org.json.JSONObject saved=new org.json.JSONObject(original);
  String reordered=new org.json.JSONObject().put("expiresAt",saved.getLong("expiresAt")).put("token",saved.getString("token")).put("credentialId",saved.getString("credentialId")).toString();
  for(String operation:new String[]{"write","remove","cas","cas-remove","user-change","org-change","no-op-write","no-op-cas","failed-cas","metadata","reordered","staging","unrelated"}){
   android.content.Context context=new android.content.Context(new File(root,"workspace-"+operation));
   JsonCredentialSlots raw=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
   raw.write(CloudDeployment.storageSlot("cloud:production"),original);
   AlphaCredentialStore store=new AlphaCredentialStore(context);
   store.writeCredentialSlot(GoogleWorkspaceReturn.SLOT,pending);
   boolean keep=false;
   switch(operation){
    case "write":store.writeCredentialSlot("cloud:production",changed);break;
    case "remove":store.removeCredentialSlot("cloud:production");break;
    case "cas":check(store.compareExchangeCredentialSlot("cloud:production",original,changed),"credential CAS succeeded");break;
    case "cas-remove":check(store.compareExchangeCredentialSlot("cloud:production",original,null),"credential CAS removal succeeded");break;
    case "user-change":store.writeCredentialSlot("cloud:production",new org.json.JSONObject(original).put("userId","33333333-3333-4333-8333-333333333333").toString());break;
    case "org-change":store.writeCredentialSlot("cloud:production",new org.json.JSONObject(original).put("organizationId","44444444-4444-4444-8444-444444444444").toString());break;
    case "no-op-write":store.writeCredentialSlot("cloud:production",original);keep=true;break;
    case "no-op-cas":check(store.compareExchangeCredentialSlot("cloud:production",original,original),"same credential CAS succeeded");keep=true;break;
    case "failed-cas":check(!store.compareExchangeCredentialSlot("cloud:production","not-current",changed),"stale CAS refused");keep=true;break;
    case "metadata":store.writeCredentialSlot("cloud:production",metadata);keep=true;break;
    case "reordered":store.writeCredentialSlot("cloud:production",reordered);keep=true;break;
    case "staging":store.writeCredentialSlot("cloud:staging",changed);keep=true;break;
    case "unrelated":store.writeCredentialSlot("device:fixture","unrelated");keep=true;break;
   }
   check(keep?pending.equals(store.readCredentialSlot(GoogleWorkspaceReturn.SLOT)):store.readCredentialSlot(GoogleWorkspaceReturn.SLOT)==null,"Workspace pending lifecycle: "+operation);
   if(!keep){
    // ABA cannot revive the old attempt even when the exact original credential bytes return.
    store.writeCredentialSlot("cloud:production",original);
    check(store.readCredentialSlot(GoogleWorkspaceReturn.SLOT)==null,"restoring old credential never restores pending: "+operation);
    check(original.equals(store.readCredentialSlot("cloud:production")),"original credential restored without pending: "+operation);
   }
  }
  android.content.Context context=new android.content.Context(new File(root,"workspace-legacy-direct-write"));
  JsonCredentialSlots raw=new JsonCredentialSlots(new File(context.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  raw.write("cloud:production",original);
  AlphaCredentialStore store=new AlphaCredentialStore(context);
  store.writeCredentialSlot(GoogleWorkspaceReturn.SLOT,pending);
  check(store.restoreLegacyCloudCredential(),"legacy direct write restores credential");
  check(store.readCredentialSlot(GoogleWorkspaceReturn.SLOT)==null,"legacy direct credential write clears pending");
  check(original.equals(raw.read("cloud:production")),"legacy source retained after Workspace invalidation");
  for(String slot:new String[]{"google-workspace-return",GoogleWorkspaceReturn.SLOT,"google-workspace-return:v99:future"}){
   try{RendererCredentialSlots.requireAllowed(slot);throw new AssertionError("Workspace slot was renderer accessible");}
   catch(SecurityException expected){}
  }
  check("google-workspace-returned:v1".equals(RendererCredentialSlots.requireAllowed("google-workspace-returned:v1")),"native slot prefix requires exact namespace separator");
  // Exercise the actual native admission critical section against the real central store.
  android.content.Context admissionContext=new android.content.Context(new File(root,"workspace-admission-aba"));
  JsonCredentialSlots admissionRaw=new JsonCredentialSlots(new File(admissionContext.getNoBackupFilesDir(),"connection-credentials"),"alpha.connection.aes.v1",name->262144);
  admissionRaw.write(CloudDeployment.storageSlot("cloud:production"),original);
  AlphaCredentialStore admissionStore=new AlphaCredentialStore(admissionContext);
  int[] calls={0};
  GoogleWorkspaceReturnFlow flow=new GoogleWorkspaceReturnFlow(new GoogleWorkspaceReturnFlow.Store(){
   private void locked(){check(Thread.holdsLock(AlphaLocalAgentPlugin.lifecycleLock)&&Thread.holdsLock(JsonCredentialSlots.LOCK),"native admission holds lifecycle then vault");calls[0]++;}
   public String credential()throws Exception{locked();return admissionStore.readCredentialSlot("cloud:production");}
   public String pending()throws Exception{locked();return admissionStore.readCredentialSlot(GoogleWorkspaceReturn.SLOT);}
   public boolean comparePending(String expected,String value)throws Exception{locked();return admissionStore.compareExchangeCredentialSlot(GoogleWorkspaceReturn.SLOT,expected,value);}
  });
  GoogleWorkspaceReturn.Binding owner=GoogleWorkspaceReturnFlow.binding("production","22222222-2222-4222-8222-222222222222","33333333-3333-4333-8333-333333333333",LegacyCloudRecoveryTest.ID,original);
  long priorEpoch=AlphaLocalAgentPlugin.credentialAuthorityEpoch();
  admissionStore.removeCredentialSlot("cloud:production");
  admissionStore.writeCredentialSlot("cloud:production",original);
  check(AlphaLocalAgentPlugin.credentialAuthorityEpoch()!=priorEpoch,"clear and same-byte restore advances authority epoch");
  try{AlphaLocalAgentPlugin.withCredentialAuthority(priorEpoch,()->flow.prepare(owner,"A".repeat(43),1000));throw new AssertionError("old admission epoch revived after ABA");}catch(SecurityException expected){}
  check(admissionStore.readCredentialSlot(GoogleWorkspaceReturn.SLOT)==null&&calls[0]==0,"stale API call refuses before flow or pending write");
  long currentEpoch=AlphaLocalAgentPlugin.credentialAuthorityEpoch();
  admissionStore.writeCredentialSlot("cloud:production",metadata);
  check(AlphaLocalAgentPlugin.credentialAuthorityEpoch()==currentEpoch,"metadata-only refresh retains authority epoch");
  String redirect=AlphaLocalAgentPlugin.withCredentialAuthority(currentEpoch,()->flow.prepare(owner,"B".repeat(43),1000));
  check(redirect.equals(GoogleWorkspaceReturn.CALLBACK+"?state="+"B".repeat(43))&&calls[0]>0,"current API admits real flow under both locks");
  check(admissionStore.readCredentialSlot(GoogleWorkspaceReturn.SLOT)!=null,"current API retains prepared pending record");
  System.out.println("PASS Workspace credential lifecycle and native-slot isolation");
 }
}
