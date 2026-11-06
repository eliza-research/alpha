package ai.elizaresearch.alphaphone;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** First-party local runtime bridge. Runtime and owner bearer tokens stay native. */
@CapacitorPlugin(name="Agent")
public final class AlphaLocalAgentPlugin extends Plugin {
 private final ExecutorService workers=Executors.newFixedThreadPool(2);
 private final ExecutorService voiceWorkers=new java.util.concurrent.ThreadPoolExecutor(1,1,0L,java.util.concurrent.TimeUnit.MILLISECONDS,new java.util.concurrent.SynchronousQueue<>());
 // Set only from in-process debug instrumentation; no route, intent or preference activation.
 static volatile java.net.ServerSocket instrumentationRecoveryEndpoint;
 private static String rootToken,ownerToken,ownerIdentity;
 private static long expiresAt;
 private static final Object lifecycleLock=new Object(), enrollmentLock=new Object();
 private static long lifecycleEpoch;
 private static volatile long credentialMutationEpoch=-1;
 private static long credentialShutdownRequest=-1;
 private static long credentialShutdownRetryEpoch=-1;
 private static String startRequestId;
 private static long startRequestEpoch;
 private static boolean startOwnsLaunch;
 private static long credentialIntentEpoch;
 private final java.util.Set<String> cancelledStarts=new java.util.HashSet<>();
 private static boolean accepting=true,stopping;
 private volatile boolean disposed;
 // Provider admission generation the running agent process was launched with (configureEnvironment).
 private static String launchedGeneration;
 // This surface's start requests that attached. Cancelling one never retires the shared launch.
 private final ResidentAttachment.Requests attachedStarts=new ResidentAttachment.Requests();
 // Set when this surface's attach could not be verified; its next start takes the full path.
 private boolean attachUnverified;
 // Each Activity bridge (MainActivity, AlphaAssistActivity) has its own plugin instance. Calls,
 // streams and their invalidators belong to the instance that admitted them, so one surface's
 // destruction cancels only its own work. The runtime, epoch and enrollment stay process-wide.
 private final ResidentRecoveryReview recoveryReview=new ResidentRecoveryReview();
 private final java.util.Set<PluginCall> pending=new java.util.HashSet<>();
 private final java.util.Map<String,ElizaAgentService.LocalStreamHandle> streams=new java.util.HashMap<>();
 private final java.util.Map<String,Runnable> streamInvalidators=new java.util.HashMap<>();
 private static final java.util.Set<AlphaLocalAgentPlugin> instances=new java.util.HashSet<>();
 @Override public void load(){super.load();synchronized(lifecycleLock){if(!disposed)instances.add(this);}}
 /** This instance only: used when its own bridge is destroyed. Caller holds lifecycleLock. */
 private void invalidateOwnCalls(){
  recoveryReview.clear();
  for(var notify:streamInvalidators.values())notify.run();streamInvalidators.clear();
  for(var handle:streams.values())handle.cancel();streams.clear();
  for(PluginCall call:pending)call.reject("Local agent connection changed. A dispatched operation may still have completed; inspect its receipt before retrying.","LOCAL_AGENT_EPOCH_CHANGED");
  pending.clear();
 }
 /** Runtime lifecycle changes (start, stop, cancelled start) supersede every surface's work. Caller holds lifecycleLock. */
 private static void invalidateCalls(){
  for(AlphaLocalAgentPlugin instance:new java.util.ArrayList<>(instances))instance.invalidateOwnCalls();
 }
 /** Package-private observation for instrumentation; never a Capacitor method. */
 int ownedWorkCount(){synchronized(lifecycleLock){return pending.size()+streams.size();}}
 static boolean enrollmentPresent(){synchronized(lifecycleLock){return rootToken!=null&&ownerToken!=null;}}
 /** Instrumentation-only: register a synthetic in-flight stream owned by this instance. */
 void adoptStreamForTest(String id,ElizaAgentService.LocalStreamHandle handle,Runnable invalidator){if(!BuildConfig.DEBUG)throw new IllegalStateException();synchronized(lifecycleLock){instances.add(this);streams.put(id,handle);streamInvalidators.put(id,invalidator);}}
 static void enrollForTest(String root,String owner,String identity,long expiry){if(!BuildConfig.DEBUG)throw new IllegalStateException();synchronized(lifecycleLock){rootToken=root;ownerToken=owner;ownerIdentity=identity;expiresAt=expiry;}}
 static void launchedGenerationForTest(String generation){if(!BuildConfig.DEBUG)throw new IllegalStateException();synchronized(lifecycleLock){launchedGeneration=generation;}}
 static long lifecycleEpochForTest(){if(!BuildConfig.DEBUG)throw new IllegalStateException();synchronized(lifecycleLock){return lifecycleEpoch;}}
 /** Instrumentation-only: the production attach admission against a synthetic runtime observation. */
 String attachForTest(JSONObject bootState,String currentRoot,String currentGeneration){if(!BuildConfig.DEBUG)throw new IllegalStateException();synchronized(lifecycleLock){return attachLocked(bootState,currentRoot,currentGeneration);}}
 /** Caller holds lifecycleLock. Read-only: null when this surface may attach to the running resident. */
 private String attachRefusalLocked(JSONObject bootState,String currentRoot,String currentGeneration){
  if(disposed)return "bridge-closed";
  ResidentAttachment.Facts facts=new ResidentAttachment.Facts();
  facts.accepting=accepting;facts.stopping=stopping;facts.credentialMutating=credentialMutationEpoch>=0;facts.credentialShutdownPending=credentialShutdownRequest!=-1;facts.attachUnverified=attachUnverified;
  facts.currentRoot=currentRoot;facts.enrolledRoot=rootToken;facts.ownerToken=ownerToken;facts.ownerIdentity=ownerIdentity;facts.expiresAt=expiresAt;facts.now=System.currentTimeMillis();
  facts.launchedGeneration=launchedGeneration;facts.currentGeneration=currentGeneration;
  return ResidentAttachment.refusal(bootState,facts);
 }
 /** Caller holds lifecycleLock. Attaching supersedes only this surface's own earlier work: the
  * runtime epoch, the owner enrollment and every other surface's calls and streams are untouched. */
 private String attachLocked(JSONObject bootState,String currentRoot,String currentGeneration){
  String refusal=attachRefusalLocked(bootState,currentRoot,currentGeneration);
  if(refusal==null)invalidateOwnCalls();
  return refusal;
 }
 /** Stored provider admission generation; NO_PROVIDER_GENERATION when no provider is stored (the agent runs unbound and surfaces attach to it as to a bound one); null when legacy or no longer valid. Never writes. */
 private static String storedProviderGeneration(AlphaCredentialStore store){
  try{
   String saved=store.readCredentialSlot("local-agent-provider:v1");if(saved==null)return LocalAgentProviderAdmission.NO_PROVIDER_GENERATION;
   String cloud="elizacloud".equals(new JSONObject(saved).optString("provider"))?store.readCredentialSlot("cloud:production"):null;
   return LocalAgentProviderAdmission.currentGeneration(saved,cloud);
  }catch(Exception unavailable){return null;}
 }
 /**
  * A system broadcast starts the resident only while no surface is stopping it or changing its
  * provider. The check and ElizaAgentService.start share lifecycleLock, as start() does, so a stop
  * cannot slip between them. The epoch is left alone: a running resident is not restarted and its
  * attached surfaces keep their in-flight calls.
  */
 static ResidentScheduleRearm.Decision startResidentIfAdmissible(Context context,String action,boolean userUnlocked,boolean runtimePackaged,boolean ownerEnabled){
  return ResidentScheduleRearm.admitAndStart(lifecycleLock,action,userUnlocked,runtimePackaged,ownerEnabled,
   ()->accepting&&!stopping&&credentialMutationEpoch<0&&credentialShutdownRequest==-1,()->ElizaAgentService.start(context));
 }
 private void rejectPending(PluginCall call,String message){synchronized(lifecycleLock){if(pending.remove(call))call.reject(message);}}

