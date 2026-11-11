package ai.alphacompute.alphaphone;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import ai.eliza.plugins.agent.runtime.CredentialIntentFence;
import ai.eliza.plugins.agent.runtime.CredentialRequestFence;
import ai.eliza.plugins.agent.runtime.NativeProviderSlot;
import ai.eliza.plugins.agent.runtime.ResidentAttachment;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** First-party local runtime bridge. Runtime and owner bearer tokens stay native. */
@CapacitorPlugin(name="Agent")
public final class AlphaLocalAgentPlugin extends Plugin {

/** Content-free classification of one failed attach. Never stores exception text. */
private static final class ResidentAttachDiagnostic {
  enum Stage { TOKEN, STATUS, ENROLLMENT }
  Stage stage = Stage.TOKEN;
  private int status;

  void response(int value) { status = value >= 100 && value <= 599 ? value : 0; }

  String failure(Throwable error) {
    String kind = error instanceof java.net.SocketTimeoutException ? "SocketTimeoutException"
      : error instanceof java.io.IOException ? "IOException"
      : error instanceof SecurityException ? "SecurityException"
      : error instanceof IllegalStateException ? "IllegalStateException"
      : error instanceof org.json.JSONException ? "JSONException" : "Exception";
    return "category=resident-attach method=GET stage=" + stage.name().toLowerCase(java.util.Locale.ROOT)
      + " status=" + status + " errorClass=" + kind;
  }
}

