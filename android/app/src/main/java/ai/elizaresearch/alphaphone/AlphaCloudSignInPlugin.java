package ai.elizaresearch.alphaphone;

import ai.eliza.auth.cloud.CloudCredentialSlots;
import ai.eliza.auth.cloud.CloudSignInConfig;
import ai.eliza.auth.cloud.CloudSignInEnvironment;
import ai.eliza.auth.cloud.CloudSignInPlugin;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Alpha's registration of the shared native Eliza Cloud sign-in client (elizaOS/eliza
 * packages/auth/android, {@link CloudSignInPlugin}). The client owns email/SMS codes, native Google,
 * MFA, the mobile App Auth tail, acknowledgement resume, replaced-key revocation and readiness. Alpha
 * supplies only its registration: the `ai.elizaresearch.alphaphone` App Auth client and its
 * `/alphaphone/auth/callback` return, the configured deployments (staging only in
 * ELIZA_DEV_ALLOW_TEST_MOCKS=1 builds), its product name, the installed storage names below and its
 * Keystore credential store. The minted key follows the resident's credential-intent rule.
 *
 * Alpha also keeps one extension around the shared core: the owner-initiated Restore saved sign-in
 * for an eligible encrypted legacy production credential ({@link #savedSignInRecoveryStatus},
 * {@link #restoreSavedSignIn}). It is never a startup migration. Every sign-in entry point, the
 * cancel and each shared sign-in commit advance the recovery epoch, so a restore that has not yet
 * written loses to any newer sign-in, cancellation or account change, and its write also requires
 * the resident's credential intent. A failed or superseded restore keeps the saved data.
 *
 * The `cloud:<environment>` slot stays renderer-readable, as the Cloud sign-in hand-off's key always
 * was; the pending and receipt slots are native-only (RendererCredentialSlots).
 */
@CapacitorPlugin(name = "AlphaCloudSignIn")
public final class AlphaCloudSignInPlugin extends CloudSignInPlugin {
 /** Installed names: compatibility identifiers of existing sign-ins on this phone. */
 static final String PENDING_SLOT = "cloud-signin:v1:pending";
 static final String CALLBACK_PATH = "/alphaphone/auth/callback";
 static final CloudSignInConfig REGISTRATION = registration(BuildConfig.ELIZA_DEV_ALLOW_TEST_MOCKS);

 static CloudSignInConfig registration(boolean testMocks) {
  CloudSignInConfig.Builder builder = CloudSignInConfig.builder()
   .clientId("ai.elizaresearch.alphaphone").deviceName("Alpha Phone").productName("Alpha Phone").googleClientId("alpha-phone")
   .logTag("AlphaCloudSignIn").readinessPreferences("alpha-cloud-signin-readiness-" + CloudDeployment.STORAGE_NAMESPACE)
   .pendingSlot(PENDING_SLOT).receiptSlotPrefix("cloud-signin:v1:ack:").credentialSlotPrefix("cloud:")
   .environment(new CloudSignInEnvironment("production", CloudDeployment.PRODUCTION_API_HOST, CloudDeployment.PRODUCTION_WEB_HOST,
    CloudDeployment.PRODUCTION_TENANT, CloudDeployment.PRODUCTION_NAME, CALLBACK_PATH));
  if (testMocks) builder.environment(new CloudSignInEnvironment("staging", CloudDeployment.STAGING_API_HOST, CloudDeployment.STAGING_WEB_HOST,
   CloudDeployment.STAGING_TENANT, CloudDeployment.STAGING_NAME, CALLBACK_PATH));
  return builder.build();
 }
 static String receiptSlot(CloudSignInEnvironment environment) { return REGISTRATION.receiptSlot(environment); }

 @Override protected CloudSignInConfig registration() { return REGISTRATION; }
 @Override protected CloudCredentialSlots credentials(Runnable guard) {
  AlphaCredentialStore store = new AlphaCredentialStore(getContext(), guard);
  return new CloudCredentialSlots() {
   @Override public String read(String slot) throws Exception { return store.readCredentialSlot(slot); }
   @Override public void write(String slot, String value) throws Exception { store.writeCredentialSlot(slot, value); }
   @Override public void remove(String slot) throws Exception { store.removeCredentialSlot(slot); }
  };
 }
 @Override protected <T> T withCredentialRead(java.util.concurrent.Callable<T> read) throws Exception {
  return AlphaLocalAgentPlugin.withCredentialRead(read);
 }
 @Override protected Runnable reserveCredentialCommit() {
  supersedeRecovery();
  long intent = AlphaLocalAgentPlugin.reserveCredentialIntent();
  return () -> AlphaLocalAgentPlugin.requireCredentialIntent(intent);
 }

 // ── Restore saved sign-in: explicit owner recovery of a retained legacy credential ─────────────

 private final Object recoveryLock = new Object();
 private final ExecutorService recoveryWorker = Executors.newSingleThreadExecutor();
 private long recoveryEpoch;
 private boolean recoveringLegacy;
 private volatile boolean closed;

 /** Any newer sign-in step, cancellation or commit wins over a restore that has not yet written. */
 private void supersedeRecovery() { synchronized (recoveryLock) { recoveryEpoch++; } }
 /** Recovery work runs on its own worker; a refused submit (Activity teardown) still answers the call. */
 private void recovery(Runnable task, PluginCall call, Runnable refused) {
  PluginWorkers.submit(recoveryWorker, task, () -> { refused.run(); call.reject("Sign-in closed", "unavailable"); });
 }

 /** Read-only metadata; never reads another deployment's legacy slot, and returns no key or account ID. */
 @PluginMethod public void savedSignInRecoveryStatus(PluginCall call) {
  recovery(() -> {
   try {
    AlphaCredentialStore store = new AlphaCredentialStore(getContext(), () -> { if (closed) throw new IllegalStateException("Sign-in closed"); });
    call.resolve(new JSObject().put("eligible", store.legacyCloudRecoveryEligible()));
   } catch (Exception failure) { call.reject("Saved sign-in could not be checked", "storage"); }
  }, call, () -> {});
 }
 /** Explicit owner request, not startup migration. No key, account ID or legacy proof is returned. */
 @PluginMethod public void restoreSavedSignIn(PluginCall call) {
  final long owner;
  synchronized (recoveryLock) {
   if (closed || recoveringLegacy) { call.reject("Another sign-in is in progress", "login-active"); return; }
   recoveringLegacy = true; owner = ++recoveryEpoch;
  }
  final long intent = AlphaLocalAgentPlugin.reserveCredentialIntent();
  recovery(() -> {
   JSObject answer = null;
   try {
    AlphaCredentialStore kept = new AlphaCredentialStore(getContext(), () -> {
     synchronized (recoveryLock) { if (closed || recoveryEpoch != owner) throw new IllegalStateException("Sign-in closed"); }
     AlphaLocalAgentPlugin.requireCredentialIntent(intent);
    });
    answer = new JSObject().put("restored", kept.restoreLegacyCloudCredential());
   } catch (Exception failure) { answer = null; }
   finally { endRecovery(); }
   // The single-flight guard is released before the call settles, so a caller that retries as soon
   // as it has the answer is never refused as "login-active" by the restore that just finished.
   if (answer != null) call.resolve(answer);
   else call.reject("Saved sign-in could not be restored. Your saved data is retained.", "unavailable");
  }, call, this::endRecovery);
 }
 private void endRecovery() { synchronized (recoveryLock) { recoveringLegacy = false; } }

 @Override @PluginMethod public void startGoogle(PluginCall call) { supersedeRecovery(); super.startGoogle(call); }
 @Override @PluginMethod public void startEmail(PluginCall call) { supersedeRecovery(); super.startEmail(call); }
 @Override @PluginMethod public void startPhone(PluginCall call) { supersedeRecovery(); super.startPhone(call); }
 @Override @PluginMethod public void cancel(PluginCall call) { supersedeRecovery(); super.cancel(call); }
 /** A browser return may complete a sign-in into storage: it supersedes a restore as well. */
 /** Only this pending sign-in return may supersede saved-sign-in recovery. */
 @Override protected void handleOnNewIntent(Intent intent) {
  if(intent!=null&&intent.getData()!=null){try{
   ai.eliza.auth.cloud.CloudSignInFlow.Pending pending=ai.eliza.auth.cloud.CloudSignInFlow.Pending.parse(new AlphaCredentialStore(getContext()).readCredentialSlot(PENDING_SLOT),REGISTRATION);
   if(pending!=null){
    ai.eliza.auth.cloud.CloudSignInFlow.Callback callback=ai.eliza.auth.cloud.CloudSignInFlow.parseCallback(intent.getData().toString(),pending.environment);
    if(pending.sameState(callback))supersedeRecovery();
   }
  }catch(Exception ignored){/* Unrelated intents never alter recovery ownership. */}}
  super.handleOnNewIntent(intent);
 }
 @Override protected void handleOnDestroy() {
  closed = true;
  supersedeRecovery();
  recoveryWorker.shutdownNow();
  super.handleOnDestroy();
 }
}
