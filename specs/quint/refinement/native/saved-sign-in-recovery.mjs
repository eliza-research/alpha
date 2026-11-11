import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {app, directory} from './java.mjs';
import {modelTraces, replayJava} from './itf-replay.mjs';

const auth = 'vendor/eliza/packages/auth/android/src/main/java/ai/eliza/auth/cloud/';
const runtime = 'vendor/eliza/plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/';
const secureStore = 'vendor/eliza/plugins/plugin-native-secure-store/android-nativeonly/src/main/java/ai/eliza/plugins/securestore/nativeonly/';

// Ports around AlphaCloudSignInPlugin. The shared sign-in client is reduced to the two calls it
// makes into its host: superseding entry points and a commit under the reserved guard. The
// credential store keeps a saved sign-in as one of saved, expired, rejected or none and runs the
// guard it was built with where AlphaCredentialStore and LegacyCloudRecovery run theirs: before
// the snapshot, and again before the rejection mark or the commit, never across the Cloud read.
const ports = {
  'com/getcapacitor/Plugin.java': `package com.getcapacitor;
public class Plugin {
  public android.content.Context getContext() { return new android.content.Context(); }
  protected void handleOnNewIntent(android.content.Intent intent) {}
  protected void handleOnDestroy() {}
}`,
  'com/getcapacitor/JSObject.java': `package com.getcapacitor;
public class JSObject extends org.json.JSONObject {
  @Override public JSObject put(String key, boolean value) { super.put(key, value); return this; }
}`,
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
public class PluginCall {
  public volatile JSObject result;
  public volatile String code;
  public final java.util.concurrent.CountDownLatch settled = new java.util.concurrent.CountDownLatch(1);
  public void resolve(JSObject value) { result = value; settled.countDown(); }
  public void resolve() { resolve(new JSObject()); }
  public void reject(String message, String value) { code = value; settled.countDown(); }
  public void reject(String message) { reject(message, "none"); }
  public String getString(String key) { return null; }
}`,
  'com/getcapacitor/PluginMethod.java': 'package com.getcapacitor; public @interface PluginMethod {}',
  'com/getcapacitor/annotation/CapacitorPlugin.java': 'package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }',
  'android/content/Context.java': 'package android.content; public class Context {}',
  'android/content/Intent.java': 'package android.content; public class Intent { public Object getData() { return null; } }',
  'ai/alphacompute/alphaphone/BuildConfig.java': 'package ai.alphacompute.alphaphone; public class BuildConfig { public static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS = false; }',
  'ai/eliza/auth/cloud/CloudSignInPlugin.java': `package ai.eliza.auth.cloud;
import com.getcapacitor.PluginCall;
public abstract class CloudSignInPlugin extends com.getcapacitor.Plugin {
  protected abstract CloudSignInConfig registration();
  protected abstract CloudCredentialSlots credentials(Runnable guard);
  protected abstract <T> T withCredentialRead(java.util.concurrent.Callable<T> read) throws Exception;
  protected Runnable reserveCredentialCommit() { return () -> {}; }
  public void startGoogle(PluginCall call) { call.reject("login-active", "login-active"); }
  public void startEmail(PluginCall call) { call.reject("cooldown", "cooldown"); }
  public void startPhone(PluginCall call) { call.reject("cooldown", "cooldown"); }
  public void cancel(PluginCall call) { call.resolve(); }
  /** A code sign-in whose code was sent and verified: the guard is reserved, then the key is stored under it. */
  public final void completeSignIn() throws Exception {
    Runnable guard = reserveCredentialCommit();
    guard.run();
    credentials(guard).write(registration().credentialSlot(registration().environment("production")), "sign-in");
  }
}`,
  'ai/alphacompute/alphaphone/AlphaLocalAgentPlugin.java': `package ai.alphacompute.alphaphone;
final class AlphaLocalAgentPlugin {
  static final ai.eliza.plugins.agent.runtime.CredentialIntentFence credentialIntents = new ai.eliza.plugins.agent.runtime.CredentialIntentFence();
  static <T> T withCredentialRead(java.util.concurrent.Callable<T> read) throws Exception { return read.call(); }
  static long reserveCredentialIntent() { return credentialIntents.reserve(); }
  static void requireCredentialIntent(long intent) { credentialIntents.require(intent); }
}`,
  'ai/alphacompute/alphaphone/AlphaCredentialStore.java': `package ai.alphacompute.alphaphone;
import java.util.concurrent.Semaphore;
final class AlphaCredentialStore {
  static volatile String legacy = "none", slot = "empty", stage = "none", cloud = "accepted";
  static volatile boolean expires;
  static final Semaphore arrived = new Semaphore(0), read = new Semaphore(0), answered = new Semaphore(0);
  static final class RecoveryRefused extends Exception {
    final String code;
    RecoveryRefused(String code) { super("Saved sign-in refused"); this.code = code; }
  }
  private final Runnable guard;
  AlphaCredentialStore(android.content.Context context, Runnable guard) { this.guard = guard; }
  AlphaCredentialStore(android.content.Context context) { this(context, () -> {}); }
  String readCredentialSlot(String name) { return null; }
  void writeCredentialSlot(String name, String value) { guard.run(); slot = value; }
  void removeCredentialSlot(String name) { guard.run(); }
  boolean compareExchangeCredentialSlot(String name, String expected, String value) { guard.run(); return false; }
  boolean legacyCloudRecoveryEligible() { guard.run(); return legacy.equals("saved"); }
  boolean restoreLegacyCloudCredential() throws Exception {
    stage = "reserved";
    arrived.release();
    read.acquireUninterruptibly();
    try {
      guard.run();
      if (!legacy.equals("saved")) return false;
      if (expires) { legacy = "expired"; throw new RecoveryRefused("expired"); }
      stage = "read";
      arrived.release();
      answered.acquireUninterruptibly();
      if (cloud.equals("unreachable")) throw new java.io.IOException("Cloud unreachable");
      guard.run();
      if (cloud.equals("refused")) { legacy = "rejected"; throw new RecoveryRefused("rejected"); }
      legacy = "none";
      slot = "restored";
      return true;
    } finally { stage = "none"; }
  }
}`,
};

export function savedSignInPlatform() {
  const root = mkdtempSync(join(tmpdir(), 'quint-saved-sign-in-'));
  const paths = Object.entries(ports).map(([name, source]) => {
    const path = join(root, name);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, source);
    return path;
  });
  return {paths, close: () => rmSync(root, {recursive: true, force: true})};
}

/** SavedSignInRecovery traces replayed on the real AlphaCloudSignInPlugin. */
export function checkSavedSignInRecovery({traces = 80, maxSteps = 25} = {}) {
  const generated = modelTraces({model: 'SavedSignInRecovery', traces, maxSteps, witnessSeeds: 6,
    witnesses: ['RestoredWitness', 'SupersededKeepsSavedWitness', 'BusyRefusalWitness', 'RejectedWitness', 'ExpiredDuringRestoreWitness',
      // The Cloud read ended after the activity closed, and after another mutation took the intent.
      's.closed and s.commitsSinceRequest == 0 and s.answer == "unavailable" and s.legacyAtRequest == "saved" and s.epoch > s.refusals + 1',
      'not(s.closed) and not(s.intentCurrent) and s.slot == "empty" and s.answer == "unavailable" and s.legacy == "saved"']});
  const platform = savedSignInPlatform();
  try {
    return replayJava({
      harness: 'SavedSignInRecoveryReplay.java',
      sources: [app + 'AlphaCloudSignInPlugin.java', app + 'PluginWorkers.java', app + 'CloudDeployment.java',
        ...['CloudCredentialSlots.java', 'CloudSignInConfig.java', 'CloudSignInEnvironment.java', 'CloudSignInFlow.java'].map(name => auth + name),
        runtime + 'CredentialIntentFence.java', secureStore + 'CredentialIntentFence.java', ...platform.paths],
      traces: generated,
      required: ['restoreRequested', 'signInStep', 'signInCommits', 'intentSuperseded', 'restoreReads', 'restoreEnds', 'destroy'],
      reached: {
        'a restored sign-in': state => state.answer === 'restored' && state.slot === 'restored',
        'a restore that lost to a newer sign-in': state => state.answer === 'unavailable' && state.legacy === 'saved' && state.slot === 'sign-in',
        'a second request refused while one runs': state => state.recovering && state.refusals > 0,
        'a key Cloud refused': state => state.answer === 'rejected',
        'a key that expired during the restore': state => state.answer === 'expired',
        'nothing restored': state => state.answer === 'not-restored',
        'a restore outliving its activity': state => state.closed && state.recovering,
      },
    });
  } finally { platform.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(checkSavedSignInRecovery(), null, 2));