 private final ExecutorService workers=Executors.newFixedThreadPool(2);
 private final ExecutorService voiceWorkers=new java.util.concurrent.ThreadPoolExecutor(1,1,0L,java.util.concurrent.TimeUnit.MILLISECONDS,new java.util.concurrent.SynchronousQueue<>());
 private final ExecutorService rendererWorkers=new java.util.concurrent.ThreadPoolExecutor(1,1,0L,java.util.concurrent.TimeUnit.MILLISECONDS,new java.util.concurrent.SynchronousQueue<>());
 // Set only from in-process debug instrumentation; no route, intent or preference activation.
 static volatile java.net.ServerSocket instrumentationRecoveryEndpoint;
 private static String rootToken,ownerToken,ownerIdentity,notificationAgent;
 private static long expiresAt;
 private static final Object lifecycleLock=new Object(), enrollmentLock=new Object();
 private static long lifecycleEpoch;
 private static volatile long credentialMutationEpoch=-1;
 private static long credentialShutdownRequest=-1;
 private static long credentialShutdownRetryEpoch=-1;
 // The stop request of a commit that threw: its write may or may not have landed. Starts stay
 // fenced, and the owner's Start/Retry reissues strict teardown (retryCredentialShutdown).
 private static long uncertainCommitRequest=-1;
 private static String startRequestId;
 private static long startRequestEpoch;
 private static boolean startOwnsLaunch;
 /** Last-intent-wins credential fence (plugin-native-agent), guarded by the lifecycle lock. */
 private static final CredentialIntentFence credentialIntents=new CredentialIntentFence(lifecycleLock);
 private final CredentialRequestFence providerConfigurations=new CredentialRequestFence(lifecycleLock,credentialIntents);
 private static long powerAuthorizationMutationEpoch;
 private volatile long providerSurfaceGeneration;
 private volatile AutoCloseable providerReveal;
 private volatile String providerRevealRequestId;
 static long credentialAuthorityEpoch(){synchronized(lifecycleLock){return powerAuthorizationMutationEpoch;}}
 /** Compound credential-slot operations must enter before acquiring the vault lock. */
 static Object credentialLifecycleLock(){return lifecycleLock;}
 /** Revalidate an async operation against semantic credential changes, using the existing lock order. */
 static <T> T withCredentialAuthority(long owner,java.util.concurrent.Callable<T> action)throws Exception{
  synchronized(lifecycleLock){
   if(owner!=powerAuthorizationMutationEpoch)throw new SecurityException("Cloud authority changed");
   synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){return action.call();}
  }
 }
 /** Shared sign-in reads and delivery: the credential writers' lifecycle then vault lock order, never inside a mutation. */
 static <T> T withCredentialRead(java.util.concurrent.Callable<T> read)throws Exception{
  synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
   if(credentialMutationEpoch>=0)throw new IllegalStateException("Credential mutation in progress");
   return read.call();
  }}
 }
 /** Vault before lifecycle can deadlock against any writer; fail fast instead. */
 private static void requireLockOrder(){
  if(Thread.holdsLock(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK)&&!Thread.holdsLock(lifecycleLock))throw new IllegalStateException("lock order");
 }
 /** Noncritical slots share the canonical lock order without changing credential authority. */
 static <T> T withCredentialSlotMutation(Runnable guard,java.util.concurrent.Callable<T> commit)throws Exception{
  requireLockOrder();
  synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
   guard.run();return commit.call();
  }}
 }
 /** Native-only authorization mutation marker. Both locks are already held by credential commit. */
 static void powerAuthorizationChanged(){
  if(!Thread.holdsLock(lifecycleLock)||!Thread.holdsLock(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK))throw new IllegalStateException("Credential lock order required");
  powerAuthorizationMutationEpoch++;
  AlphaVoiceCloudPlugin.retireProviderAuthority();
  for(AlphaLocalAgentPlugin instance:new java.util.ArrayList<>(instances))instance.closeProviderReveal();
 }
 /** A protected launch constraint, never authority minted by stored account correlation alone. */
 static final class PowerLaunchPin implements ai.eliza.plugins.system.SenseListenerClient.PowerLaunchValidator {
  private final Context context;private final long mutation;private final String account,generation;
  private PowerLaunchPin(Context context,long mutation,JSONObject admitted)throws Exception{this.context=context.getApplicationContext();this.mutation=mutation;account=admitted.getString("accountRef");generation=admitted.getString("sessionGeneration");}
  public boolean isCurrent(){synchronized(lifecycleLock){
   if(mutation!=powerAuthorizationMutationEpoch||stopping||credentialMutationEpoch>=0||credentialShutdownRequest!=-1||context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED)return false;
   try{JSONObject now=new AlphaCredentialStore(context).providerAdmissionSnapshot();return "elizacloud".equals(now.optString("provider"))&&"production".equals(now.optString("environment"))&&account.equals(now.getString("accountRef"))&&generation.equals(now.getString("sessionGeneration"));}catch(Exception unavailable){return false;}
  }}
  public boolean authorize(String candidate,java.util.function.BooleanSupplier consume){synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
   // Native credential commit and grant issuance are one atomic authorization point. SDK
   // enters without its own locks; callback checks its current lease under app -> SDK order.
   return account.equals(candidate)&&isCurrent()&&consume.getAsBoolean();
  }}}
 }
 static PowerLaunchPin capturePowerLaunchPin(Context context){synchronized(lifecycleLock){
  if(stopping||credentialMutationEpoch>=0||credentialShutdownRequest!=-1||context.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED)return null;
  try{JSONObject admitted=new AlphaCredentialStore(context).providerAdmissionSnapshot();if(!"elizacloud".equals(admitted.optString("provider"))||!"production".equals(admitted.optString("environment")))return null;return new PowerLaunchPin(context,powerAuthorizationMutationEpoch,admitted);}catch(Exception unavailable){return null;}
 }}
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
 /** Plain requests the renderer can withdraw, by the id it chose. Guarded by lifecycleLock. */
 private final java.util.Map<String,PluginCall> withdrawable=new java.util.HashMap<>();
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
 /**
  * The native owner a cold listener wake is bound to (SenseListenerClient.admitOwner): the stored
  * provider admission generation, a random UUID or NO_PROVIDER_GENERATION and never a credential.
  * A Cloud account change between the wake and the renderer's first authenticated binding changes
  * it, so that wake only opens the assistant. Null when the stored admission is invalid.
  */
 static String invocationOwner(Context context){return INVOCATION_OWNER.get(()->readProviderOwner(new AlphaCredentialStore(context)),System.currentTimeMillis());}
 /** Cached invocationOwner: mutateCredentials invalidates it around every provider/Cloud commit, and it is read again once the Cloud credential's expiresAt passes. */
 private static final InvocationOwnerCache INVOCATION_OWNER=new InvocationOwnerCache();
 /** Stored provider admission generation; NO_PROVIDER_GENERATION when no provider is stored (the agent runs unbound and surfaces attach to it as to a bound one); null when legacy or no longer valid. Never writes. */
 private static String storedProviderGeneration(AlphaCredentialStore store){try{return readProviderOwner(store).value;}catch(Exception unavailable){return null;}}
 /** The stored generation and when it may stop holding with no write: an elizacloud generation fails once its credential's expiresAt passes (NativeProviderAdmission.cloudProviderToken). */
 private static InvocationOwnerCache.Owner readProviderOwner(AlphaCredentialStore store)throws Exception{
  String saved=store.readCredentialSlot("local-agent-provider:v1");if(saved==null)return new InvocationOwnerCache.Owner(LocalAgentProviderAdmission.NO_PROVIDER_GENERATION,Long.MAX_VALUE);
  String cloud="elizacloud".equals(new JSONObject(saved).optString("provider"))?store.readCredentialSlot("cloud:production"):null;
  long validUntil=Long.MAX_VALUE;
  if(cloud!=null){try{JSONObject credential=new JSONObject(cloud);if(credential.has("expiresAt"))validUntil=InvocationOwnerCache.deadline(credential.opt("expiresAt"));}catch(Exception unreadable){validUntil=Long.MIN_VALUE;}}
  return new InvocationOwnerCache.Owner(LocalAgentProviderAdmission.currentGeneration(saved,cloud),validUntil);
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
 // Owner, provider and account changes retire shade notices first (AlphaCanonicalNotifications.forget);
 // start, cancel, 401 and destroy keep the same owner, so its posted notices stay.
 private static void clearEnrollment(){AlphaCanonicalNotifications.suspendForRestart();rootToken=null;ownerToken=null;ownerIdentity=null;notificationAgent=null;expiresAt=0;}
 static long currentCredentialIntent(){return credentialIntents.current();}
 static long reserveCredentialIntent(){return credentialIntents.reserve();}
 /** Check bridge ownership under lifecycle admission before superseding another credential intent. */
 static long reserveCredentialIntent(Object ownerLock,Runnable assertOwner){
  synchronized(lifecycleLock){synchronized(ownerLock){assertOwner.run();return credentialIntents.reserve();}}
 }
 static void requireCredentialIntent(long intent){credentialIntents.require(intent);}
 interface CredentialMutation<T> {
  boolean requiresShutdown()throws Exception;
  T commit()throws Exception;
 }
 /** Slot classification/commit are atomic; observing shutdown must never hold the vault lock. */
 static <T> T mutateCredentials(Context context,Runnable assertOwner,CredentialMutation<T> mutation)throws Exception {
  requireLockOrder();
  final long epoch;
  synchronized(lifecycleLock){
   assertOwner.run();
   synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
    if(!mutation.requiresShutdown())return commitCredentials(mutation);
   }
   startRequestId=null;startOwnsLaunch=false;
   AlphaCanonicalNotifications.forget(context);
   invalidateCalls();epoch=++lifecycleEpoch;credentialMutationEpoch=epoch;accepting=false;stopping=true;clearEnrollment();
  }
  // The service's stop ACK proves absence but keeps starts fenced (CredentialShutdownLease). As the
  // shared CredentialMutationConductor does: a completed commit releases this exact request, a stop
  // with no commit attempt abandons it (released at its ACK), and an uncertain commit keeps it.
  long stopRequest=-1;boolean commitAttempted=false,commitFailed=false;
  try{
   synchronized(lifecycleLock){assertOwner.run();if(epoch!=lifecycleEpoch||credentialMutationEpoch!=epoch)throw new Superseded();credentialShutdownRequest=-2;stopRequest=ElizaAgentService.reserveCredentialShutdown();credentialShutdownRequest=stopRequest;ElizaAgentService.retryCredentialShutdown(context,stopRequest);}
   long deadline=android.os.SystemClock.elapsedRealtime()+15000;
   while(true){
    synchronized(lifecycleLock){assertOwner.run();if(epoch!=lifecycleEpoch||credentialMutationEpoch!=epoch)throw new Superseded();}
    JSONObject status=ElizaAgentService.getLocalAgentBootState(context);
    synchronized(lifecycleLock){
     assertOwner.run();if(epoch!=lifecycleEpoch||credentialMutationEpoch!=epoch)throw new Superseded();
     if(shutdownConfirmed(status)&&ElizaAgentService.isCredentialShutdownConfirmed(stopRequest)){
      synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){commitAttempted=true;return commitCredentials(mutation);}
     }
    }
    if(android.os.SystemClock.elapsedRealtime()>=deadline)throw new IllegalStateException("Native shutdown unconfirmed");
    Thread.sleep(50);
   }
  }catch(Throwable failure){
   // Only the commit follows commitAttempted. A failure after it may be a written slot or a refusal
   // before any write (a changed or expired credential); both keep the fence until the owner retries.
   commitFailed=commitAttempted;throw failure;
  }finally{
   synchronized(lifecycleLock){
    if(stopRequest>=0){
     if(!commitAttempted)ElizaAgentService.abandonCredentialShutdown(stopRequest);else if(!commitFailed)ElizaAgentService.releaseCredentialShutdown(stopRequest);
     // This request superseded any earlier uncertain one in the lease.
     uncertainCommitRequest=commitFailed?stopRequest:-1;
    }
    if(credentialMutationEpoch==epoch)credentialMutationEpoch=-1;
   }
  }
 }
 /** Every provider and Cloud credential write commits here; the cached listener owner never outlives one. */
 private static <T> T commitCredentials(CredentialMutation<T> mutation)throws Exception{INVOCATION_OWNER.invalidate();try{return mutation.commit();}finally{INVOCATION_OWNER.invalidate();}}
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
 // Provider slot binding, readback and the Cerebras key check are shared (plugin-native-agent NativeProviderSlot).
 static String providerCheckFailure(int status,String body,String model){return NativeProviderSlot.providerCheckFailure(status,body,model);}
 /** Alpha's encrypted provider slot, as the shared binding sees it. */
 static NativeProviderSlot.Store providerSlot(AlphaCredentialStore store){return new NativeProviderSlot.Store(){
  public String readProvider()throws Exception{return store.readCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT);}
  public long authorityEpoch(){return credentialAuthorityEpoch();}
  public void assertCurrent(){store.assertCurrent();}
  public String compareExchangeProvider(String previous,String selection)throws Exception{
   JSONObject next=new JSONObject(selection);
   if(next.optBoolean("unbound")){
    if(!store.compareExchangeCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT,previous,selection))return null;
    return store.readCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT);
   }
   if(!"elizacloud".equals(next.optString("provider")))return store.compareExchangeProviderAdmission(previous,selection,null,null,null);
   String cloud=store.readCredentialSlot("cloud:production");
   if(previous!=null&&LocalAgentProviderAdmission.currentGeneration(previous,cloud)!=null
      &&"elizacloud".equals(new JSONObject(previous).optString("provider")))
    return store.compareExchangeProviderAdmission(previous,selection,"cloud:production",cloud,new JSONObject(previous).getJSONObject("verifiedCloudIdentity"));
   if(!store.compareExchangeCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT,previous,selection))return null;
   return store.readCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT);
  }
  public void removeProvider(boolean onlyIfPresent)throws Exception{if(onlyIfPresent)store.removeProviderIfPresent();else store.removeCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT);}
 };}
 /** Verify before saving: a key is stored only after the check accepts it, then read back. */
 static String saveVerifiedProvider(AlphaCredentialStore store,String key,String model,NativeProviderSlot.KeyCheck check) throws Exception {return NativeProviderSlot.saveVerifiedProvider(providerSlot(store),key,model,check,PRODUCT_NAME);}
 static final String PRODUCT_NAME="Alpha Phone";
 /** Retires the provider binding and confirms by reading it back. */
 static JSObject clearProviderSlot(AlphaCredentialStore store,boolean onlyIfPresent) throws Exception {
  try{return new JSObject(NativeProviderSlot.clearProviderSlot(providerSlot(store),onlyIfPresent).toString());}
  catch(org.json.JSONException impossible){throw new IllegalStateException(impossible);}
 }
 /** Which surface hosts this bridge. Only Alpha's own alpha.assistant flag (set by
  * AlphaAssistActivity after dropping caller extras) is reported; never caller content. */
 @PluginMethod public void launchSurface(PluginCall call) {
  android.app.Activity activity=getActivity();
  boolean assistant=activity instanceof AlphaAssistActivity&&activity.getIntent()!=null&&activity.getIntent().getBooleanExtra(AlphaAssistActivity.EXTRA_ASSISTANT,false);
  call.resolve(new JSObject().put("assistant",assistant));
 }
 /** How this assistant surface was opened, consumed on read: "listener" (the image's always-on
  * listener, see ai.eliza.plugins.system.SenseInvocation) is reported once per launch, then
  * "assist". `locked` reports whether the keyguard is showing now. */
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
   JSONObject bootState=ElizaAgentService.getLocalAgentBootState(getContext());
   synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
    AlphaCredentialStore store=new AlphaCredentialStore(getContext());
    String saved=store.readCredentialSlot("local-agent-provider:v1"),refusal=null;
    if(credentialId!=null){
     try{
      JSONObject provider=new JSONObject(saved);
      if(!"elizacloud".equals(provider.optString("provider"))||!credentialId.equals(provider.optString("credentialId"))||!CLOUD_PROVIDER_MODEL.equals(provider.optString("model")))refusal="provider-changed";
     }catch(Exception unreadable){refusal="provider-unadmitted";}
    }
    if(refusal==null)refusal=attachRefusalLocked(bootState,ElizaAgentService.localAgentToken(),storedProviderGeneration(store));
    JSObject result=new JSObject(ResidentAttachment.describe(refusal).toString());
    if(refusal==null&&credentialId!=null)result.put("bindingGuard",store.providerBindingGuard(saved));
    call.resolve(result);
   }}
  }catch(Exception unavailable){call.resolve(new JSObject().put("attachable",false).put("reason","unavailable"));}},()->{call.reject("Local agent bridge is closed.");});
 }
 /** The owner's Settings switches for agent Gmail changes and Calendar edits. Off never disconnects Google;
  * the on-device Google host refuses agent writes unless this file says on. */
 @PluginMethod public void setGoogleAgentAccess(PluginCall call){
  final Boolean gmailChanges=call.getBoolean("gmailChanges"),calendarEdits=call.getBoolean("calendarEdits");
  if(gmailChanges==null||calendarEdits==null){call.reject("Invalid Google access.");return;}
  PluginWorkers.submit(workers,()->{
   try{GoogleAgentAccessFile.write(GoogleAgentAccessFile.in(getContext().getFilesDir()),gmailChanges,calendarEdits);call.resolve();}
   catch(Exception unavailable){call.reject("Google access could not be saved.");}
  },()->{call.reject("Local agent bridge is closed.");});
 }
 /** Owner-selected direct provider configuration; shared admission owns validation and secure CAS. */
 static boolean directProviderAllowed(boolean testMocks){return NativeProviderSlot.directProviderAllowed(testMocks);}
 @PluginMethod public void configureProvider(PluginCall call) {
  try{requireProviderOwner(true);}catch(Exception unavailable){call.reject("Open unlocked Settings to manage provider keys.");return;}
  final long surface=providerSurfaceGeneration;
  if(!directProviderAllowed(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS)){call.reject(PRODUCT_NAME+" uses your Cloud plan for AI.");return;}
  if(!runtimePackaged()){call.reject("On-device agent is unavailable in this version.");return;}
  String key=call.getString("apiKey",""),model=call.getString("model",CEREBRAS_PROVIDER_MODEL);
  String cartesia=call.getString("cartesiaKey",null);
  if(cartesia!=null&&!validProviderToken(cartesia,1024)){call.reject("Enter a valid Voice key or leave it unchanged.");return;}
  if(!validProviderToken(key,1024)||!model.matches("[A-Za-z0-9][A-Za-z0-9._/-]{0,127}")){call.reject("Enter a valid Cerebras key.");return;}
  if(!CEREBRAS_PROVIDER_MODEL.equals(model)){call.reject(PRODUCT_NAME+" uses "+CEREBRAS_PROVIDER_MODEL+" on Cerebras.");return;}
  final String requestId=call.getString("requestId","");final long configuration;
  try{synchronized(lifecycleLock){if(disposed)throw new IllegalStateException("Local agent bridge closed");configuration=providerConfigurations.begin(requestId);}}catch(Exception unavailable){call.reject("Provider request was cancelled or is unavailable.");return;}
  PluginWorkers.submit(workers,()->{try{
   AlphaCredentialStore store=new AlphaCredentialStore(getContext(),()->{requireProviderOwner(false);if(surface!=providerSurfaceGeneration)throw new SecurityException("Settings closed");providerConfigurations.require(requestId,configuration);});
   store.assertCurrent();
   String failure=NativeProviderSlot.saveVerifiedProvider(providerSlot(store),key,model,cartesia,NativeProviderSlot::checkCerebrasKey,PRODUCT_NAME);
   if(failure!=null){call.reject(failure);return;}
   store.assertCurrent();call.resolve(providerManagementStatus(store));
  }catch(Exception error){call.reject("Provider could not be saved securely.");}finally{providerConfigurations.finish(requestId,configuration);}},()->{providerConfigurations.finish(requestId,configuration);call.reject("Local agent bridge is closed.");});
 }
 /** Reserve a native-issued lease before receiving any provider keys or removal request. */
 @PluginMethod public void prepareProviderConfiguration(PluginCall call){
  try{synchronized(lifecycleLock){requireProviderOwner(true);call.resolve(new JSObject().put("requestId",providerConfigurations.reserve()));}}
  catch(Exception unavailable){call.reject("Provider setup is busy. Try again shortly.");}
 }
 /** Cancels only this request's still-current credential intent; no store write or runtime stop. */
 @PluginMethod public void cancelProviderConfiguration(PluginCall call){
  try{String requestId=call.getString("requestId","");synchronized(lifecycleLock){if(disposed)throw new IllegalStateException("Local agent bridge closed");providerConfigurations.cancel(requestId);if(requestId.equals(providerRevealRequestId))closeProviderReveal();}call.resolve();}
  catch(Exception invalid){call.reject("Invalid provider cancellation request.");}
 }
 /** Retires routing and reads it back; saved Own keys remain in encrypted custody. */
 @PluginMethod public void clearProvider(PluginCall call) {
  final boolean onlyIfPresent=Boolean.TRUE.equals(call.getBoolean("onlyIfPresent"));
  final String requestId=call.getString("requestId",null);final long configuration;
  try{synchronized(lifecycleLock){if(disposed)throw new IllegalStateException("Local agent bridge closed");configuration=requestId==null?reserveCredentialIntent():providerConfigurations.begin(requestId);}}catch(Exception cancelled){call.reject("Provider change was cancelled or is unavailable.");return;}
  PluginWorkers.submit(workers,()->{try{
   call.resolve(clearProviderSlot(new AlphaCredentialStore(getContext(),()->{if(disposed)throw new IllegalStateException("Local agent bridge closed");if(requestId==null)requireCredentialIntent(configuration);else providerConfigurations.require(requestId,configuration);}),onlyIfPresent));
  }catch(Exception error){call.reject("The provider binding could not be cleared.");}finally{if(requestId!=null)providerConfigurations.finish(requestId,configuration);}},()->{if(requestId!=null)providerConfigurations.finish(requestId,configuration);call.reject("Local agent bridge is closed.");});
 }
 @PluginMethod public void clearProviderIfCurrent(PluginCall call){
  String guard=call.getString("bindingGuard","");
  if(!guard.matches("[a-f0-9]{64}")){call.reject("Invalid binding guard");return;}
  PluginWorkers.submit(workers,()->{try{
   AlphaCredentialStore store=new AlphaCredentialStore(getContext(),()->{if(disposed)throw new IllegalStateException("Local agent bridge closed");});
   boolean cleared=store.removeProviderIfCurrent(guard);
   call.resolve(new JSObject().put("outcome",cleared?"cleared":"changed"));
  }catch(Exception error){call.reject("Conditional provider removal could not be confirmed.");}},()->call.reject("Local agent bridge is closed."));
 }
 static final String CLOUD_PROVIDER_MODEL=LocalAgentProviderAdmission.CLOUD_PROVIDER_MODEL;
 static final String CLOUD_PROVIDER_BASE=LocalAgentProviderAdmission.CLOUD_PROVIDER_BASE;
 /** Binds an existing account credential; no bearer value crosses this method's renderer API. */
 @PluginMethod public void configureCloudProvider(PluginCall call) {
  if(!runtimePackaged()){call.reject("On-device agent is unavailable in this version.");return;}
  String credentialId=call.getString("credentialId",""),model=call.getString("model","");
  if(!CLOUD_PROVIDER_MODEL.equals(model)){call.reject("Choose a supported Cloud model.");return;}
  final long configuration;
  synchronized(lifecycleLock){if(disposed){call.reject("Local agent bridge is closed.");return;}configuration=reserveCredentialIntent();}
  PluginWorkers.submit(workers,()->{try{
   AlphaCredentialStore store=new AlphaCredentialStore(getContext(),()->{if(disposed)throw new IllegalStateException("Local agent bridge closed");requireCredentialIntent(configuration);});
   String applied=bindCloudProvider(store,credentialId,model);store.assertCurrent();
   call.resolve(new JSObject().put("configured",true).put("bindingGuard",store.providerBindingGuard(applied)));
  }catch(Exception unavailable){
   String code="NATIVE_CLOUD_ADMISSION_UNAVAILABLE";JSObject data=null;
   if(unavailable instanceof LocalAgentProviderAdmission.CloudBindingFailure){LocalAgentProviderAdmission.CloudBindingFailure failure=(LocalAgentProviderAdmission.CloudBindingFailure)unavailable;code="NATIVE_CLOUD_ADMISSION_"+failure.stage.toUpperCase(java.util.Locale.ROOT).replace('-','_');android.util.Log.w("AlphaCloudAdmission",failure.diagnostic.toString());
    // The renderer tells a transient identity read (0 = transport, 408, 429, 5xx) from a refused key.
    if("identity-read".equals(failure.stage))data=new JSObject().put("stage","identity-read").put("httpStatus",failure.diagnostic.optInt("httpStatus",0));}
   if(data!=null)call.reject("Cloud account changed or is unavailable. Sign in again before starting the local agent.",code,data);
   else call.reject("Cloud account changed or is unavailable. Sign in again before starting the local agent.",code);
  }},()->{call.reject("Local agent bridge is closed.");});
 }
 /** Preserve the previous selection when admission loses its account, without replacing a newer selection. */
 static String bindCloudProvider(AlphaCredentialStore store,String credentialId,String model) throws Exception {
  return bindCloudProvider(store,credentialId,model,false,null);
 }
 static String bindCloudProvider(AlphaCredentialStore store,String credentialId,String model,boolean selectCloud,String expectedPrevious) throws Exception {
  return LocalAgentProviderAdmission.bindCloudProvider(new LocalAgentProviderAdmission.CloudBindingStore(){
   public String readProvider()throws Exception{return store.readCredentialSlot("local-agent-provider:v1");}
   public String readCloud()throws Exception{return store.readCredentialSlot("cloud:production");}
   public void assertCurrent()throws Exception{store.assertCurrent();}
   public JSONObject identity(String token)throws Exception{return AlphaConnectionPlugin.readCloudIdentity(token);}
   public String admit(String previous,String selection,String cloud,JSONObject identity)throws Exception{
    if(selectCloud&&!java.util.Objects.equals(expectedPrevious,previous))throw new SecurityException("Provider changed");
    if(!selectCloud&&previous!=null&&"cerebras".equals(new JSONObject(previous).optString("provider"))){
     String services=LocalAgentProviderAdmission.admit(null,selection,cloud,identity);
     selection=new JSONObject(LocalAgentProviderAdmission.withoutAdmission(previous)).put("cloudServices",NativeProviderSlot.cloudServices(new JSONObject(services))).toString();
    }
    if(new JSONObject(selection).optBoolean("unbound")){
     if(!store.compareExchangeCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT,previous,selection))return null;
     return store.readCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT);
    }
    return store.compareExchangeProviderAdmission(previous,selection,"cloud:production",cloud,identity);
   }
   public void rollback(String binding,String previous)throws Exception{store.rollbackProviderAdmission(binding,previous);}
  },credentialId,model,System::currentTimeMillis);
 }
 // The provider rules live in LocalAgentProviderAdmission (host-JVM tested); these names stay for callers.
 static boolean validProviderToken(String token,int maximumLength){return LocalAgentProviderAdmission.validProviderToken(token,maximumLength);}
 static String cloudProviderToken(String saved,String credentialId,long now) throws Exception {return LocalAgentProviderAdmission.cloudProviderToken(saved,credentialId,now);}
 static void applyProviderEnvironment(JSONObject provider,String cloudSaved,java.util.Map<String,String> env,long now) throws Exception {LocalAgentProviderAdmission.applyProviderEnvironment(provider,cloudSaved,env,now);}
 static final String PROVIDER_MODEL_PATTERN=LocalAgentProviderAdmission.PROVIDER_MODEL_PATTERN;
 /**
  * No admitted plan, Cloud unreachable without a recent plan, or signed out: the agent runs with no
  * hosted inference. Every provider credential and selector is removed, so no request can reach a
  * model provider; the pinned upstream runtime answers chat turns as provider-less (no_provider).
  */
 static void applyUnboundEnvironment(java.util.Map<String,String> env){
  // The verified product module is credential-independent; shared cleanup
  // predates that contract and removes the same module for other hosts.
  String productModule=env.get("ELIZA_NATIVE_GOOGLE_HOST_MODULE");
  NativeProviderSlot.applyUnboundEnvironment(env);
  if(productModule!=null)env.put("ELIZA_NATIVE_GOOGLE_HOST_MODULE",productModule);
 }
 static JSObject providerIdentity(String saved) {
  try{return new JSObject(LocalAgentProviderAdmission.providerIdentity(saved).toString());}
  catch(org.json.JSONException impossible){throw new IllegalStateException(impossible);}
 }
 private static JSObject providerManagementStatus(AlphaCredentialStore store)throws Exception{
  return withCredentialRead(()->new JSObject(NativeProviderSlot.managementStatus(
   store.readCredentialSlot(LocalAgentProviderAdmission.PROVIDER_SLOT),store.readCredentialSlot("cloud:production"),
   System.currentTimeMillis(),credentialAuthorityEpoch()).toString()));
 }
 @PluginMethod public void providerStatus(PluginCall call) {
  PluginWorkers.submit(workers,()->{
   try{if(disposed)throw new IllegalStateException();call.resolve(providerManagementStatus(new AlphaCredentialStore(getContext())));}
   catch(Exception unavailable){call.reject("Provider status unavailable.");}
  },()->call.reject("Local agent bridge is closed."));
 }
 /** Only the resumed owner app can manage secrets; the lock-screen assistant is not this surface. */
 private void requireProviderOwner(boolean requireFocus){
  android.app.Activity activity=getActivity();
  android.app.KeyguardManager keyguard=getContext().getSystemService(android.app.KeyguardManager.class);
  android.os.UserManager user=getContext().getSystemService(android.os.UserManager.class);
  if(disposed||!(activity instanceof MainActivity)||((MainActivity)activity).isAssistantSurface()||activity.isFinishing()||activity.isDestroyed()
    ||!getActivity().getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)
    ||requireFocus&&!activity.hasWindowFocus()||keyguard==null||keyguard.isKeyguardLocked()||keyguard.isDeviceLocked()
    ||user==null||!user.isUserUnlocked())throw new SecurityException("Open unlocked Settings to manage provider keys");
 }
 private void closeProviderReveal(){
  AutoCloseable held=providerReveal;providerReveal=null;providerRevealRequestId=null;
  if(held!=null)try{held.close();}catch(Exception ignored){/* Native surface handle only. */}
 }
 private interface ProviderChange {void apply(AlphaCredentialStore store)throws Exception;}
 private void changeProvider(PluginCall call,ProviderChange change){
  final String requestId=call.getString("requestId","");final long intent,surface=providerSurfaceGeneration;
  try{requireProviderOwner(true);intent=providerConfigurations.begin(requestId);}
  catch(Exception refused){call.reject("Provider request expired. Reopen Settings and try again.");return;}
  PluginWorkers.submit(workers,()->{try{
   AlphaCredentialStore store=new AlphaCredentialStore(getContext(),()->{
    requireProviderOwner(false);if(surface!=providerSurfaceGeneration)throw new SecurityException("Settings closed");
    providerConfigurations.require(requestId,intent);
   });
   store.assertCurrent();change.apply(store);store.assertCurrent();call.resolve(providerManagementStatus(store));
  }catch(Exception unavailable){call.reject("Provider change could not be confirmed. Reload Settings.");}
  finally{providerConfigurations.finish(requestId,intent);}},()->{providerConfigurations.finish(requestId,intent);call.reject("Local agent bridge is closed.");});
 }
 @PluginMethod public void selectProvider(PluginCall call){
  String mode=call.getString("mode","");
  if(!"cloud".equals(mode)&&!"own".equals(mode)){call.reject("Choose Cloud or Own keys.");return;}
  if(!runtimePackaged()){call.reject("On-device agent is unavailable in this version.");return;}
  changeProvider(call,store->{
   String previous=NativeProviderSlot.requireManagementRevision(providerSlot(store),call.getString("expectedRevision"));
   if("own".equals(mode))NativeProviderSlot.selectOwn(providerSlot(store),call.getString("expectedRevision"));
   else{
    String cloud=store.readCredentialSlot("cloud:production");
    String credentialId=new JSONObject(cloud).getString("credentialId");
    bindCloudProvider(store,credentialId,CLOUD_PROVIDER_MODEL,true,previous);
   }
  });
 }
 @PluginMethod public void editProviderKeys(PluginCall call){
  // JSON null, empty strings and other values never mean removal; Remove is a separate action.
  for(String field:new String[]{"textKey","voiceKey"})if(call.getData().has(field)&&!(call.getData().opt(field) instanceof String)){
   call.reject("Enter a key or leave the field unchanged.");return;
  }
  changeProvider(call,store->{
   String failure=NativeProviderSlot.editKeys(providerSlot(store),call.getString("expectedRevision"),
    call.getString("textKey"),call.getString("voiceKey"),NativeProviderSlot::checkCerebrasKey);
   if(failure!=null)throw new IllegalArgumentException("Provider validation refused");
  });
 }
 @PluginMethod public void removeProviderKey(PluginCall call){
  changeProvider(call,store->NativeProviderSlot.removeKey(providerSlot(store),call.getString("expectedRevision"),call.getString("key")));
 }
 /** Reveal stays in the canonical FLAG_SECURE native surface, never in bridge/model output. */
 @PluginMethod public void revealProviderKey(PluginCall call){
  final String requestId=call.getString("requestId",""),expected=call.getString("expectedRevision"),key=call.getString("key");
  final long intent,surface=providerSurfaceGeneration;
  try{requireProviderOwner(true);intent=providerConfigurations.begin(requestId);}
  catch(Exception refused){call.reject("Provider reveal expired. Reopen Settings and try again.");return;}
  PluginWorkers.submit(workers,()->{try{
   AlphaCredentialStore store=new AlphaCredentialStore(getContext(),()->{
    requireProviderOwner(false);if(surface!=providerSurfaceGeneration)throw new SecurityException("Settings closed");providerConfigurations.require(requestId,intent);
   });
   String value=withCredentialRead(()->NativeProviderSlot.revealKey(providerSlot(store),expected,key));
   getActivity().runOnUiThread(()->{try{
    requireProviderOwner(true);store.assertCurrent();
    withCredentialRead(()->{NativeProviderSlot.requireManagementRevision(providerSlot(store),expected);return null;});
    closeProviderReveal();
    final long revealAuthority=credentialAuthorityEpoch();
    providerRevealRequestId=requestId;
    providerReveal=ai.eliza.plugins.passwords.SecretSurfaces.revealOwned(getActivity(),"text".equals(key)?"Text key":"Voice key",value,()->{
     try{requireProviderOwner(false);requireCredentialIntent(intent);return surface==providerSurfaceGeneration&&revealAuthority==credentialAuthorityEpoch();}
     catch(Exception retired){return false;}
    });
    call.resolve(new JSObject().put("key",key).put("shown",true).put("hidesAfterMs",30000).put("revision",expected));
   }catch(Exception retired){call.reject("Provider reveal is unavailable. Reopen Settings.");}
   finally{providerConfigurations.finish(requestId,intent);}});
  }catch(Exception unavailable){providerConfigurations.finish(requestId,intent);call.reject("Provider reveal is unavailable. Reopen Settings.");}
  },()->{providerConfigurations.finish(requestId,intent);call.reject("Local agent bridge is closed.");});
 }
 @Override protected void handleOnPause(){providerSurfaceGeneration++;closeProviderReveal();super.handleOnPause();}
 static void configureNativeViews(java.io.InputStream policy,java.util.Map<String,String> env) throws java.io.IOException {
  try(policy){
   java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();
   byte[] buffer=new byte[4096];int count;
   while((count=policy.read(buffer))!=-1){
    if(output.size()+count>16384)throw new java.io.IOException("Native view launch policy is too large");
    output.write(buffer,0,count);
   }
   env.put("ELIZA_NATIVE_VIEW_DECLARATIONS",output.toString(java.nio.charset.StandardCharsets.UTF_8.name()));
   // Alpha's mounted browser handles back, forward and reload only, and serves no Chromium target.
   env.put("ELIZA_NATIVE_BROWSER_COMMANDS","back,forward,reload");
   env.put("ELIZA_BROWSER_NATIVE_TARGET","off");
  }
 }
 static void configureEnvironment(Context context,java.util.Map<String,String> env) throws java.io.IOException {
  env.put("ELIZA_RUNTIME_PROFILE",BuildConfig.ELIZA_RUNTIME_PROFILE);
  if(AlphaImageCapability.verified(context))env.put("ELIZA_MOBILE_SMS_REPLY_DRAFT","1");
  else env.remove("ELIZA_MOBILE_SMS_REPLY_DRAFT");
  final long epoch;
  synchronized(lifecycleLock){launchedGeneration=null;if(!accepting||stopping||credentialMutationEpoch>=0)throw new java.io.IOException("Local provider is retiring");epoch=lifecycleEpoch;}
  configureNativeViews(context.getAssets().open("agent/native-view-declarations.json"),env);
  for(String key:new String[]{"ELIZA_NATIVE_GOOGLE_HOST_MODULE","ELIZA_NATIVE_GOOGLE_BINDING_JSON","ELIZA_NATIVE_GOOGLE_API_KEY","ELIZA_MANAGED_GMAIL_READ_BROKER","ELIZA_MANAGED_GMAIL_SEND_BROKER","ELIZA_MANAGED_GMAIL_OPERATION_BROKER","ELIZA_MANAGED_CALENDAR_READ_BROKER","ELIZA_MANAGED_CALENDAR_DELETE_ENABLED","ELIZA_NATIVE_GOOGLE_GMAIL_SEND_ENABLED","ELIZA_MANAGED_GMAIL_MAILBOX_CHANGES_ENABLED"})env.remove(key);
  env.remove("ELIZA_MOBILE_WORKFLOWS");
  java.io.File nativeHostResources=null;
  java.io.InputStream workerIndex=null;
  try {workerIndex=context.getAssets().open("agent/workflow-worker/files.sha256");}
  catch(java.io.FileNotFoundException absent) { /* Older payloads do not contain a workflow worker. */ }
  if(workerIndex!=null){
   String root=env.get("AGENT_ROOT");if(root==null){workerIndex.close();throw new java.io.IOException("Agent resource directory unavailable");}
   String packageStamp;
   try{packageStamp=BuildConfig.VERSION_CODE+"/"+context.getPackageManager().getPackageInfo(context.getPackageName(),0).lastUpdateTime;}
   catch(android.content.pm.PackageManager.NameNotFoundException unknown){packageStamp=null;}
   java.io.File worker=WorkflowWorkerAssets.install(new java.io.File(root),workerIndex,path->context.getAssets().open("agent/workflow-worker/"+path),packageStamp);
   WorkflowWorkerAssets.configureEnvironment(worker,env);
   nativeHostResources=worker;
  }
  // The packaged product declaration is credential-independent. Its parent was
  // authenticated by WorkflowWorkerAssets.install, including every indexed hash.
  java.io.File google=nativeHostResources==null?null:new java.io.File(nativeHostResources,"google-host.mjs");
  if(google!=null&&google.isFile())env.put("ELIZA_NATIVE_GOOGLE_HOST_MODULE",google.getCanonicalPath());
  // The owner's Gmail changes / Calendar edits switches (setGoogleAgentAccess), read before every agent write.
  env.put("ALPHA_GOOGLE_AGENT_ACCESS_FILE",GoogleAgentAccessFile.in(context.getFilesDir()).getAbsolutePath());
  try {
  // Decision P-43: the resident always runs. With no provider slot it launches with no hosted
  // provider environment; upstream then reports no_provider for each turn.
  // An unreadable or malformed provider slot (or Cloud credential) never blocks the resident: it
  // launches unbound, exactly as for a provider that cannot be applied below.
  String saved=null,cloudSaved=null;JSONObject provider=null;
  try{
   saved=new AlphaCredentialStore(context).readCredentialSlot("local-agent-provider:v1");
   provider=saved==null?null:new JSONObject(saved);
   cloudSaved=provider!=null&&("elizacloud".equals(provider.optString("provider"))||provider.has("cloudServices"))?new AlphaCredentialStore(context).readCredentialSlot("cloud:production"):null;
  }catch(Exception unreadable){saved=null;provider=null;cloudSaved=null;}
  // The Cloud Google binding is decided before the shared launch: a stripped, legacy or changed
  // admission is not a lifecycle race, so the resident launches unbound instead (P-43).
  java.util.Map<String,String> googleBinding=null;
  if(provider!=null&&("elizacloud".equals(provider.optString("provider"))||provider.has("cloudServices"))){
   if(google==null||!google.isFile())throw new java.io.IOException("Native Cloud routing module unavailable");
   try{
    googleBinding=new java.util.HashMap<>();
    JSONObject binding=LocalAgentProviderAdmission.applyManagedGoogleEnvironment(saved,cloudSaved,googleBinding,System.currentTimeMillis());
    if(binding!=null){
    JSONObject current=new AlphaCredentialStore(context).providerAdmissionSnapshot();
    if(!binding.getString("accountRef").equals(current.getString("accountRef"))||!binding.getString("sessionGeneration").equals(current.getString("sessionGeneration"))||!LocalAgentProviderAdmission.sameCloudCredential(cloudSaved,new AlphaCredentialStore(context).readCredentialSlot("cloud:production")))throw new SecurityException("Native Google provider changed");
    googleBinding.put("ELIZA_NATIVE_GOOGLE_BINDING_JSON",binding.toString());
    }
   }catch(Exception unbindable){
    android.util.Log.w("AlphaLocalAgent","provider-unbound "+unbindable.getClass().getSimpleName());
    googleBinding=null;provider=null;saved=null;cloudSaved=null;
   }
  }
  // Shared provider admission and native embedding order. Keep the verified
  // product module independently of credential availability for Alpha identity.
  if(!NativeProviderSlot.applyLaunchEnvironment(BuildConfig.ELIZA_RUNTIME_PROFILE,provider,cloudSaved,new File(context.getApplicationInfo().nativeLibraryDir),context.getFilesDir(),env,System.currentTimeMillis())){provider=null;saved=null;cloudSaved=null;googleBinding=null;}
  if(google!=null&&google.isFile())env.put("ELIZA_NATIVE_GOOGLE_HOST_MODULE",google.getCanonicalPath());
  if(googleBinding!=null)env.putAll(googleBinding);
  // The agent process has no /etc/localtime on Android and would run in UTC; calendar dates and
  // "tomorrow at 3pm" resolve in the process zone when no owner resolver is registered.
  env.put("TZ",java.util.TimeZone.getDefault().getID());
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
   if(!shutdownRetryRequired())return false;
   if(disposed||getActivity()==null||!getActivity().hasWindowFocus()){call.reject("Return to the app before retrying provider shutdown.");return true;}
   if(credentialMutationEpoch>=0){call.reject("Provider shutdown is already being checked; wait before retrying.");return true;}
   if(requestId!=null&&cancelledStarts.remove(requestId)){call.reject("Local startup cancelled");return true;}
   retryIntent=credentialIntents.current();invalidateCalls();retryEpoch=++lifecycleEpoch;credentialShutdownRetryEpoch=retryEpoch;
   accepting=false;stopping=true;clearEnrollment();pending.add(call);
   startRequestId=requestId;startRequestEpoch=retryEpoch;startOwnsLaunch=false;
  }
  PluginWorkers.submit(workers,()->{
   try{
    final long stopRequest;
    synchronized(lifecycleLock){
     requireShutdownRetry(call,retryEpoch,retryIntent);
     stopRequest=reissueCredentialShutdownLocked();
    }
    ResidentCredentialShutdownRetry.await(
     ()->{synchronized(lifecycleLock){requireShutdownRetry(call,retryEpoch,retryIntent);}},
     ()->ElizaAgentService.isCredentialShutdownConfirmed(stopRequest),
     ()->shutdownConfirmed(ElizaAgentService.getLocalAgentBootState(getContext())),
     android.os.SystemClock::elapsedRealtime,Thread::sleep,15000);
    synchronized(lifecycleLock){
     requireShutdownRetry(call,retryEpoch,retryIntent);
     if(credentialShutdownRequest!=stopRequest||!ElizaAgentService.isCredentialShutdownConfirmed(stopRequest))throw new Superseded();
     // The new confirmed stop superseded an uncertain commit's request in the lease.
     credentialShutdownRequest=-1;uncertainCommitRequest=-1;credentialShutdownRetryEpoch=-1;stopping=false;accepting=true;pending.remove(call);
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
 /** Caller holds lifecycleLock. An ordinary refused stop also latches stopping, without a credential
  * request; an uncertain commit leaves its stop fenced. Only a new Start/Retry request enters the
  * strict owner/absence recheck. */
 static boolean shutdownRetryRequired(){
  if(uncertainCommitRequest>=0)return true;
  return !((credentialShutdownRequest==-1&&!stopping)||(credentialShutdownRequest>=0&&ElizaAgentService.isCredentialShutdownConfirmed(credentialShutdownRequest)));
 }
 /** Caller holds lifecycleLock. Sends a fresh strict stop for a retained credential shutdown.
  * Retain the exact request even if Android dispatch throws. It commits nothing; abandonment
  * keeps starts fenced until this request's actual stop ACK. */
 private long reissueCredentialShutdownLocked() {
  credentialShutdownRequest=-2;
  final long stopRequest=ElizaAgentService.reserveCredentialShutdown();
  credentialShutdownRequest=stopRequest;
  try{ElizaAgentService.retryCredentialShutdown(getContext(),stopRequest);}
  finally{ElizaAgentService.abandonCredentialShutdown(stopRequest);}
  return stopRequest;
 }
 /** Caller holds lifecycleLock. Never lets focus loss or another intent authorize this retry. */
 private void requireShutdownRetry(PluginCall call,long epoch,long intent)throws Superseded {
  if(disposed||!credentialIntents.isCurrent(intent)||epoch!=lifecycleEpoch||credentialShutdownRetryEpoch!=epoch||credentialMutationEpoch>=0||!pending.contains(call)
    ||getActivity()==null||!getActivity().hasWindowFocus())throw new Superseded();
 }
 @PluginMethod public void start(PluginCall call) {
  String requestId=call.getString("requestId");
  if(requestId!=null&&!requestId.matches("[a-f0-9-]{36}")){call.reject("Invalid startup request");return;}
  if(retryCredentialShutdown(call,requestId))return;
  // Boot state reads take the service's processLock; never on the shared Capacitor thread.
  PluginWorkers.submit(workers,()->startAfterShutdown(call,-1,-1),()->call.reject("Local agent bridge is closed."));
 }
 private void startAfterShutdown(PluginCall call,long continuationEpoch,long continuationIntent) {
  String requestId=call.getString("requestId");
  if(requestId!=null&&!requestId.matches("[a-f0-9-]{36}")){call.reject("Invalid startup request");return;}
  try {
   ai.eliza.plugins.agent.updater.RuntimeUpdatePause.beforeStart();
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
     if(continuationEpoch>=0&&(continuationEpoch!=lifecycleEpoch||!credentialIntents.isCurrent(continuationIntent))){call.reject("Local agent connection changed; retry from the app.");return;}
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
     if(observedEpoch!=lifecycleEpoch||continuationEpoch>=0&&!credentialIntents.isCurrent(continuationIntent)){if(continuationEpoch>=0){call.reject("Local agent connection changed; retry from the app.");return;}continue;}
     if(continuationEpoch>=0&&(getActivity()==null||!getActivity().hasWindowFocus())){call.reject("Return to the app before starting.");return;}
     ai.eliza.plugins.agent.updater.RuntimeUpdatePause.beforeStart();
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
     ResidentAttachDiagnostic diagnostic=new ResidentAttachDiagnostic();
     try{
      String root=ElizaAgentService.localAgentToken();if(root==null||root.isEmpty())throw new IllegalStateException();
      diagnostic.stage=ResidentAttachDiagnostic.Stage.STATUS;
      authenticatedStatus(epoch,root,diagnostic::response);
      diagnostic.stage=ResidentAttachDiagnostic.Stage.ENROLLMENT;
      // Attach never pairs: the enrollment it was admitted against must still be the current one.
      synchronized(lifecycleLock){requireCurrent(epoch);if(!root.equals(rootToken)||ownerToken==null)throw new IllegalStateException();}
      resolveCurrent(call,epoch,new JSObject().put("state","ready").put("attached",true));
     }
     catch(Superseded stale){rejectSuperseded(call);}
     catch(Exception unverified){android.util.Log.w("AlphaAgentRequest",diagnostic.failure(unverified));synchronized(lifecycleLock){attachUnverified=true;}rejectPending(call,"The running local agent did not answer. Start again to restart it; no chat was sent.");}
    },()->rejectPending(call,"Local agent bridge is closed."));
    return;
   }
   PluginWorkers.submit(workers,()->{
    long launched=android.os.SystemClock.elapsedRealtime(),deadline=launched+START_DEADLINE_MS;
    boolean ready=false;
    while(android.os.SystemClock.elapsedRealtime()<deadline){
     long pause=1000;
     try{
      JSONObject boot=ElizaAgentService.getLocalAgentBootState(getContext());
      if(rejectStartupRefusal(call,epoch,boot))return;
      // A launch the service already reports as ended fails now, not at the deadline. The first
      // seconds may still show the previous process's state.
      if(android.os.SystemClock.elapsedRealtime()-launched>=3000&&startFailed(boot)){android.util.Log.w("AlphaLocalAgent","start-failed "+boot.optString("reason"));rejectStartFailed(call,epoch);return;}
      // Once the request socket listens, readiness is close: poll it closely.
      if(boot.optBoolean("socketListening"))pause=200;
      String root=ElizaAgentService.localAgentToken();if(root==null||root.isEmpty())throw new IllegalStateException();authenticatedStatus(epoch,root);ready=true;break;
     }
     catch(Superseded stale){rejectSuperseded(call);return;}
     catch(Exception unavailable){try{Thread.sleep(pause);}catch(InterruptedException interrupted){Thread.currentThread().interrupt();break;}}
    }
    if(ready){
     // Never poll enrollment: a failed response may follow a committed pairing POST.
     try{enroll(epoch);resolveCurrent(call,epoch,new JSObject().put("state","ready"));return;}
     catch(Superseded stale){rejectSuperseded(call);return;}
     catch(Exception uncertain){rejectStartFailed(call,epoch);return;}
    }
    rejectStartFailed(call,epoch);
   },()->rejectPending(call,"Local agent bridge is closed."));
  }catch(Exception error){synchronized(lifecycleLock){pending.remove(call);}call.reject(START_FAILED,"start-failed");}
 }
 /** The service keeps a launch alive for its boot grace (ElizaAgentService.AGENT_BOOT_GRACE_MS,
  * 120 s); the start call waits as long before it reports failure. */
 private static final long START_DEADLINE_MS=120000;
 static final String START_FAILED="Your agent couldn't start. Try again.";
 /** A terminal boot state no retry within this launch can change; watchdog restarts are "restarting". */
 static boolean startFailed(JSONObject boot){
  if(!"dead".equals(boot.optString("state")))return false;
  String reason=boot.optString("reason");
  return reason.endsWith("-failed")||"fatal".equals(reason)||reason.startsWith("agent exited:")||reason.startsWith("missing-");
 }
 /** This launch ended or timed out: cancelStart no longer owns it. */
 private void rejectStartFailed(PluginCall call,long epoch){
  synchronized(lifecycleLock){
   if(startRequestEpoch==epoch){startRequestId=null;startOwnsLaunch=false;}
   if(pending.remove(call))call.reject(START_FAILED,"start-failed");
  }
 }
 /** Only the current startup caller may retire a launch it created; reused services are never stopped here. */
 @PluginMethod public void cancelStart(PluginCall call) {
  String requestId=call.getString("requestId","");
  if(!requestId.matches("[a-f0-9-]{36}")){call.reject("Invalid startup request");return;}
  synchronized(lifecycleLock){
   if(disposed){call.reject("Local agent bridge is closed.");return;}
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
 static String startupRefusalMessage(String reason){return ResidentAttachment.startupRefusalMessage(reason);}
 private boolean rejectStartupRefusal(PluginCall call,long epoch,JSONObject status) throws Superseded {
  String reason=status.optString("reason");
  String message=startupRefusalMessage(reason);
  if(message==null)return false;
  synchronized(lifecycleLock){requireCurrent(epoch);if(pending.remove(call))call.reject(message,reason);return true;}
 }
 private static boolean shutdownConfirmed(JSONObject status){return ResidentAttachment.shutdownConfirmed(status);}
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
   epoch=lifecycleEpoch;intent=credentialIntents.current();pending.add(call);
  }
  PluginWorkers.submit(workers,()->{
   try{
    // SDK processLock is acquired before this authority takes lifecycleLock, matching startup.
    ElizaAgentService.RecoveryAuthority authority=operation->{synchronized(lifecycleLock){
     if(disposed||epoch!=lifecycleEpoch||!credentialIntents.isCurrent(intent)||!pending.contains(call)||getActivity()==null||!getActivity().hasWindowFocus()||stopping||credentialMutationEpoch>=0||credentialShutdownRequest!=-1){
      recoveryReview.clear();return new JSONObject().put("status","unavailable").put("reason","active-owner").put("retainedCount",0).put("archivedCount",0);
     }
     if(archive&&!recoveryReview.consume(token,lifecycleEpoch,credentialIntents.current()))return new JSONObject().put("status","unavailable").put("reason","records-changed").put("retainedCount",0).put("archivedCount",0);
     JSONObject result=operation.run();
     if(!archive&&"reviewable".equals(result.optString("status")))recoveryReview.bind(result.getString("reviewToken"),lifecycleEpoch,credentialIntents.current());
     return result;
    }};
    JSONObject result=archive?ElizaAgentService.archiveIpcRecovery(token,authority):ElizaAgentService.reviewIpcRecovery(authority);
    synchronized(lifecycleLock){if(archive)recoveryReview.clear();if(pending.remove(call))call.resolve(new JSObject(result.toString()));}
   }catch(Exception error){synchronized(lifecycleLock){recoveryReview.clear();}rejectPending(call,"Recovery could not be confirmed. Your records were kept. Review again before restarting.");}
  },()->rejectPending(call,"Recovery is unavailable right now. Your records were kept."));
 }
 @PluginMethod public void getStatus(PluginCall call) {
  // Boot state reads take the service's processLock, held across asset extraction.
  PluginWorkers.submit(workers,()->{try{
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
  }catch(Exception error){call.reject("Local runtime status unavailable.");}},()->call.reject("Local agent bridge is closed."));
 }
 /** Updater owns a service shutdown lease; no vault/lifecycle monitor is held during the wait. */
 static long pauseForUpdate(Context context){
  final long request;
  synchronized(lifecycleLock){
   if(credentialMutationEpoch>=0)throw new IllegalStateException("Provider mutation pending");
   startRequestId=null;startOwnsLaunch=false;
   AlphaCanonicalNotifications.forget(context);invalidateCalls();++lifecycleEpoch;accepting=false;stopping=true;clearEnrollment();
   request=ElizaAgentService.reserveCredentialShutdown();
  }
  return request;
 }
 static boolean updateShutdownConfirmed(Context context,long request)throws Exception{return ElizaAgentService.isCredentialShutdownConfirmed(request)&&shutdownConfirmed(ElizaAgentService.getLocalAgentBootState(context));}
 static void releaseUpdateShutdown(long request){ElizaAgentService.releaseCredentialShutdown(request);}
 @PluginMethod public void stop(PluginCall call) {
  synchronized(lifecycleLock){
   if(disposed){call.reject("Local agent bridge is closed.");return;}
   startRequestId=null;startOwnsLaunch=false;
   AlphaCanonicalNotifications.forget(getContext());invalidateCalls();++lifecycleEpoch;accepting=false;stopping=true;clearEnrollment();
   // A retained, unconfirmed credential stop reports stopped only on its own ACK. Reissue the strict
   // stop so that ACK can arrive once whatever refused it has exited; nothing launches here. A
   // credential write in flight still owns its request. A Retry in flight is superseded above.
   boolean strict=credentialShutdownRequest>=0&&credentialMutationEpoch<0
     &&!ElizaAgentService.isCredentialShutdownConfirmed(credentialShutdownRequest);
   try{if(strict)reissueCredentialShutdownLocked();else ElizaAgentService.stop(getContext());call.resolve(new JSObject().put("state","stopping"));}
   catch(Exception unavailable){call.reject("Your agent may still be running. Try stopping it again.");}
  }
 }
 /** Native speech uses only the existing enrollment, bound to its exact token and runtime epoch. */
 static ai.eliza.voice.LiveSegmentPipe.Transport openNativeVoiceTransport(String expectedOwner)throws Exception{
  final String root,token,owner;final long epoch;
  synchronized(lifecycleLock){
   captureResultSession(expectedOwner);root=rootToken;token=ownerToken;owner=ownerIdentity;epoch=lifecycleEpoch;
  }
  final NativeVoiceBinding binding=new NativeVoiceBinding(epoch,root,token,owner);
  final java.util.concurrent.atomic.AtomicBoolean cancelled=new java.util.concurrent.atomic.AtomicBoolean();
  final java.util.concurrent.atomic.AtomicReference<ai.eliza.voice.BufferedStreamExchange.Handle> active=new java.util.concurrent.atomic.AtomicReference<>();
  class VoiceHandle implements ai.eliza.voice.BufferedStreamExchange.Handle {final ElizaAgentService.LocalStreamHandle handle=new ElizaAgentService.LocalStreamHandle();public void cancel(){handle.cancel();}}
  final ai.eliza.voice.BufferedStreamExchange.Port port=new ai.eliza.voice.BufferedStreamExchange.Port(){
   public ai.eliza.voice.BufferedStreamExchange.Handle open(){return new VoiceHandle();}
   public void request(JSONObject input,java.util.function.Consumer<String> events,ai.eliza.voice.BufferedStreamExchange.Handle handle){ElizaAgentService.requestLocalAgentStream(input.toString(),events,((VoiceHandle)handle).handle);}
  };
  return new ai.eliza.voice.LiveSegmentPipe.Transport(){
   public void check()throws Exception{synchronized(lifecycleLock){
    if(!binding.current(lifecycleEpoch,rootToken,ownerToken,ownerIdentity,ElizaAgentService.localAgentToken(),expiresAt,System.currentTimeMillis(),accepting&&!stopping))throw new SecurityException("Voice enrollment changed");
   }}
   public void cancelInFlight(){cancelled.set(true);ai.eliza.voice.BufferedStreamExchange.Handle handle=active.get();if(handle!=null)handle.cancel();}
   public JSONObject post(JSONObject body)throws Exception{
    JSONObject headers=new JSONObject().put("Authorization","Bearer "+routeToken("/api/asr/local-inference/live",token)).put("Content-Type","application/json").put("Accept","application/json");
    JSONObject input=new JSONObject().put("path","/api/asr/local-inference/live").put("method","POST").put("body",body.toString()).put("headers",headers).put("timeoutMs",8000);
    return ai.eliza.voice.BufferedStreamExchange.exchange(port,input,active,()->{check();if(cancelled.get()&&!body.optBoolean("close"))throw new IllegalStateException("Voice capture cancelled");},8000);
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
 /** Canonical service publication and old observer suspension share the same authority lock. */
 static void publishNotificationRoot(Runnable publish){
  synchronized(lifecycleLock){
   AlphaCanonicalNotifications.suspendForRestart();
   if(rootToken!=null){invalidateCalls();++lifecycleEpoch;rootToken=null;ownerToken=null;ownerIdentity=null;notificationAgent=null;expiresAt=0;}
   publish.run();
  }
 }
 static String notificationInstallation(Context context)throws Exception{
  // Context supplies the app-owned root; Android may expose it through a lexical alias.
  java.nio.file.Path root=context.getFilesDir().toPath().toRealPath();
  java.nio.file.Path directory=root.resolve(".eliza");
  java.nio.file.Path file=directory.resolve("runtime-installation-id");
  if(java.nio.file.Files.isSymbolicLink(directory)||!java.nio.file.Files.isDirectory(directory,java.nio.file.LinkOption.NOFOLLOW_LINKS)||!directory.toRealPath().equals(directory)||java.nio.file.Files.isSymbolicLink(file)||!java.nio.file.Files.isRegularFile(file,java.nio.file.LinkOption.NOFOLLOW_LINKS))throw new SecurityException("Notification installation unavailable");
  String id=new String(java.nio.file.Files.readAllBytes(file),java.nio.charset.StandardCharsets.UTF_8).trim();HostedInbox.id(id);return id;
 }
 static void rememberNotificationOwner(Context context,JSONObject expected,JSONObject identity)throws Exception{
  synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
   NativeNotificationDiagnostics.Persist stage=NativeNotificationDiagnostics.Persist.SESSION;
   try{
    checkNotificationSession(expected);AlphaCredentialStore store=new AlphaCredentialStore(context);
    stage=NativeNotificationDiagnostics.Persist.AGENT;
    if(notificationAgent!=null&&!notificationAgent.equals(identity.getString("agentId")))throw new SecurityException("Notification agent changed after validation");
    stage=NativeNotificationDiagnostics.Persist.INSTALLATION;
    String installation=notificationInstallation(context);
    stage=NativeNotificationDiagnostics.Persist.PROVIDER;
    String provider=store.providerAdmissionSnapshot().toString();
    stage=NativeNotificationDiagnostics.Persist.RECORD;
    JSONObject record=NativeNotificationSession.record(expected,identity,installation,provider);
    stage=NativeNotificationDiagnostics.Persist.PREVIOUS;
    String previous=store.readCredentialSlot(NativeNotificationSession.SLOT);
    if(previous!=null){String old=new JSONObject(previous).optString("projectionOwner","");if(old.matches("[a-f0-9]{64}")&&!old.equals(record.getString("projectionOwner")))NativeNotificationProjector.retireOwner(context,old);}
    stage=NativeNotificationDiagnostics.Persist.STORE;
    notificationAgent=identity.getString("agentId");
    store.writeCredentialSlot(NativeNotificationSession.SLOT,record.toString());
    stage=NativeNotificationDiagnostics.Persist.FINAL;
    checkNotificationSession(expected);
   }catch(Exception failure){NativeNotificationDiagnostics.persistFailure(stage,failure);throw failure;}
  }}
 }
 static void retireRejectedNotificationSession(Context context,String expected)throws Exception{
  synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
   if(enrollmentPresent())return;
   if(expected!=null&&new AlphaCredentialStore(context).compareExchangeCredentialSlot(NativeNotificationSession.SLOT,expected,null)){
    String prior=new JSONObject(expected).optString("projectionOwner","");
    if(prior.matches("[a-f0-9]{64}"))NativeNotificationProjector.retireOwner(context,prior);
   }
  }}
 }
 /** Returns only after private IPC has revalidated the saved machine owner. */
 static boolean restoreNotificationOwner(Context context)throws Exception{
  final long epoch; synchronized(lifecycleLock){
   if(!accepting||stopping||credentialMutationEpoch>=0)return false;
   if(enrollmentPresent()){
    try{captureReminderOwnerSession();return true;}
    catch(SecurityException changed){
     // A new process bearer retires old calls, not the existing owner's NMS receipts.
     invalidateCalls();++lifecycleEpoch;AlphaCanonicalNotifications.suspendForRestart();rootToken=null;ownerToken=null;ownerIdentity=null;notificationAgent=null;expiresAt=0;
    }
   }
   epoch=lifecycleEpoch;
  }
  AlphaCredentialStore store=new AlphaCredentialStore(context);
  NativeNotificationSession.Ports ports=new NativeNotificationSession.Ports(){
   public String saved()throws Exception{return store.readCredentialSlot(NativeNotificationSession.SLOT);}
   public String provider()throws Exception{return store.providerAdmissionSnapshot().toString();}
   public String installation()throws Exception{return notificationInstallation(context);}
   public String root()throws Exception{return ElizaAgentService.localAgentToken(context);}
   public void current()throws Exception{synchronized(lifecycleLock){if(epoch!=lifecycleEpoch||!accepting||stopping||credentialMutationEpoch>=0||enrollmentPresent())throw new NativeNotificationSession.Superseded();}}
   public JSONObject get(String path,String bearer)throws Exception{
    if(!java.util.Arrays.asList("/api/auth/me","/api/agents").contains(path))throw new SecurityException("Notification restore route refused");
    current();JSONObject response=raw(path,"GET",null,bearer,null,3000);current();int status=response.getInt("status");
    if(status==401||status==403)throw new SecurityException("Notification session revoked");
    if(status!=200)throw new java.io.IOException("Notification runtime unavailable");
    String body=response.getString("body");if(body.getBytes(java.nio.charset.StandardCharsets.UTF_8).length>65536)throw new SecurityException("Notification identity response invalid");return new JSONObject(body);
   }
  };
  JSONObject restored=NativeNotificationSession.restore(ports,System.currentTimeMillis());if(restored==null)return false;
  synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){
   ports.current();if(!restored.getString("saved").equals(ports.saved())||!restored.getString("provider").equals(ports.provider())||!restored.getString("installationId").equals(ports.installation())||!restored.getString("rootDigest").equals(HostedResultNotices.hash(ports.root())))throw new SecurityException("Notification restoration changed");
   JSONObject session=restored.getJSONObject("session");rootToken=ports.root();ownerToken=session.getString("token");ownerIdentity=session.getString("ownerId");notificationAgent=restored.getString("agentId");expiresAt=session.getLong("expiresAt");return true;
  }}
 }
 /** Native-only canonical inbox transport, bound to an existing machine session. */
 static void checkNotificationSession(JSONObject expected)throws Exception{
  synchronized(lifecycleLock){if(!captureReminderOwnerSession().toString().equals(expected.toString()))throw new SecurityException("Notification session changed");}
 }
 static <T>T withNotificationSession(JSONObject expected,java.util.concurrent.Callable<T> work)throws Exception{
  synchronized(lifecycleLock){synchronized(ai.eliza.plugins.securestore.nativeonly.JsonCredentialSlots.LOCK){checkNotificationSession(expected);T result=work.call();checkNotificationSession(expected);return result;}}
 }
 static JSONObject readNotificationPage(JSONObject expected,JSONObject cursor)throws Exception{
  String path=NativeNotificationSession.pagePath(cursor);checkNotificationSession(expected);
  JSONObject result=raw(path,"GET",null,expected.getString("token"),null,10000);checkNotificationSession(expected);return result;
 }
 static JSONObject markNotificationRead(JSONObject expected,String id)throws Exception{
  if(id==null||!id.matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))throw new SecurityException("Invalid notification identity");
  checkNotificationSession(expected);JSONObject result=raw("/api/notifications/"+id+"/read","POST","{}",expected.getString("token"),null,10000);checkNotificationSession(expected);return result;
 }
 static void subscribeNotificationEvents(JSONObject expected,java.util.function.Consumer<String> events,ElizaAgentService.LocalStreamHandle handle)throws Exception{
  checkNotificationSession(expected);
  JSONObject input=new JSONObject().put("streams",new org.json.JSONArray().put("notification"));
  ElizaAgentService.subscribeLocalAgentEvents(input.toString(),event->{try{checkNotificationSession(expected);events.accept(event);}catch(Exception changed){handle.cancel();}},handle);
 }
 /**
  * The resident's local speech routes (/api/asr/local-inference/*) accept only its per-boot token,
  * not the owner session: the owner token gets 401, and a 401 clears the enrollment. Callers have
  * already admitted the owner; the per-boot token never leaves native code.
  */
 static String routeToken(String path,String session){return path.startsWith("/api/asr/local-inference/")?ElizaAgentService.localAgentToken():session;}
 private static JSONObject raw(String path,String method,String body,String token,JSONObject supplied,int timeoutMs) throws Exception {
  JSONObject headers=new JSONObject();headers.put("Accept","application/json");headers.put("Content-Type","application/json");
  if(token!=null)headers.put("Authorization","Bearer "+routeToken(path,token));
  if(supplied!=null)for(String key:new String[]{"X-Eliza-Device-Id","X-Eliza-Device-Key","X-Eliza-Device-Capabilities","X-ElizaOS-Client-Id"}){
   if(supplied.has(key)){String value=supplied.getString(key);if(value.length()>2048||value.contains("\r")||value.contains("\n")||("X-ElizaOS-Client-Id".equals(key)&&!value.matches("[A-Za-z0-9._-]{1,128}")))throw new IllegalArgumentException();headers.put(key,value);}
  }
  JSONObject input=new JSONObject().put("path",path).put("method",method).put("headers",headers).put("timeoutMs",timeoutMs);
  if(body!=null)input.put("body",body);
  return new JSONObject(ElizaAgentService.requestLocalAgent(input.toString()));
 }
 private static JSONObject json(String path,String method,JSONObject body,String token) throws Exception {return json(path,method,body,token,status->{});}
 private static JSONObject json(String path,String method,JSONObject body,String token,java.util.function.IntConsumer observedStatus) throws Exception {
  JSONObject response=raw(path,method,body==null?null:body.toString(),token,null,120000);
  observedStatus.accept(response.getInt("status"));
  if(response.getInt("status")!=200)throw new IllegalStateException("Local enrollment unavailable");
  return new JSONObject(response.getString("body"));
 }
 private void requireEnrollmentRoot(long epoch,String root) throws Exception {
  requireCurrent(epoch);
  if(root==null||root.isEmpty()||!root.equals(ElizaAgentService.localAgentToken()))throw new IllegalStateException("Local runtime token changed");
 }
 private JSONObject enrollmentJson(long epoch,String path,String method,JSONObject body,String token,String root) throws Exception {return enrollmentJson(epoch,path,method,body,token,root,status->{});}
 private JSONObject enrollmentJson(long epoch,String path,String method,JSONObject body,String token,String root,java.util.function.IntConsumer observedStatus) throws Exception {
  requireEnrollmentRoot(epoch,root);
  // Admission precedes dispatch. In-flight native requests are not claimed cancelled.
  JSONObject result=json(path,method,body,token,observedStatus);requireEnrollmentRoot(epoch,root);return result;
 }
 private JSONObject authenticatedStatus(long epoch,String root) throws Exception {return authenticatedStatus(epoch,root,status->{});}
 private JSONObject authenticatedStatus(long epoch,String root,java.util.function.IntConsumer observedStatus) throws Exception {
  JSONObject status=enrollmentJson(epoch,"/api/auth/status","GET",null,root,root,observedStatus);
  if(!Boolean.TRUE.equals(status.opt("authenticated")))throw new IllegalStateException("Local runtime token not authenticated");
  if(status.getString("instanceId").isEmpty())throw new IllegalStateException("Local runtime instance unavailable");
  return status;
 }
 private String enroll(long epoch) throws Exception {
  synchronized(enrollmentLock){
  requireCurrent(epoch);
  String root=ElizaAgentService.localAgentToken();
  if(root==null||root.isEmpty())throw new IllegalStateException();
  synchronized(lifecycleLock){requireEnrollmentRoot(epoch,root);if(root.equals(rootToken)&&ownerToken!=null&&expiresAt>System.currentTimeMillis()+30000){AlphaCanonicalNotifications.ensure(getContext());return ownerToken;}}
  JSONObject status=authenticatedStatus(epoch,root);
  JSONObject code=enrollmentJson(epoch,"/api/auth/pair-code","GET",null,root,root);
  JSONObject paired=enrollmentJson(epoch,"/api/auth/pair","POST",new JSONObject().put("code",code.getString("code")).put("instanceId",status.getString("instanceId")),root,root);
  if(!"owner".equals(paired.getString("access"))||!status.getString("instanceId").equals(paired.getString("instanceId")))throw new IllegalStateException();
  String token=paired.getString("token");JSONObject who=enrollmentJson(epoch,"/api/auth/me","GET",null,token,root);
  if(!"OWNER".equals(who.getJSONObject("access").getString("role"))||!paired.getString("identityId").equals(who.getJSONObject("identity").getString("id"))||!token.equals(who.getJSONObject("session").getString("id")))throw new IllegalStateException();
  long expiry=who.getJSONObject("session").getLong("expiresAt");if(expiry<=System.currentTimeMillis())throw new IllegalStateException();
  synchronized(lifecycleLock){requireEnrollmentRoot(epoch,root);AlphaCanonicalNotifications.suspendForRestart();rootToken=root;ownerToken=token;ownerIdentity=paired.getString("identityId");notificationAgent=null;expiresAt=expiry;AlphaCanonicalNotifications.ensure(getContext());return token;}
  }
 }
 private static void logRequestFailure(String category,String method,int status,String reason) {
  String safeMethod=java.util.Arrays.asList("GET","POST","PATCH","DELETE").contains(method)?method:"OTHER";
  android.util.Log.w("AlphaAgentRequest","category="+category+" method="+safeMethod+" status="+status+" reason="+reason);
 }
 private static final int LOCAL_REQUEST_TIMEOUT_LIMIT_MS=120_000;
 private static final int RESIDENT_MINIMUM_TIMEOUT_MS=1_000;
 private static final String REQUEST_DEADLINE_MESSAGE="Local agent request timed out before dispatch.";
 private static final class RequestDeadlineExpired extends Exception {}

 /** Omission preserves the legacy per-dispatch timeout. Explicit budgets include time on the worker queue. */
 private static Long localRequestDeadline(JSONObject input,long entered) {
  if(!input.has("timeoutMs"))return null;
  Object value=input.opt("timeoutMs");
  if(!(value instanceof Number))throw new IllegalArgumentException();
  double timeout=((Number)value).doubleValue();
  if(!Double.isFinite(timeout)||timeout!=Math.floor(timeout))throw new IllegalArgumentException();
  return entered+(long)Math.max(0,Math.min(LOCAL_REQUEST_TIMEOUT_LIMIT_MS,timeout));
 }
 private static int remainingLocalRequestTimeout(Long deadline) throws RequestDeadlineExpired {
  if(deadline==null)return LOCAL_REQUEST_TIMEOUT_LIMIT_MS;
  long remaining=deadline-android.os.SystemClock.elapsedRealtime();
  // The shared buffered transport raises ordinary requests to at least one second.
  // Refuse a smaller remainder before admission. Its separate inference floor still applies.
  if(remaining<RESIDENT_MINIMUM_TIMEOUT_MS)throw new RequestDeadlineExpired();
  return (int)remaining;
 }
 @PluginMethod public void request(PluginCall call) {
  long entered=android.os.SystemClock.elapsedRealtime();
  String path=call.getString("path",""),method=call.getString("method","GET"),body=call.getString("body"),expectedOwner=call.getString("ownerId");
  if(path.endsWith("/navigate")&&!PreparedViewNavigation.allowed(path,method,body)){call.reject("Unsupported navigation preparation.");return;}
  OwnerRoutes routes;
  try{routes=OwnerRoutes.shipped(getContext().getAssets()::open);}catch(IllegalStateException unavailable){logRequestFailure("other",method,0,"route-table");call.reject("Unsupported local agent request.");return;}
  String group=routes.group(path);
  if((group!=null? !routes.allowed(group,path,method)||expectedOwner==null||expectedOwner.trim().isEmpty() : ((path.startsWith("/api/views/")||path.endsWith("/messages/truncate")||path.endsWith("/heard"))&&(!method.equals("POST")||expectedOwner==null||expectedOwner.trim().isEmpty()))||(path.equals("/api/asr/local-inference/end-of-turn")&&!method.equals("POST"))||(path.contains("?before=")&&!method.equals("GET"))||(path.startsWith("/api/turns/")&&!method.equals("POST"))||path.contains("..")||path.contains("%")||path.contains("\\")||!path.matches("^/api/(auth/me|agents|status|cloud/warm|conversations(/[A-Za-z0-9_-]+(/messages(/truncate|/[0-9a-fA-F-]{36}/heard|\\?before=[0-9]{1,16}(&beforeId=[0-9a-fA-F-]{36})?(&limit=[0-9]{1,3})?)?)?)?|turns/[0-9a-fA-F-]{36}/abort|views/(interact-(claim|result)|[A-Za-z0-9_-]+/navigate)|client-devices/[A-Za-z0-9_/-]+|workflow(/[A-Za-z0-9_/?=&-]+)?|asr/local-inference/(live(/status)?|end-of-turn))$")||!(method.equals("GET")||method.equals("POST")))||((method.equals("GET")||method.equals("DELETE"))&&body!=null)||(body!=null&&body.length()>2*1024*1024)){
   logRequestFailure(group==null?"other":group,method,0,"gate");
   call.reject("Unsupported local agent request.");return;
  }
  final Long deadline;
  try{
   deadline=localRequestDeadline(call.getData(),entered);
   remainingLocalRequestTimeout(deadline);
  }catch(IllegalArgumentException invalid){call.reject("Invalid local agent request timeout.");return;}
  catch(RequestDeadlineExpired expired){call.reject(REQUEST_DEADLINE_MESSAGE);return;}
  JSONObject headers=call.getObject("headers");
  final String cancelId=call.getString("cancelId");
  if(cancelId!=null&&!cancelId.matches("[A-Za-z0-9-]{16,64}")){logRequestFailure(group==null?"other":group,method,0,"cancel-id");call.reject("Unsupported local agent request.");return;}
  final long epoch;
  try{synchronized(lifecycleLock){epoch=admittedEpoch();if(cancelId!=null&&withdrawable.containsKey(cancelId))throw new Superseded();pending.add(call);if(cancelId!=null)withdrawable.put(cancelId,call);}}catch(Superseded stale){call.reject("Local agent is stopped or unavailable.","LOCAL_AGENT_EPOCH_CHANGED");return;}
  PluginWorkers.submit(workers,()->{try{
   // A withdrawn or superseded call is no longer owned: it stops here, before enrollment.
   requireOwned(call,epoch);
   remainingLocalRequestTimeout(deadline);
   String token=enroll(epoch);
   synchronized(lifecycleLock){requireCurrent(epoch);if(expectedOwner!=null&&!expectedOwner.equals(ownerIdentity)){logRequestFailure(group==null?"other":group,method,409,"owner-mismatch");resolveCurrent(call,epoch,new JSObject().put("status",409).put("body","{\"error\":\"Local owner changed; reconnect before continuing\"}"));return;}}
   requireOwned(call,epoch);
   if("telephony".equals(group)){
    if(!AlphaImageCapability.verified(getContext()))throw new SecurityException("Reply drafting requires the Alpha image");
    requireProviderOwner(true);
   }
   JSONObject result=raw(path,method,body,token,headers,remainingLocalRequestTimeout(deadline));
   if(result.getInt("status")>=400)logRequestFailure(group==null?"other":group,method,result.getInt("status"),"http");
   requireCurrent(epoch);
   if(result.getInt("status")==401)synchronized(lifecycleLock){requireCurrent(epoch);clearEnrollment();}
   if(path.equals("/api/auth/me")&&result.getInt("status")==200){JSONObject who=new JSONObject(result.getString("body"));who.getJSONObject("session").put("id","native-owned-session");result.put("body",who.toString());result.remove("bodyBase64");}
   resolveCurrent(call,epoch,new JSObject(result.toString()));
  }catch(RequestDeadlineExpired expired){rejectPending(call,REQUEST_DEADLINE_MESSAGE);}
  catch(Superseded stale){rejectSuperseded(call);}
  catch(Exception error){logRequestFailure(group==null?"other":group,method,0,"transport");rejectPending(call,"Local agent request failed. No automatic retry was made.");}
  finally{forgetWithdrawable(cancelId,call);}},()->{forgetWithdrawable(cancelId,call);rejectPending(call,"Local agent bridge is closed.");});
 }
 private void forgetWithdrawable(String cancelId,PluginCall call){if(cancelId!=null)synchronized(lifecycleLock){withdrawable.remove(cancelId,call);}}
 /**
  * Withdraws a plain request its caller abandoned. The call is answered now and stops being owned,
  * so one still queued or enrolling is never sent to the runtime. One already sent keeps its worker
  * until the transport answers or times out, and its effect may have completed: withdrawal closes
  * no transport and cancels no server effect.
  */
 @PluginMethod public void cancelRequest(PluginCall call) {
  String id=call.getString("cancelId","");boolean withdrawn=false;
  synchronized(lifecycleLock){
   PluginCall request=withdrawable.remove(id);
   if(request!=null&&pending.remove(request)){withdrawn=true;request.reject("Local agent request cancelled. A dispatched operation may still have completed; inspect its receipt before retrying.","LOCAL_AGENT_REQUEST_CANCELLED");}
  }
  call.resolve(new JSObject().put("withdrawn",withdrawn).put("outcome","unknown"));
 }
 /** Cancellation acknowledges transport closure, never server-effect cancellation. */
 @PluginMethod public void cancelStream(PluginCall call) {
  String id=call.getString("streamId","");
  synchronized(lifecycleLock){var handle=streams.remove(id);streamInvalidators.remove(id);if(handle!=null)handle.cancel();}
  call.resolve(new JSObject().put("transportClosed",true).put("outcome","unknown"));
 }
 @PluginMethod public void requestStream(PluginCall call) {
  String id=call.getString("streamId",""),path=call.getString("path",""),owner=call.getString("ownerId",""),body=call.getString("body","");
  if(!id.matches("[A-Za-z0-9-]{16,64}")||id.startsWith("voice-")||id.startsWith("view-")||!path.matches("^/api/conversations/[A-Za-z0-9_-]+/messages/stream$")||owner.isEmpty()||body.isEmpty()||body.length()>2*1024*1024){call.reject("Unsupported local stream.");return;}
  final long epoch;final var handle=new ElizaAgentService.LocalStreamHandle();
  try{synchronized(lifecycleLock){epoch=admittedEpoch();if(streams.keySet().stream().filter(value->!value.startsWith("voice-")&&!value.startsWith("view-")).count()>=2||streams.containsKey(id))throw new IllegalStateException();streams.put(id,handle);streamInvalidators.put(id,()->notifyListeners("alphaAgentStream",new JSObject().put("streamId",id).put("event",new JSObject().put("type","complete").put("error","Local connection changed. Outcome unknown; check history before retrying."))));}}
  catch(Exception unavailable){call.reject("Local stream unavailable.");return;}
  final JSONObject supplied=call.getObject("headers");
  call.resolve(new JSObject().put("streamId",id));
  PluginWorkers.submit(workers,()->{try{
   String token=enroll(epoch);JSONObject headers=new JSONObject().put("Authorization","Bearer "+token).put("Accept","text/event-stream").put("Content-Type","application/json");
   if(supplied!=null)for(String key:new String[]{"X-Eliza-Device-Id","X-Eliza-Device-Key","X-Eliza-Device-Capabilities","X-ElizaOS-Client-Id"})if(supplied.has(key)){String value=supplied.getString(key);if(value.length()>2048||value.contains("\r")||value.contains("\n")||("X-ElizaOS-Client-Id".equals(key)&&!value.matches("[A-Za-z0-9._-]{1,128}")))throw new IllegalArgumentException();headers.put(key,value);}
   if(supplied!=null&&supplied.has("X-Eliza-Trace-Id")){
    String traceId=supplied.getString("X-Eliza-Trace-Id");
    JSONObject turn=new JSONObject(body);
    String turnId=turn.optString("clientMessageId");
    if(!"VOICE_DM".equals(turn.optString("channelType"))||!traceId.matches("[a-f0-9]{32}")||traceId.matches("0{32}")||
       !turnId.matches("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")||!traceId.equals(turnId.replace("-","")))throw new IllegalArgumentException();
    headers.put("X-Eliza-Trace-Id",traceId);
   }
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
 @PluginMethod public void subscribeViewEvents(PluginCall call) {
  String id=call.getString("subscriptionId",""),owner=call.getString("ownerId",""),clientId=call.getString("clientId","");
  if(!id.matches("[A-Za-z0-9-]{16,64}")||owner.isEmpty()||!clientId.matches("[A-Za-z0-9._-]{1,128}")){call.reject("Invalid voice subscription.");return;}
  String key="view-"+id;final long epoch;final var handle=new ElizaAgentService.LocalStreamHandle();
  try{synchronized(lifecycleLock){epoch=admittedEpoch();if(streams.keySet().stream().anyMatch(value->value.startsWith("view-")))throw new IllegalStateException();streams.put(key,handle);streamInvalidators.put(key,()->notifyListeners("alphaViewEvent",new JSObject().put("subscriptionId",id).put("type","end")));}}
  catch(Exception unavailable){call.reject("Renderer subscription unavailable.");return;}
  final java.util.concurrent.atomic.AtomicBoolean resolved=new java.util.concurrent.atomic.AtomicBoolean();
  PluginWorkers.submit(rendererWorkers,()->{try{
   enroll(epoch);final String admittedRoot;
   synchronized(lifecycleLock){requireCurrent(epoch);admittedRoot=rootToken;if(!VoiceEventAdmission.current(admittedRoot,rootToken,ElizaAgentService.localAgentToken(),owner,ownerIdentity,expiresAt,System.currentTimeMillis())||streams.get(key)!=handle)throw new Superseded();}
   JSONObject input=new JSONObject().put("streams",new org.json.JSONArray().put("view-interact")).put("clientId",clientId);
   ElizaAgentService.subscribeLocalAgentEvents(input.toString(),event->{synchronized(lifecycleLock){try{
    requireCurrent(epoch);if(streams.get(key)!=handle)return;
    if(!VoiceEventAdmission.current(admittedRoot,rootToken,ElizaAgentService.localAgentToken(),owner,ownerIdentity,expiresAt,System.currentTimeMillis())){handle.cancel();return;}
    JSONObject value=new JSONObject(event);
    if("subscribed".equals(value.optString("type"))){if(resolved.compareAndSet(false,true))call.resolve(new JSObject().put("subscriptionId",id));return;}
    if(!"event".equals(value.optString("type")))return;
    JSONObject envelope=value.optJSONObject("event");if(envelope==null||!"agent_event".equals(envelope.optString("type"))||!"view-interact".equals(envelope.optString("stream")))return;
    JSONObject payload=envelope.optJSONObject("payload");if(payload==null||!clientId.equals(payload.optString("clientId")))return;
    notifyListeners("alphaViewEvent",new JSObject().put("subscriptionId",id).put("type","event").put("event",envelope));
   }catch(Exception ignored){handle.cancel();}}},handle);
  }catch(Exception unavailable){if(resolved.compareAndSet(false,true))call.reject("Renderer subscription unavailable.");}
  finally{if(resolved.compareAndSet(false,true))call.reject("Renderer subscription ended before admission.");synchronized(lifecycleLock){if(streams.get(key)==handle){streams.remove(key);streamInvalidators.remove(key);notifyListeners("alphaViewEvent",new JSObject().put("subscriptionId",id).put("type","end"));}handle.cancel();}}},()->{if(resolved.compareAndSet(false,true))call.reject("Renderer worker unavailable.");synchronized(lifecycleLock){if(streams.get(key)==handle){streams.remove(key);streamInvalidators.remove(key);notifyListeners("alphaViewEvent",new JSObject().put("subscriptionId",id).put("type","end"));}handle.cancel();}});
 }
 @PluginMethod public void unsubscribeViewEvents(PluginCall call) {
  String key="view-"+call.getString("subscriptionId","");
  synchronized(lifecycleLock){var handle=streams.remove(key);streamInvalidators.remove(key);if(handle!=null)handle.cancel();}
  call.resolve(new JSObject().put("closed",true));
 }
 /** Destroying one surface (for example closing the assistant) cancels only this instance's
  * calls and streams. The shared runtime, its epoch and the owner enrollment stay valid for
  * other surfaces. When the last surface goes away (the app is closed or recreated) the epoch
  * advances and the enrollment is cleared, as before; the next surface enrolls again. */
 @Override protected void handleOnDestroy(){providerSurfaceGeneration++;closeProviderReveal();synchronized(lifecycleLock){disposed=true;invalidateOwnCalls();instances.remove(this);if(instances.isEmpty()&&!AlphaCanonicalNotifications.ownsSession()){++lifecycleEpoch;clearEnrollment();}}workers.shutdownNow();voiceWorkers.shutdownNow();rendererWorkers.shutdownNow();super.handleOnDestroy();}
}