 private static final class Superseded extends Exception {}
 private static void clearEnrollment(){rootToken=null;ownerToken=null;ownerIdentity=null;expiresAt=0;}
 static long reserveCredentialIntent(){synchronized(lifecycleLock){return ++credentialIntentEpoch;}}
 static void requireCredentialIntent(long intent){synchronized(lifecycleLock){if(intent!=credentialIntentEpoch)throw new IllegalStateException("Credential intent changed");}}
 interface CredentialMutation<T> {
  boolean requiresShutdown()throws Exception;
  T commit()throws Exception;
 }
 /** Slot classification/commit are atomic; observing shutdown must never hold the vault lock. */
 static <T> T mutateCredentials(Context context,Runnable assertOwner,CredentialMutation<T> mutation)throws Exception {
  final long epoch;
  synchronized(lifecycleLock){
   assertOwner.run();
   synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
    if(!mutation.requiresShutdown())return mutation.commit();
   }
   startRequestId=null;startOwnsLaunch=false;
   invalidateCalls();epoch=++lifecycleEpoch;credentialMutationEpoch=epoch;accepting=false;stopping=true;clearEnrollment();
  }
  try{
   final long stopRequest;
   synchronized(lifecycleLock){assertOwner.run();if(epoch!=lifecycleEpoch||credentialMutationEpoch!=epoch)throw new Superseded();credentialShutdownRequest=-2;stopRequest=ElizaAgentService.stopForCredentialChange(context);credentialShutdownRequest=stopRequest;}
   long deadline=android.os.SystemClock.elapsedRealtime()+15000;
   while(true){
    synchronized(lifecycleLock){assertOwner.run();if(epoch!=lifecycleEpoch||credentialMutationEpoch!=epoch)throw new Superseded();}
    JSONObject status=ElizaAgentService.getLocalAgentBootState(context);
    synchronized(lifecycleLock){
     assertOwner.run();if(epoch!=lifecycleEpoch||credentialMutationEpoch!=epoch)throw new Superseded();
     if(shutdownConfirmed(status)&&ElizaAgentService.isCredentialShutdownConfirmed(stopRequest)){
      synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){return mutation.commit();}
     }
    }
    if(android.os.SystemClock.elapsedRealtime()>=deadline)throw new IllegalStateException("Native shutdown unconfirmed");
    Thread.sleep(50);
   }
  }finally{
   synchronized(lifecycleLock){if(credentialMutationEpoch==epoch)credentialMutationEpoch=-1;}
  }
 }
 static boolean providerAdmissionReadable(){return credentialMutationEpoch<0;}
 private void requireCurrent(long epoch) throws Superseded {
  synchronized(lifecycleLock){if(disposed||!accepting||epoch!=lifecycleEpoch)throw new Superseded();}
 }
 private long admittedEpoch() throws Superseded {
  synchronized(lifecycleLock){requireCurrent(lifecycleEpoch);return lifecycleEpoch;}
 }
 private void resolveCurrent(PluginCall call,long epoch,JSObject result) throws Superseded {
  synchronized(lifecycleLock){requireCurrent(epoch);if(pending.remove(call))call.resolve(result);}
 }
 /** A surface that attaches again supersedes its own earlier calls without advancing the epoch, so
  * a queued request must still be this surface's pending call before it pairs or is dispatched. */
 private void requireOwned(PluginCall call,long epoch) throws Superseded {
  synchronized(lifecycleLock){requireCurrent(epoch);if(!pending.contains(call))throw new Superseded();}
 }
 private void rejectSuperseded(PluginCall call){synchronized(lifecycleLock){if(pending.remove(call))call.reject("Local agent connection changed. A dispatched operation may still have completed; inspect its receipt before retrying.","LOCAL_AGENT_EPOCH_CHANGED");}}

 private boolean runtimePackaged() { return runtimePackaged(getContext()); }
 /** True when this build carries the on-device runtime bundle and its launcher. */
 static boolean runtimePackaged(Context context) {
  try {
   try(var ignored=context.getAssets().open("agent/agent-bundle.js")){}
   return new File(context.getApplicationInfo().nativeLibraryDir,"libeliza_bun.so").isFile();
  } catch(Exception unavailable) { return false; }
 }
 /** Hosted inference stays on Qwen through Cerebras; the model is not selectable. */
 static final String CEREBRAS_PROVIDER_MODEL=LocalAgentProviderAdmission.CEREBRAS_PROVIDER_MODEL;
 static final String CEREBRAS_MODELS_URL="https://api.cerebras.ai/v1/models";
 static final int PROVIDER_CHECK_TIMEOUT_MS=10_000, PROVIDER_CHECK_BODY_LIMIT=256*1024;
 /** Interprets Cerebras' bounded models listing. Returns null when the key is accepted and the
  * pinned model is listed, otherwise a renderer-safe message (never the key or response body). */
 static String providerCheckFailure(int status,String body,String model){
  if(status==401||status==403)return "Cerebras did not accept this key. It was not saved.";
  if(status==429)return "Cerebras is rate-limiting key checks. Try again shortly; the key was not saved.";
  if(status<200||status>=300)return "Cerebras could not confirm this key right now. It was not saved.";
  try{
   org.json.JSONArray models=new JSONObject(body).getJSONArray("data");
   for(int i=0;i<models.length();i++){JSONObject row=models.optJSONObject(i);if(row!=null&&model.equals(row.optString("id")))return null;}
   return "This Cerebras key does not offer "+model+". It was not saved.";
  }catch(Exception invalid){return "Cerebras returned an unexpected response. The key was not saved.";}
 }
 /** One bounded GET of the models listing: no redirects, no caching, no retry. */
 static String checkCerebrasKey(String key,String model){
  javax.net.ssl.HttpsURLConnection connection=null;
  try{
   connection=(javax.net.ssl.HttpsURLConnection)new java.net.URL(CEREBRAS_MODELS_URL).openConnection();
   connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
   connection.setConnectTimeout(PROVIDER_CHECK_TIMEOUT_MS);connection.setReadTimeout(PROVIDER_CHECK_TIMEOUT_MS);
   connection.setRequestMethod("GET");connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Authorization","Bearer "+key);
   int status=connection.getResponseCode();
   if(status<200||status>=300)return providerCheckFailure(status,"",model);
   java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();
   try(java.io.InputStream input=connection.getInputStream()){byte[] buffer=new byte[8192];int read;while((read=input.read(buffer))!=-1){if(bytes.size()+read>PROVIDER_CHECK_BODY_LIMIT)return "Cerebras returned an unexpected response. The key was not saved.";bytes.write(buffer,0,read);}}
   return providerCheckFailure(status,bytes.toString("UTF-8"),model);
  }catch(Exception unreachable){return "Cerebras could not be reached to check this key. It was not saved.";}
  finally{if(connection!=null)connection.disconnect();}
 }
 interface ProviderCheck { String check(String key,String model); }
 /** Verify before saving: a key is stored only after the check accepts it, then read back. */
 static String saveVerifiedProvider(AlphaCredentialStore store,String key,String model,ProviderCheck check) throws Exception {
  if(!validProviderToken(key,1024))return "Enter a valid Cerebras key.";
  if(!CEREBRAS_PROVIDER_MODEL.equals(model))return "Alpha Phone uses "+CEREBRAS_PROVIDER_MODEL+" on Cerebras.";
  String failure=check.check(key,model);
  if(failure!=null)return failure;
  store.assertCurrent();bindDirectProvider(store,key,model);store.assertCurrent();
  JSONObject saved=new JSONObject(store.readCredentialSlot("local-agent-provider:v1"));
  if(!key.equals(saved.optString("key"))||!model.equals(saved.optString("model")))throw new IllegalStateException();
  return null;
 }
 /** Deletes the provider slot and confirms by reading it back. */
 static JSObject clearProviderSlot(AlphaCredentialStore store) throws Exception {
  store.removeCredentialSlot("local-agent-provider:v1");
  if(store.readCredentialSlot("local-agent-provider:v1")!=null)throw new IllegalStateException("Provider key still present");
  return providerIdentity(null);
 }
 /** Which surface hosts this bridge. Only Alpha's own alpha.assistant flag (set by
  * AlphaAssistActivity after dropping caller extras) is reported; never caller content. */
 @PluginMethod public void launchSurface(PluginCall call) {
  android.app.Activity activity=getActivity();
  boolean assistant=activity instanceof AlphaAssistActivity&&activity.getIntent()!=null&&activity.getIntent().getBooleanExtra(AlphaAssistActivity.EXTRA_ASSISTANT,false);
  call.resolve(new JSObject().put("assistant",assistant));
 }
 /** How this assistant surface was opened, consumed on read: "listener" (the image's always-on
  * listener, see AssistInvocation) is reported once per launch, then "assist". `locked` reports
  * whether the keyguard is showing now. */
 @PluginMethod public void takeInvocation(PluginCall call) {
  android.app.Activity activity=getActivity();
  boolean assistant=activity instanceof AlphaAssistActivity&&activity.getIntent()!=null&&activity.getIntent().getBooleanExtra(AlphaAssistActivity.EXTRA_ASSISTANT,false);
  String invocation=assistant?((AlphaAssistActivity)activity).takeInvocation():null;
  // The renderer never opens the microphone behind the keyguard; unknown keyguard state counts as locked.
  android.app.KeyguardManager keyguard=getContext().getSystemService(android.app.KeyguardManager.class);
  boolean locked=keyguard==null||keyguard.isKeyguardLocked();
  call.resolve(new JSObject().put("assistant",invocation!=null).put("invocation",invocation).put("locked",locked));
 }
 /** Read-only: may this surface attach to the admitted running resident under the stored provider
  * admission? Never starts, stops, pairs or rebinds. With credentialId, the stored admission must
  * be that Cloud credential on the pinned model. Reasons are non-sensitive diagnostics. */
 @PluginMethod public void residentAttachment(PluginCall call) {
  final String credentialId=call.getString("credentialId");
  PluginWorkers.submit(workers,()->{try{
   AlphaCredentialStore store=new AlphaCredentialStore(getContext());
   String refusal=null;
   if(credentialId!=null){
    try{
     JSONObject provider=new JSONObject(store.readCredentialSlot("local-agent-provider:v1"));
     if(!"elizacloud".equals(provider.optString("provider"))||!credentialId.equals(provider.optString("credentialId"))||!CLOUD_PROVIDER_MODEL.equals(provider.optString("model")))refusal="provider-changed";
    }catch(Exception unreadable){refusal="provider-unadmitted";}
   }
   String generation=storedProviderGeneration(store),root=ElizaAgentService.localAgentToken();
   JSONObject bootState=ElizaAgentService.getLocalAgentBootState(getContext());
   if(refusal==null)synchronized(lifecycleLock){refusal=attachRefusalLocked(bootState,root,generation);}
   call.resolve(new JSObject(ResidentAttachment.describe(refusal).toString()));
  }catch(Exception unavailable){call.resolve(new JSObject().put("attachable",false).put("reason","unavailable"));}},()->{call.reject("Local agent bridge is closed.");});
 }
 /** A direct (bring-your-own) Cerebras key is a test-mocks developer surface only. Product phones use
  * the owner's Eliza Cloud plan through configureCloudProvider; production refuses before reading the key. */
 static boolean directProviderAllowed(boolean testMocks){return testMocks;}
 @PluginMethod public void configureProvider(PluginCall call) {
  if(!directProviderAllowed(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)){call.reject("Alpha Phone uses your Cloud plan for AI.");return;}
  if(!runtimePackaged()){call.reject("On-device agent is unavailable in this version.");return;}
  String key=call.getString("apiKey",""),model=call.getString("model",CEREBRAS_PROVIDER_MODEL);
  if(!validProviderToken(key,1024)||!model.matches("[A-Za-z0-9][A-Za-z0-9._/-]{0,127}")){call.reject("Enter a valid Cerebras key.");return;}
  if(!CEREBRAS_PROVIDER_MODEL.equals(model)){call.reject("Alpha Phone uses "+CEREBRAS_PROVIDER_MODEL+" on Cerebras.");return;}
  final long configuration=reserveCredentialIntent();
  PluginWorkers.submit(workers,()->{try{
   AlphaCredentialStore store=new AlphaCredentialStore(getContext(),()->{if(disposed)throw new IllegalStateException("Local agent bridge closed");requireCredentialIntent(configuration);});
   String failure=saveVerifiedProvider(store,key,model,AlphaLocalAgentPlugin::checkCerebrasKey);
   if(failure!=null){call.reject(failure);return;}
   store.assertCurrent();call.resolve(providerIdentity(store.readCredentialSlot("local-agent-provider:v1")));
  }catch(Exception error){call.reject("Provider could not be saved securely.");}},()->{call.reject("Local agent bridge is closed.");});
 }
 /** Deletes the provider slot and reads it back; resolves only when the slot is gone. */
 @PluginMethod public void clearProvider(PluginCall call) {
  final long configuration=reserveCredentialIntent();
  PluginWorkers.submit(workers,()->{try{
   call.resolve(clearProviderSlot(new AlphaCredentialStore(getContext(),()->{if(disposed)throw new IllegalStateException("Local agent bridge closed");requireCredentialIntent(configuration);})));
  }catch(Exception error){call.reject("The provider key could not be removed.");}},()->{call.reject("Local agent bridge is closed.");});
 }
 static final String CLOUD_PROVIDER_MODEL=LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL;
 static final String CLOUD_PROVIDER_BASE=LocalAgentProviderAdmission.CLOUD_PROVIDER_BASE;
 /** Binds an existing account credential; no bearer value crosses this method's renderer API. */
 @PluginMethod public void configureCloudProvider(PluginCall call) {
  if(!runtimePackaged()){call.reject("On-device agent is unavailable in this version.");return;}
  String credentialId=call.getString("credentialId",""),model=call.getString("model","");
  if(!CLOUD_PROVIDER_MODEL.equals(model)){call.reject("Choose a supported Cloud model.");return;}
  final long configuration=reserveCredentialIntent();
  PluginWorkers.submit(workers,()->{try{
   AlphaCredentialStore store=new AlphaCredentialStore(getContext(),()->{if(disposed)throw new IllegalStateException("Local agent bridge closed");requireCredentialIntent(configuration);});
   bindCloudProvider(store,credentialId,model);store.assertCurrent();
   call.resolve(new JSObject().put("configured",true));
  }catch(Exception unavailable){
   String code="NATIVE_CLOUD_ADMISSION_UNAVAILABLE";
   if(unavailable instanceof LocalAgentProviderAdmission.CloudBindingFailure){LocalAgentProviderAdmission.CloudBindingFailure failure=(LocalAgentProviderAdmission.CloudBindingFailure)unavailable;code="NATIVE_CLOUD_ADMISSION_"+failure.stage.toUpperCase(java.util.Locale.ROOT).replace('-','_');android.util.Log.w("AlphaCloudAdmission",failure.diagnostic.toString());}
   call.reject("Cloud account changed or is unavailable. Sign in again before starting the local agent.",code);
  }},()->{call.reject("Local agent bridge is closed.");});
 }
 /** Preserve the previous selection when admission loses its account, without replacing a newer selection. */
 static void bindCloudProvider(AlphaCredentialStore store,String credentialId,String model) throws Exception {
  LocalAgentProviderAdmission.bindCloudProvider(new LocalAgentProviderAdmission.CloudBindingStore(){
   public String readProvider()throws Exception{return store.readCredentialSlot("local-agent-provider:v1");}
   public String readCloud()throws Exception{return store.readCredentialSlot("cloud:production");}
   public void assertCurrent()throws Exception{store.assertCurrent();}
   public JSONObject identity(String token)throws Exception{return AlphaConnectionPlugin.readCloudIdentity(token);}
   public String admit(String previous,String selection,String cloud,JSONObject identity)throws Exception{return store.compareExchangeProviderAdmission(previous,selection,"cloud:production",cloud,identity);}
   public void rollback(String binding,String previous)throws Exception{store.rollbackProviderAdmission(binding,previous);}
  },credentialId,model,System::currentTimeMillis);
 }
 /** Direct configuration is also an explicit native admission; renderer metadata is never accepted. */
 static void bindDirectProvider(AlphaCredentialStore store,String key,String model)throws Exception {
  if(!validProviderToken(key,1024)||!model.matches(PROVIDER_MODEL_PATTERN))throw new IllegalArgumentException();
  String previous=store.readCredentialSlot("local-agent-provider:v1");
  String selection=new JSONObject().put("provider","cerebras").put("key",key).put("model",model)
   .put("revision",java.util.UUID.randomUUID().toString()).toString();
  if(store.compareExchangeProviderAdmission(previous,selection,null,null,null)==null)throw new IllegalStateException();
 }
 // The provider rules live in LocalAgentProviderAdmission (host-JVM tested); these names stay for callers.
 static boolean validProviderToken(String token,int maximumLength){return LocalAgentProviderAdmission.validProviderToken(token,maximumLength);}
 static String cloudProviderToken(String saved,String credentialId,long now) throws Exception {return LocalAgentProviderAdmission.cloudProviderToken(saved,credentialId,now);}
 static void applyProviderEnvironment(JSONObject provider,String cloudSaved,java.util.Map<String,String> env,long now) throws Exception {if("cloud".equals(BuildConfig.ELIZA_RUNTIME_PROFILE)&&!"elizacloud".equals(provider.optString("provider")))throw new SecurityException("Cloud runtime requires Cloud provider admission");LocalAgentProviderAdmission.applyProviderEnvironment(provider,cloudSaved,env,now);}
 static final String PROVIDER_MODEL_PATTERN=LocalAgentProviderAdmission.PROVIDER_MODEL_PATTERN;
 /**
  * No admitted plan, Cloud unreachable without a recent plan, or signed out: the agent runs with no
  * hosted inference. Every provider credential and selector is removed, so no request can reach a
  * model provider; the pinned upstream runtime answers chat turns as provider-less (no_provider).
  */
 static void applyUnboundEnvironment(java.util.Map<String,String> env){
  for(String name:new String[]{"ELIZAOS_CLOUD_API_KEY","ELIZAOS_CLOUD_BASE_URL","ELIZAOS_CLOUD_SMALL_MODEL","ELIZAOS_CLOUD_LARGE_MODEL","ELIZAOS_CLOUD_USE_EMBEDDINGS","ELIZAOS_CLOUD_EMBEDDING_MODEL","ELIZAOS_CLOUD_EMBEDDING_DIMENSIONS",
   "CEREBRAS_API_KEY","CEREBRAS_BASE_URL","CEREBRAS_MODEL","CEREBRAS_SMALL_MODEL","CEREBRAS_LARGE_MODEL","OPENAI_API_KEY","OPENAI_BASE_URL","ELIZA_PROVIDER",
   "ELIZA_LOCAL_EMBEDDING_MODEL_PATH","ELIZA_LOCAL_EMBEDDING_DIMENSIONS","ELIZA_NATIVE_GOOGLE_HOST_MODULE","ELIZA_NATIVE_GOOGLE_BINDING_JSON",
   "ELIZA_MANAGED_GMAIL_READ_BROKER","ELIZA_MANAGED_GMAIL_SEND_BROKER","ELIZA_MANAGED_GMAIL_OPERATION_BROKER","ELIZA_MANAGED_CALENDAR_READ_BROKER",
   // Upstream default-off Google mutations (elizaOS/eliza#36598) stay off until Seeker acceptance and the production service.
   "ELIZA_MANAGED_CALENDAR_DELETE_ENABLED","ELIZA_NATIVE_GOOGLE_GMAIL_SEND_ENABLED","ELIZA_MANAGED_GMAIL_MAILBOX_CHANGES_ENABLED"})env.remove(name);
  env.put("ELIZAOS_CLOUD_USE_INFERENCE","false");
  env.put("ELIZAOS_CLOUD_USE_EMBEDDINGS","false");
  // No embedding download: the packaged on-device embedding model is enabled when present (configureLocalEmbeddings).
  env.put("ELIZA_DISABLE_LOCAL_EMBEDDINGS","true");
  env.put("ELIZA_LOCAL_EMBEDDING_ENABLED","0");
  env.put("ELIZA_HOST_CONTEXT_REVISION","boot:"+java.util.UUID.randomUUID().toString());
 }
 static JSObject providerIdentity(String saved) {
  try{return new JSObject(LocalAgentProviderAdmission.providerIdentity(saved).toString());}
  catch(org.json.JSONException impossible){throw new IllegalStateException(impossible);}
 }
 @PluginMethod public void providerStatus(PluginCall call) {
  PluginWorkers.submit(workers,()->{
   try{
    AlphaCredentialStore store=new AlphaCredentialStore(getContext());
    String saved=store.readCredentialSlot("local-agent-provider:v1");
    JSONObject provider=LocalAgentProviderAdmission.providerIdentity(saved);
    String cloud="elizacloud".equals(provider.optString("provider"))?store.readCredentialSlot("cloud:production"):null;
    if(BuildConfig.DEBUG){try{android.util.Log.i("AlphaCloudAdmission","credential-schema="+LocalAgentProviderAdmission.cloudCredentialDiagnostics(store.readCredentialSlot("cloud:production"),null,System.currentTimeMillis()));}catch(Exception unavailable){android.util.Log.i("AlphaCloudAdmission","credential-schema-read-unavailable");}}
    call.resolve(new JSObject(LocalAgentProviderAdmission.providerStatus(saved,cloud,System.currentTimeMillis()).toString()));
   }
   catch(Exception unavailable){call.reject("Provider status unavailable.");}
  },()->{call.reject("Local agent bridge is closed.");});
 }
 /** The shared service activates its bionic host from this same packaged engine/JNI pair. */
 static void configureLocalEmbeddings(File nativeDirectory,File filesDirectory,java.util.Map<String,String> env) {
  File model=new File(filesDirectory,".eliza/local-inference/models/bge-small-en-v1.5-f16.gguf");
  if(!new File(nativeDirectory,"libelizainference.so").isFile()||!new File(nativeDirectory,"libelizavoicejni.so").isFile()||!model.isFile())return;
  // The APK build guard pins these native bytes and the BGE model. BgeEmbeddingSession
  // verifies the actual extracted model and vector space before native inference.
  env.put("ELIZAOS_CLOUD_USE_EMBEDDINGS","false");
  env.put("ELIZA_DISABLE_LOCAL_EMBEDDINGS","false");
  env.put("ELIZA_LOCAL_EMBEDDING_ENABLED","1");
  env.put("ELIZA_LOCAL_EMBEDDING_MODEL_PATH",model.getAbsolutePath());
  env.put("ELIZA_LOCAL_EMBEDDING_DIMENSIONS","384");
 }
 static void configureNativeViews(java.io.InputStream policy,java.util.Map<String,String> env) throws java.io.IOException {
  try(policy){
   java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
   byte[] buffer=new byte[4096];int count;
   while((count=policy.read(buffer))!=-1){
    if(output.size()+count>16384)throw new java.io.IOException("Native view launch policy is too large");
    output.write(buffer,0,count);
   }
   env.put("ELIZA_NATIVE_VIEW_DECLARATIONS",output.toString(java.nio.charset.StandardCharsets.UTF_8.name()));
  }
 }
 static void configureEnvironment(Context context,java.util.Map<String,String> env) throws java.io.IOException {
  env.put("ELIZA_RUNTIME_PROFILE",BuildConfig.ELIZA_RUNTIME_PROFILE);
  final long epoch;
  synchronized(lifecycleLock){launchedGeneration=null;if(!accepting||stopping||credentialMutationEpoch>=0)throw new java.io.IOException("Local provider is retiring");epoch=lifecycleEpoch;}
  configureNativeViews(context.getAssets().open("agent/native-view-declarations.json"),env);
  for(String key:new String[]{"ELIZA_NATIVE_GOOGLE_HOST_MODULE","ELIZA_NATIVE_GOOGLE_BINDING_JSON","ELIZA_MANAGED_GMAIL_READ_BROKER","ELIZA_MANAGED_GMAIL_SEND_BROKER","ELIZA_MANAGED_GMAIL_OPERATION_BROKER","ELIZA_MANAGED_CALENDAR_READ_BROKER","ELIZA_MANAGED_CALENDAR_DELETE_ENABLED","ELIZA_NATIVE_GOOGLE_GMAIL_SEND_ENABLED","ELIZA_MANAGED_GMAIL_MAILBOX_CHANGES_ENABLED"})env.remove(key);
  env.remove("ELIZA_MOBILE_WORKFLOWS");
  java.io.File nativeHostResources=null;
  java.io.InputStream workerIndex=null;
  try {workerIndex=context.getAssets().open("agent/workflow-worker/files.sha256");}
  catch(java.io.FileNotFoundException absent) { /* Older payloads do not contain a workflow worker. */ }
  if(workerIndex!=null){
   String root=env.get("AGENT_ROOT");if(root==null){workerIndex.close();throw new java.io.IOException("Agent resource directory unavailable");}
   java.io.File worker=WorkflowWorkerAssets.install(new java.io.File(root),workerIndex,path->context.getAssets().open("agent/workflow-worker/"+path));
   WorkflowWorkerAssets.configureEnvironment(worker,env);
   nativeHostResources=worker;
  }
  try {
  // Decision P-43: the resident always runs. With no provider slot it launches with no hosted
  // provider environment; upstream then reports no_provider for each turn.
  // An unreadable or malformed provider slot (or Cloud credential) never blocks the resident: it
  // launches unbound, exactly as for a provider that cannot be applied below.
  String saved=null,cloudSaved=null;JSONObject provider=null;
  try{
   saved=new AlphaCredentialStore(context).readCredentialSlot("local-agent-provider:v1");
   provider=saved==null?null:new JSONObject(saved);
   cloudSaved=provider!=null&&"elizacloud".equals(provider.optString("provider"))?new AlphaCredentialStore(context).readCredentialSlot("cloud:production"):null;
  }catch(Exception unreadable){saved=null;provider=null;cloudSaved=null;}
  if(provider!=null){
   // A stored provider whose Cloud sign-in is gone or expired cannot be applied; the resident still
   // launches, with no provider, under the no-provider generation (never attachable to a binding).
   java.util.Map<String,String> applied=new java.util.HashMap<>(env);
   try{applyProviderEnvironment(provider,cloudSaved,applied,System.currentTimeMillis());env.clear();env.putAll(applied);}
   catch(Exception unusable){provider=null;saved=null;cloudSaved=null;}
  }
  // No usable provider: every provider credential and selector is removed (applyUnboundEnvironment).
  if(provider==null)applyUnboundEnvironment(env);
  if(provider!=null&&"elizacloud".equals(provider.optString("provider"))&&nativeHostResources!=null){
   java.io.File google=new java.io.File(nativeHostResources,"google-host.mjs");
   if(google.isFile()){
    JSONObject binding=LocalAgentProviderAdmission.managedGoogleBinding(saved,cloudSaved,System.currentTimeMillis());
    if(binding!=null){
    JSONObject current=new AlphaCredentialStore(context).providerAdmissionSnapshot();
    if(!binding.getString("accountRef").equals(current.getString("accountRef"))||!binding.getString("sessionGeneration").equals(current.getString("sessionGeneration"))||!LocalAgentProviderAdmission.sameCloudCredential(cloudSaved,new AlphaCredentialStore(context).readCredentialSlot("cloud:production")))throw new SecurityException("Native Google provider changed");
    env.put("ELIZA_NATIVE_GOOGLE_HOST_MODULE",google.getCanonicalPath());
    env.put("ELIZA_NATIVE_GOOGLE_BINDING_JSON",binding.toString());
    }
   }
  }
  if(provider==null||!"elizacloud".equals(provider.optString("provider","cerebras")))configureLocalEmbeddings(new File(context.getApplicationInfo().nativeLibraryDir),context.getFilesDir(),env);
  env.put("ELIZA_DISABLE_PERSONAL_ASSISTANT","1");
  env.put("ELIZA_DISTRIBUTION_PROFILE","store");
  // A packaged app has no repository character file to discover above its workspace.
  env.put("ELIZA_DISABLE_LOCAL_CHARACTER","1");
  // Pseudonymize secrets and PII using the pinned upstream runtime.
  env.put("ELIZA_SECRET_SWAP_ENABLED","true");
  env.put("ELIZA_PII_SWAP_ENABLED","true");
  java.net.ServerSocket fixture=instrumentationRecoveryEndpoint;
  if(fixture!=null){
   if(!BuildConfig.DEBUG||android.os.Process.myUid()/100000<=0||fixture.isClosed()
      ||!fixture.isBound()||!"127.0.0.1".equals(fixture.getInetAddress().getHostAddress())
      ||fixture.getLocalPort()<=0||provider==null||!"synthetic-resident-recovery-only".equals(provider.getString("key")))
    throw new java.io.IOException("Invalid resident recovery fixture endpoint");
   String endpoint="http://127.0.0.1:"+fixture.getLocalPort()+"/v1";
   env.put("CEREBRAS_BASE_URL",endpoint);env.put("OPENAI_BASE_URL",endpoint);
   env.put("OPENAI_API_KEY","synthetic-resident-recovery-only");env.put("ELIZA_PROVIDER","cerebras");
  }
  // Later surfaces attach only while the stored admission is the one this process launched with.
  synchronized(lifecycleLock){if(epoch!=lifecycleEpoch||!accepting||stopping||credentialMutationEpoch>=0)throw new java.io.IOException("Local provider changed");launchedGeneration=LocalAgentProviderAdmission.launchGeneration(saved,cloudSaved);}
  } catch(Exception error) {throw new java.io.IOException("Local model provider unavailable");}
 }
 /** Explicit Retry reissues strict teardown; an old failed acknowledgment never grants start. */
 private boolean retryCredentialShutdown(PluginCall call,String requestId) {
  final long retryEpoch,retryIntent;
  synchronized(lifecycleLock){
   if(credentialShutdownRetryEpoch>=0){call.reject("Provider shutdown is already being checked; wait before retrying.");return true;}
   if(credentialShutdownRequest==-1||credentialShutdownRequest>=0&&ElizaAgentService.isCredentialShutdownConfirmed(credentialShutdownRequest))return false;
   if(disposed||getActivity()==null||!getActivity().hasWindowFocus()){call.reject("Return to the app before retrying provider shutdown.");return true;}
   if(credentialMutationEpoch>=0){call.reject("Provider shutdown is already being checked; wait before retrying.");return true;}
   if(requestId!=null&&cancelledStarts.remove(requestId)){call.reject("Local startup cancelled");return true;}
   retryIntent=credentialIntentEpoch;invalidateCalls();retryEpoch=++lifecycleEpoch;credentialShutdownRetryEpoch=retryEpoch;
   accepting=false;stopping=true;clearEnrollment();pending.add(call);
   startRequestId=requestId;startRequestEpoch=retryEpoch;startOwnsLaunch=false;
  }
  PluginWorkers.submit(workers,()->{
   try{
    final long stopRequest;
    synchronized(lifecycleLock){
     requireShutdownRetry(call,retryEpoch,retryIntent);
     credentialShutdownRequest=-2;
     stopRequest=ElizaAgentService.stopForCredentialChange(getContext());
     credentialShutdownRequest=stopRequest;
    }
    ResidentCredentialShutdownRetry.await(
     ()->{synchronized(lifecycleLock){requireShutdownRetry(call,retryEpoch,retryIntent);}},
     ()->ElizaAgentService.isCredentialShutdownConfirmed(stopRequest),
     ()->shutdownConfirmed(ElizaAgentService.getLocalAgentBootState(getContext())),
     android.os.SystemClock::elapsedRealtime,Thread::sleep,15000);
    synchronized(lifecycleLock){
     requireShutdownRetry(call,retryEpoch,retryIntent);
     if(credentialShutdownRequest!=stopRequest||!ElizaAgentService.isCredentialShutdownConfirmed(stopRequest))throw new Superseded();
     credentialShutdownRequest=-1;credentialShutdownRetryEpoch=-1;stopping=false;accepting=true;pending.remove(call);
    }
    // Exact continuation epoch rejects cancellation/account changes between acknowledgment and start.
    startAfterShutdown(call,retryEpoch,retryIntent);
   }catch(Exception unconfirmed){
    if(unconfirmed instanceof InterruptedException)Thread.currentThread().interrupt();
    synchronized(lifecycleLock){
     if(credentialShutdownRetryEpoch==retryEpoch)credentialShutdownRetryEpoch=-1;
     if(pending.remove(call))call.reject("Provider shutdown is unconfirmed; check the local agent before starting.");
    }
   }
  },()->{synchronized(lifecycleLock){if(credentialShutdownRetryEpoch==retryEpoch)credentialShutdownRetryEpoch=-1;if(pending.remove(call))call.reject("Local agent bridge is closed.");}});
  return true;
 }
 /** Caller holds lifecycleLock. Never lets focus loss or another intent authorize this retry. */
 private void requireShutdownRetry(PluginCall call,long epoch,long intent)throws Superseded {
  if(disposed||intent!=credentialIntentEpoch||epoch!=lifecycleEpoch||credentialShutdownRetryEpoch!=epoch||credentialMutationEpoch>=0||!pending.contains(call)
    ||getActivity()==null||!getActivity().hasWindowFocus())throw new Superseded();
 }
 @PluginMethod public void start(PluginCall call) {
  String requestId=call.getString("requestId");
  if(requestId!=null&&!requestId.matches("[a-f0-9-]{36}")){call.reject("Invalid startup request");return;}
  if(retryCredentialShutdown(call,requestId))return;
  startAfterShutdown(call,-1,-1);
 }
 private void startAfterShutdown(PluginCall call,long continuationEpoch,long continuationIntent) {
  String requestId=call.getString("requestId");
  if(requestId!=null&&!requestId.matches("[a-f0-9-]{36}")){call.reject("Invalid startup request");return;}
  try {
   if(!runtimePackaged()){call.reject("On-device agent is unavailable in this version.");return;}
   // No provider is required: without an admitted Eliza Cloud plan the agent runs unbound.
   final AlphaCredentialStore providerStore=new AlphaCredentialStore(getContext());
   // Hosted inference is distinct from an on-device language-model payload.
   getContext().getSharedPreferences("CapacitorStorage",Context.MODE_PRIVATE).edit().putString("eliza:mobile-runtime-mode","cloud-hybrid").apply();
   final long epoch;
   long admitted=-1;
   boolean attached=false;
   for(int attempt=0;attempt<3;attempt++){
    final long observedEpoch;
    synchronized(lifecycleLock){
     if(continuationEpoch>=0&&(continuationEpoch!=lifecycleEpoch||continuationIntent!=credentialIntentEpoch)){call.reject("Local agent connection changed; retry from the app.");return;}
     if(continuationEpoch>=0&&(disposed||getActivity()==null||!getActivity().hasWindowFocus())){call.reject("Return to the app before starting.");return;}
     if(requestId!=null&&cancelledStarts.remove(requestId)){call.reject("Local startup cancelled");return;}
     if(cancelledStarts.size()>=128){call.reject("Startup cancellation capacity reached; reopen the app.");return;}
     observedEpoch=lifecycleEpoch;
    }
    JSONObject nativeState=ElizaAgentService.getLocalAgentBootState(getContext());
    // Read-only observations for attach admission; a concurrent lifecycle change retries the loop.
    String currentGeneration=storedProviderGeneration(providerStore),currentRoot=ElizaAgentService.localAgentToken();
    synchronized(lifecycleLock){
     if(requestId!=null&&cancelledStarts.remove(requestId)){call.reject("Local startup cancelled");return;}
     if(observedEpoch!=lifecycleEpoch||continuationEpoch>=0&&continuationIntent!=credentialIntentEpoch){if(continuationEpoch>=0){call.reject("Local agent connection changed; retry from the app.");return;}continue;}
     if(continuationEpoch>=0&&(getActivity()==null||!getActivity().hasWindowFocus())){call.reject("Return to the app before starting.");return;}
     if(disposed){call.reject("Local agent bridge is closed.");return;}
     if(credentialMutationEpoch>=0){call.reject("Local provider is changing; wait before starting.");return;}
     if(credentialShutdownRequest!=-1&&(credentialShutdownRequest<0||!ElizaAgentService.isCredentialShutdownConfirmed(credentialShutdownRequest))){call.reject("Provider shutdown is unconfirmed; check the local agent before starting.");return;}
     if(stopping&&shutdownConfirmed(nativeState))stopping=false;
     if(stopping){call.reject("Local agent is stopping; wait for stopped status before starting.");return;}
     // An admitted running resident is attached to, never restarted: another surface's work,
     // the runtime epoch, the owner enrollment and the launch owner all stay as they are.
     if(attachLocked(nativeState,currentRoot,currentGeneration)==null){admitted=lifecycleEpoch;attached=true;attachedStarts.add(requestId);pending.add(call);break;}
     attachUnverified=false;
     invalidateCalls();admitted=++lifecycleEpoch;credentialShutdownRequest=-1;accepting=true;clearEnrollment();pending.add(call);
     startRequestId=requestId;startRequestEpoch=admitted;startOwnsLaunch=shutdownConfirmed(nativeState);
     ElizaAgentService.start(getContext());break;
    }
   }
   if(admitted<0){call.reject("Local agent connection changed; check status before starting again.");return;}
   epoch=admitted;
   if(attached){
    PluginWorkers.submit(workers,()->{
     try{
      String root=ElizaAgentService.localAgentToken();if(root==null||root.isEmpty())throw new IllegalStateException();
      authenticatedStatus(epoch,root);
      // Attach never pairs: the enrollment it was admitted against must still be the current one.
      synchronized(lifecycleLock){requireCurrent(epoch);if(!root.equals(rootToken)||ownerToken==null)throw new IllegalStateException();}
      resolveCurrent(call,epoch,new JSObject().put("state","ready").put("attached",true));
     }
     catch(Superseded stale){rejectSuperseded(call);}
     catch(Exception unverified){synchronized(lifecycleLock){attachUnverified=true;}rejectPending(call,"The running local agent did not answer. Start again to restart it; no chat was sent.");}
    },()->rejectPending(call,"Local agent bridge is closed."));
    return;
   }
   PluginWorkers.submit(workers,()->{
    long deadline=android.os.SystemClock.elapsedRealtime()+90000;
    boolean ready=false;
    while(android.os.SystemClock.elapsedRealtime()<deadline){
     try{if(rejectStartupRefusal(call,epoch,ElizaAgentService.getLocalAgentBootState(getContext())))return;String root=ElizaAgentService.localAgentToken();if(root==null||root.isEmpty())throw new IllegalStateException();authenticatedStatus(epoch,root);ready=true;break;}
     catch(Superseded stale){rejectSuperseded(call);return;}
     catch(Exception unavailable){try{Thread.sleep(1000);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();break;}}
    }
    if(ready){
     // Never poll enrollment: a failed response may follow a committed pairing POST.
     try{enroll(epoch);resolveCurrent(call,epoch,new JSObject().put("state","ready"));return;}
     catch(Superseded stale){rejectSuperseded(call);return;}
     catch(Exception uncertain){rejectPending(call,"Local enrollment did not complete. Check runtime status before reconnecting.");return;}
    }
    rejectPending(call,"Local agent startup did not complete. Check runtime status; no chat was sent.");
   },()->rejectPending(call,"Local agent bridge is closed."));
  }catch(Exception error){synchronized(lifecycleLock){pending.remove(call);}call.reject("The on-device agent could not start. Try again or connect another agent.");}
 }
 /** Only the current startup caller may retire a launch it created; reused services are never stopped here. */
 @PluginMethod public void cancelStart(PluginCall call) {
  String requestId=call.getString("requestId","");
  if(!requestId.matches("[a-f0-9-]{36}")){call.reject("Invalid startup request");return;}
  synchronized(lifecycleLock){
   // A start that attached owns no launch: its cancellation retires nothing.
   if(attachedStarts.remove(requestId)){call.resolve();return;}
   if(requestId.equals(startRequestId)&&startRequestEpoch==lifecycleEpoch){
    boolean stopOwned=startOwnsLaunch;
    startRequestId=null;startOwnsLaunch=false;
    invalidateCalls();++lifecycleEpoch;clearEnrollment();
    if(stopOwned){
     accepting=false;stopping=true;
     try{ElizaAgentService.stop(getContext());}
     catch(Exception uncertain){call.reject("Owned startup cancellation requested; check shutdown status.");return;}
    }
   }else if(cancelledStarts.size()<128)cancelledStarts.add(requestId);
   else {call.reject("Startup cancellation capacity reached; reopen the app.");return;}
   call.resolve();
  }
 }
 static String startupRefusalMessage(String reason){
  if("ipc-recovery-retention-limit".equals(reason))return "Your agent needs recovery review. Your records were kept. Restarting will not fix this; do not clear app data.";
  if("ipc-recovery-required".equals(reason))return "Your agent needs recovery review. Your records were kept. Do not clear app data or rerun unfinished work.";
  if("runtime-identity-unavailable".equals(reason))return "Local startup could not verify its runtime files. Your records were preserved. Check the installed runtime before reconnecting.";
  return null;
 }
 private boolean rejectStartupRefusal(PluginCall call,long epoch,JSONObject status) throws Superseded {
  String reason=status.optString("reason");
  String message=startupRefusalMessage(reason);
  if(message==null)return false;
  synchronized(lifecycleLock){requireCurrent(epoch);if(pending.remove(call))call.reject(message,reason);return true;}
 }
 private static boolean shutdownConfirmed(JSONObject status){
  return status!=null&&"dead".equals(status.optString("state"))&&!status.optBoolean("serviceActive",true)&&!status.optBoolean("socketListening",true);
 }
 /** Finite, foreground recovery review; all file ownership and archival remain service-owned. */
 @PluginMethod public void reviewRecovery(PluginCall call){ipcRecovery(call,false);}
 @PluginMethod public void archiveRecovery(PluginCall call){ipcRecovery(call,true);}
 private void ipcRecovery(PluginCall call,boolean archive){
  final String token=archive?call.getString("reviewToken",""):null;
  if(archive&&(token==null||!token.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"))){call.reject("Review recovery again before continuing.");return;}
  final long epoch,intent;
  synchronized(lifecycleLock){
   if(!archive)recoveryReview.clear();
   if(disposed||getActivity()==null||!getActivity().hasWindowFocus()||stopping||credentialMutationEpoch>=0||credentialShutdownRequest!=-1){recoveryReview.clear();call.reject("Recovery is unavailable right now. Your records were kept.");return;}
   epoch=lifecycleEpoch;intent=credentialIntentEpoch;pending.add(call);
  }
  PluginWorkers.submit(workers,()->{
   try{
    // SDK processLock is acquired before this authority takes lifecycleLock, matching startup.
    ElizaAgentService.RecoveryAuthority authority=operation->{synchronized(lifecycleLock){
     if(disposed||epoch!=lifecycleEpoch||intent!=credentialIntentEpoch||!pending.contains(call)||getActivity()==null||!getActivity().hasWindowFocus()||stopping||credentialMutationEpoch>=0||credentialShutdownRequest!=-1){
      recoveryReview.clear();return new JSONObject().put("status","unavailable").put("reason","active-owner").put("retainedCount",0).put("archivedCount",0);
     }
     if(archive&&!recoveryReview.consume(token,lifecycleEpoch,credentialIntentEpoch))return new JSONObject().put("status","unavailable").put("reason","records-changed").put("retainedCount",0).put("archivedCount",0);
     JSONObject result=operation.run();
     if(!archive&&"reviewable".equals(result.optString("status")))recoveryReview.bind(result.getString("reviewToken"),lifecycleEpoch,credentialIntentEpoch);
     return result;
    }};
    JSONObject result=archive?ElizaAgentService.archiveIpcRecovery(token,authority):ElizaAgentService.reviewIpcRecovery(authority);
    synchronized(lifecycleLock){if(archive)recoveryReview.clear();if(pending.remove(call))call.resolve(new JSObject(result.toString()));}
   }catch(Exception error){synchronized(lifecycleLock){recoveryReview.clear();}rejectPending(call,"Recovery could not be confirmed. Your records were kept. Review again before restarting.");}
  },()->rejectPending(call,"Recovery is unavailable right now. Your records were kept."));
 }
 @PluginMethod public void getStatus(PluginCall call) {
  try{
   boolean packaged=runtimePackaged();
   for(int attempt=0;attempt<3;attempt++){
    final long observedEpoch;
    synchronized(lifecycleLock){observedEpoch=lifecycleEpoch;}
    // Native socket observation must never delay stop's epoch invalidation.
    JSObject status=new JSObject(ElizaAgentService.getLocalAgentBootState(getContext()).toString());
    synchronized(lifecycleLock){
     if(observedEpoch!=lifecycleEpoch)continue;
     if(stopping||!accepting){
      boolean stopped=shutdownConfirmed(status)&&(credentialShutdownRequest==-1||credentialShutdownRequest>=0&&ElizaAgentService.isCredentialShutdownConfirmed(credentialShutdownRequest));
      if(stopped)stopping=false;
      status.put("state",stopped?"stopped":"stopping");
     }
     status.put("packaged",packaged);call.resolve(status);return;
    }
   }
   call.reject("Local runtime changed while checking status; check again.");
  }catch(Exception error){call.reject("Local runtime status unavailable.");}
 }
 @PluginMethod public void stop(PluginCall call) {
  synchronized(lifecycleLock){
   startRequestId=null;startOwnsLaunch=false;
   invalidateCalls();++lifecycleEpoch;accepting=false;stopping=true;clearEnrollment();
   try{ElizaAgentService.stop(getContext());call.resolve(new JSObject().put("state","stopping"));}
   catch(Exception unavailable){call.reject("Stop requested locally, but native shutdown could not be confirmed. Check runtime status.");}
  }
 }
 /** Native speech uses only the existing enrollment, bound to its exact token and runtime epoch. */
 static NativeLiveVoicePipe.Transport openNativeVoiceTransport(String expectedOwner)throws Exception{
  final String root,token,owner;final long epoch;
  synchronized(lifecycleLock){
   captureResultSession(expectedOwner);root=rootToken;token=ownerToken;owner=ownerIdentity;epoch=lifecycleEpoch;
  }
  final NativeVoiceBinding binding=new NativeVoiceBinding(epoch,root,token,owner);
  final java.util.concurrent.atomic.AtomicBoolean cancelled=new java.util.concurrent.atomic.AtomicBoolean();
  final java.util.concurrent.atomic.AtomicReference<NativeVoiceIpc.Handle> active=new java.util.concurrent.atomic.AtomicReference<>();
  class VoiceHandle implements NativeVoiceIpc.Handle {final ElizaAgentService.LocalStreamHandle handle=new ElizaAgentService.LocalStreamHandle();public void cancel(){handle.cancel();}}
  final NativeVoiceIpc.Port port=new NativeVoiceIpc.Port(){
   public NativeVoiceIpc.Handle open(){return new VoiceHandle();}
   public void request(JSONObject input,java.util.function.Consumer<String> events,NativeVoiceIpc.Handle handle){ElizaAgentService.requestLocalAgentStream(input.toString(),events,((VoiceHandle)handle).handle);}
  };
  return new NativeLiveVoicePipe.Transport(){
   public void check()throws Exception{synchronized(lifecycleLock){
    if(!binding.current(lifecycleEpoch,rootToken,ownerToken,ownerIdentity,ElizaAgentService.localAgentToken(),expiresAt,System.currentTimeMillis(),accepting&&!stopping))throw new SecurityException("Voice enrollment changed");
   }}
   public void cancelInFlight(){cancelled.set(true);NativeVoiceIpc.Handle handle=active.get();if(handle!=null)handle.cancel();}
   public JSONObject post(JSONObject body)throws Exception{
    JSONObject headers=new JSONObject().put("Authorization","Bearer "+routeToken("/api/asr/local-inference/live",token)).put("Content-Type","application/json").put("Accept","application/json");
    JSONObject input=new JSONObject().put("path","/api/asr/local-inference/live").put("method","POST").put("body",body.toString()).put("headers",headers).put("timeoutMs",8000);
    return NativeVoiceIpc.exchange(port,input,active,()->{check();if(cancelled.get()&&!body.optBoolean("close"))throw new IllegalStateException("Voice capture cancelled");},8000);
   }
  };
 }
 // Native callers may bind background result reads to an existing enrollment.
 // This is deliberately not a Capacitor method and never initiates pairing.
 static JSONObject captureResultSession(String expectedOwner) throws Exception {
  synchronized(lifecycleLock){
   String currentRoot=ElizaAgentService.localAgentToken();
   if(!accepting||stopping||rootToken==null||!rootToken.equals(currentRoot)||
      ownerIdentity==null||!ownerIdentity.equals(expectedOwner)||ownerToken==null||
      expiresAt<=System.currentTimeMillis()+30000)throw new SecurityException("Reconnect the local agent before binding results");
   return ResidentResultSession.snapshot(ownerIdentity,ownerToken,expiresAt,currentRoot);
  }
 }
 /** Native-only read of the already enrolled machine session. Never calls enroll or setup. */
 static JSONObject captureReminderOwnerSession()throws Exception{
  synchronized(lifecycleLock){return captureResultSession(ownerIdentity);}
 }
 static JSONObject readReminderOwnerRoute(JSONObject expected,String path,JSONObject deviceHeaders)throws Exception{
  if(!java.util.Arrays.asList("/api/auth/me","/api/agents","/api/client-devices/context").contains(path))throw new SecurityException("Native owner route unavailable");
  JSONObject before=captureReminderOwnerSession();
  if(!before.toString().equals(expected.toString()))throw new SecurityException("Native owner session changed");
  JSONObject result=raw(path,"GET",null,expected.getString("token"),deviceHeaders,3000);
  if(!captureReminderOwnerSession().toString().equals(expected.toString()))throw new SecurityException("Native owner session changed");
  return result;
 }
 /** The local ASR routes accept only the resident's per-boot bearer, not the owner session; callers have already admitted the owner. */
 static String routeToken(String path,String session){return path.startsWith("/api/asr/local-inference/")?ElizaAgentService.localAgentToken():session;}
 private static JSONObject raw(String path,String method,String body,String token,JSONObject supplied,int timeoutMs) throws Exception {
  JSONObject headers=new JSONObject();headers.put("Accept","application/json");headers.put("Content-Type","application/json");
  if(token!=null)headers.put("Authorization","Bearer "+routeToken(path,token));
  if(supplied!=null)for(String key:new String[]{"X-Eliza-Device-Id","X-Eliza-Device-Key","X-Eliza-Device-Capabilities"}){
   if(supplied.has(key)){String value=supplied.getString(key);if(value.length()>2048||value.contains("\r")||value.contains("\n"))throw new IllegalArgumentException();headers.put(key,value);}
  }
  JSONObject input=new JSONObject().put("path",path).put("method",method).put("headers",headers).put("timeoutMs",timeoutMs);
  if(body!=null)input.put("body",body);
  return new JSONObject(ElizaAgentService.requestLocalAgent(input.toString()));
 }
 private static JSONObject json(String path,String method,JSONObject body,String token) throws Exception {
  JSONObject response=raw(path,method,body==null?null:body.toString(),token,null,120000);
  if(response.getInt("status")!=200)throw new IllegalStateException("Local enrollment unavailable");
  return new JSONObject(response.getString("body"));
 }
 private void requireEnrollmentRoot(long epoch,String root) throws Exception {
  requireCurrent(epoch);
  if(root==null||root.isEmpty()||!root.equals(ElizaAgentService.localAgentToken()))throw new IllegalStateException("Local runtime token changed");
 }
 private JSONObject enrollmentJson(long epoch,String path,String method,JSONObject body,String token,String root) throws Exception {
  requireEnrollmentRoot(epoch,root);
  // Admission precedes dispatch. In-flight native requests are not claimed cancelled.
  JSONObject result=json(path,method,body,token);requireEnrollmentRoot(epoch,root);return result;
 }
 private JSONObject authenticatedStatus(long epoch,String root) throws Exception {
  JSONObject status=enrollmentJson(epoch,"/api/auth/status","GET",null,root,root);
  if(!Boolean.TRUE.equals(status.opt("authenticated")))throw new IllegalStateException("Local runtime token not authenticated");
  if(status.getString("instanceId").isEmpty())throw new IllegalStateException("Local runtime instance unavailable");
  return status;
 }
 private String enroll(long epoch) throws Exception {
  synchronized(enrollmentLock){
  requireCurrent(epoch);
  String root=ElizaAgentService.localAgentToken();
  if(root==null||root.isEmpty())throw new IllegalStateException();
  synchronized(lifecycleLock){requireEnrollmentRoot(epoch,root);if(root.equals(rootToken)&&ownerToken!=null&&expiresAt>System.currentTimeMillis()+30000)return ownerToken;}
  JSONObject status=authenticatedStatus(epoch,root);
  JSONObject code=enrollmentJson(epoch,"/api/auth/pair-code","GET",null,root,root);
  JSONObject paired=enrollmentJson(epoch,"/api/auth/pair","POST",new JSONObject().put("code",code.getString("code")).put("instanceId",status.getString("instanceId")),root,root);
  if(!"owner".equals(paired.getString("access"))||!status.getString("instanceId").equals(paired.getString("instanceId")))throw new IllegalStateException();
  String token=paired.getString("token");JSONObject who=enrollmentJson(epoch,"/api/auth/me","GET",null,token,root);
  if(!"OWNER".equals(who.getJSONObject("access").getString("role"))||!paired.getString("identityId").equals(who.getJSONObject("identity").getString("id"))||!token.equals(who.getJSONObject("session").getString("id")))throw new IllegalStateException();
  long expiry=who.getJSONObject("session").getLong("expiresAt");if(expiry<=System.currentTimeMillis())throw new IllegalStateException();
  synchronized(lifecycleLock){requireEnrollmentRoot(epoch,root);rootToken=root;ownerToken=token;ownerIdentity=paired.getString("identityId");expiresAt=expiry;return token;}
  }
 }
 static boolean calendarApprovalReadAllowed(String path,String method,String owner){return "/api/approvals?state=all&limit=500".equals(path)&&"GET".equals(method)&&owner!=null&&!owner.trim().isEmpty();}
 @PluginMethod public void request(PluginCall call) {
  String path=call.getString("path",""),method=call.getString("method","GET"),body=call.getString("body"),expectedOwner=call.getString("ownerId");
  boolean automation=AutomationsRoutes.owns(path),approvalRead=calendarApprovalReadAllowed(path,method,expectedOwner);
  if((automation? !AutomationsRoutes.allowed(path,method)||expectedOwner==null||expectedOwner.trim().isEmpty(): ((path.startsWith("/api/views/")||path.endsWith("/messages/truncate")||path.endsWith("/heard"))&&(!method.equals("POST")||expectedOwner==null||expectedOwner.trim().isEmpty()))||(path.equals("/api/asr/local-inference/end-of-turn")&&!method.equals("POST"))||(path.contains("?before=")&&!method.equals("GET"))||(path.startsWith("/api/turns/")&&!method.equals("POST"))||path.contains("..")||path.contains("%")||path.contains("\\")||(!approvalRead&&!path.matches("^/api/(auth/me|agents|status|conversations(/[A-Za-z0-9_-]+(/messages(/truncate|/[0-9a-fA-F-]{36}/heard|\\?before=[0-9]{1,16}(&beforeId=[0-9a-fA-F-]{36})?(&limit=[0-9]{1,3})?)?)?)?|turns/[0-9a-fA-F-]{36}/abort|views/interact-(claim|result)|client-devices/[A-Za-z0-9_/-]+|workflow(/[A-Za-z0-9_/?=&-]+)?|asr/local-inference/(live(/status)?|end-of-turn))$"))||!(method.equals("GET")||method.equals("POST")))||((method.equals("GET")||method.equals("DELETE"))&&body!=null)||(body!=null&&body.length()>2*1024*1024)){
   call.reject("Unsupported local agent request.");return;
  }
  JSONObject headers=call.getObject("headers");
  final long epoch;
  try{synchronized(lifecycleLock){epoch=admittedEpoch();pending.add(call);}}catch(Superseded stale){call.reject("Local agent is stopped or unavailable.","LOCAL_AGENT_EPOCH_CHANGED");return;}
  PluginWorkers.submit(workers,()->{try{
   requireOwned(call,epoch);
   String token=enroll(epoch);
   synchronized(lifecycleLock){requireCurrent(epoch);if(expectedOwner!=null&&!expectedOwner.equals(ownerIdentity)){resolveCurrent(call,epoch,new JSObject().put("status",409).put("body","{\"error\":\"Local owner changed; reconnect before continuing\"}"));return;}}
   requireOwned(call,epoch);
   JSONObject result=raw(path,method,body,token,headers,120000);
   requireCurrent(epoch);
   if(result.getInt("status")==401)synchronized(lifecycleLock){requireCurrent(epoch);clearEnrollment();}
   if(path.equals("/api/auth/me")&&result.getInt("status")==200){JSONObject who=new JSONObject(result.getString("body"));who.getJSONObject("session").put("id","native-owned-session");result.put("body",who.toString());result.remove("bodyBase64");}
   resolveCurrent(call,epoch,new JSObject(result.toString()));
  }catch(Superseded stale){rejectSuperseded(call);}
  catch(Exception error){rejectPending(call,"Local agent request failed. No automatic retry was made.");}},()->{rejectPending(call,"Local agent bridge is closed.");});
 }
 /** Cancellation acknowledges transport closure, never server-effect cancellation. */
 @PluginMethod public void cancelStream(PluginCall call) {
  String id=call.getString("streamId","");
  synchronized(lifecycleLock){var handle=streams.remove(id);streamInvalidators.remove(id);if(handle!=null)handle.cancel();}
  call.resolve(new JSObject().put("transportClosed",true).put("outcome","unknown"));
 }
 @PluginMethod public void requestStream(PluginCall call) {
  String id=call.getString("streamId",""),path=call.getString("path",""),owner=call.getString("ownerId",""),body=call.getString("body","");
  if(!id.matches("[A-Za-z0-9-]{16,64}")||!path.matches("^/api/conversations/[A-Za-z0-9_-]+/messages/stream$")||owner.isEmpty()||body.isEmpty()||body.length()>2*1024*1024){call.reject("Unsupported local stream.");return;}
  final long epoch;final var handle=new ElizaAgentService.LocalStreamHandle();
  try{synchronized(lifecycleLock){epoch=admittedEpoch();if(streams.size()>=2||streams.containsKey(id))throw new IllegalStateException();streams.put(id,handle);streamInvalidators.put(id,()->notifyListeners("alphaAgentStream",new JSObject().put("streamId",id).put("event",new JSObject().put("type","complete").put("error","Local connection changed. Outcome unknown; check history before retrying."))));}}
  catch(Exception unavailable){call.reject("Local stream unavailable.");return;}
  final JSONObject supplied=call.getObject("headers");
  call.resolve(new JSObject().put("streamId",id));
  PluginWorkers.submit(workers,()->{try{
   String token=enroll(epoch);JSONObject headers=new JSONObject().put("Authorization","Bearer "+token).put("Accept","text/event-stream").put("Content-Type","application/json");
   if(supplied!=null)for(String key:new String[]{"X-Eliza-Device-Id","X-Eliza-Device-Key","X-Eliza-Device-Capabilities"})if(supplied.has(key)){String value=supplied.getString(key);if(value.length()>2048||value.contains("\r")||value.contains("\n"))throw new IllegalArgumentException();headers.put(key,value);}
   synchronized(lifecycleLock){requireCurrent(epoch);if(!owner.equals(ownerIdentity)||streams.get(id)!=handle)throw new Superseded();}
   JSONObject input=new JSONObject().put("path",path).put("method","POST").put("body",body).put("headers",headers).put("timeoutMs",120000);
   ElizaAgentService.requestLocalAgentStream(input.toString(),event->{synchronized(lifecycleLock){try{requireCurrent(epoch);if(streams.get(id)!=handle)return;JSONObject value=new JSONObject(event);if("response".equals(value.optString("type"))&&value.optInt("status")==401)clearEnrollment();notifyListeners("alphaAgentStream",new JSObject().put("streamId",id).put("event",value));}catch(Exception ignored){}}},handle);
  }catch(Exception error){synchronized(lifecycleLock){if(streams.get(id)==handle)notifyListeners("alphaAgentStream",new JSObject().put("streamId",id).put("event",new JSObject().put("type","complete").put("error","Stream interrupted. Outcome unknown; check history before retrying.")));}}
  finally{synchronized(lifecycleLock){if(streams.get(id)==handle){streams.remove(id);streamInvalidators.remove(id);}handle.cancel();}}},()->{synchronized(lifecycleLock){streams.remove(id);streamInvalidators.remove(id);handle.cancel();}notifyListeners("alphaAgentStream",new JSObject().put("streamId",id).put("event",new JSObject().put("type","complete").put("error","Stream unavailable.")));});
 }
 /** A single ephemeral voice-only feed per surface. Never expose the root credential or
  * general agent events to the renderer. Uses its own bounded worker so an open feed cannot
  * occupy a request worker needed by ASR or cancellation. Lifecycle invalidation owns its socket. */
 @PluginMethod public void subscribeVoiceEvents(PluginCall call) {
  String id=call.getString("subscriptionId",""),owner=call.getString("ownerId","");
  if(!id.matches("[A-Za-z0-9-]{16,64}")||owner.isEmpty()){call.reject("Invalid voice subscription.");return;}
  String key="voice-"+id;final long epoch;final var handle=new ElizaAgentService.LocalStreamHandle();
  try{synchronized(lifecycleLock){epoch=admittedEpoch();if(streams.keySet().stream().anyMatch(value->value.startsWith("voice-")))throw new IllegalStateException();streams.put(key,handle);streamInvalidators.put(key,()->notifyListeners("alphaVoiceEvent",new JSObject().put("subscriptionId",id).put("type","end")));}}
  catch(Exception unavailable){call.reject("Voice subscription unavailable.");return;}
  call.resolve(new JSObject().put("subscriptionId",id));
  PluginWorkers.submit(voiceWorkers,()->{try{
   enroll(epoch);final String admittedRoot;
   synchronized(lifecycleLock){requireCurrent(epoch);admittedRoot=rootToken;if(!VoiceEventAdmission.current(admittedRoot,rootToken,ElizaAgentService.localAgentToken(),owner,ownerIdentity,expiresAt,System.currentTimeMillis())||streams.get(key)!=handle)throw new Superseded();}
   JSONObject input=new JSONObject().put("streams",new org.json.JSONArray().put("voice-transcript"));
   ElizaAgentService.subscribeLocalAgentEvents(input.toString(),event->{synchronized(lifecycleLock){try{
    requireCurrent(epoch);if(streams.get(key)!=handle)return;
    if(!VoiceEventAdmission.current(admittedRoot,rootToken,ElizaAgentService.localAgentToken(),owner,ownerIdentity,expiresAt,System.currentTimeMillis())){handle.cancel();return;}
    JSONObject value=new JSONObject(event);
    if(!"event".equals(value.optString("type")))return;
    JSONObject envelope=value.optJSONObject("event");if(envelope==null||!"agent_event".equals(envelope.optString("type"))||!"voice-transcript".equals(envelope.optString("stream")))return;
    notifyListeners("alphaVoiceEvent",new JSObject().put("subscriptionId",id).put("type","event").put("event",envelope));
   }catch(Exception ignored){handle.cancel();}}},handle);
  }catch(Exception unavailable){/* Final HTTP transcripts remain available if the optional feed fails. */}
  finally{synchronized(lifecycleLock){if(streams.get(key)==handle){streams.remove(key);streamInvalidators.remove(key);notifyListeners("alphaVoiceEvent",new JSObject().put("subscriptionId",id).put("type","end"));}handle.cancel();}}},()->{synchronized(lifecycleLock){if(streams.get(key)==handle){streams.remove(key);streamInvalidators.remove(key);notifyListeners("alphaVoiceEvent",new JSObject().put("subscriptionId",id).put("type","end"));}handle.cancel();}});
 }
 @PluginMethod public void unsubscribeVoiceEvents(PluginCall call) {
  String key="voice-"+call.getString("subscriptionId","");
  synchronized(lifecycleLock){var handle=streams.remove(key);streamInvalidators.remove(key);if(handle!=null)handle.cancel();}
  call.resolve(new JSObject().put("closed",true));
 }
 /** Destroying one surface (for example closing the assistant) cancels only this instance's
  * calls and streams. The shared runtime, its epoch and the owner enrollment stay valid for
  * other surfaces. When the last surface goes away (the app is closed or recreated) the epoch
  * advances and the enrollment is cleared, as before; the next surface enrolls again. */
 @Override protected void handleOnDestroy(){synchronized(lifecycleLock){disposed=true;invalidateOwnCalls();instances.remove(this);if(instances.isEmpty()){++lifecycleEpoch;clearEnrollment();}}workers.shutdownNow();voiceWorkers.shutdownNow();super.handleOnDestroy();}
}
