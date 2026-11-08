import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';

/** External platform ports for the complete resident plugin. Unexercised capabilities refuse. */
export function residentPlatform() {
  const root = mkdtempSync(join(tmpdir(), 'quint-resident-platform-'));
  const files = {
    'android/content/Context.java': `package android.content;
import java.io.*;
import android.content.pm.ApplicationInfo;
import android.content.res.AssetManager;
public class Context {
  public static final int MODE_PRIVATE = 0;
  public Context getApplicationContext() {
    return this;
  }
  public AssetManager getAssets() {
    return new AssetManager();
  }
  public ApplicationInfo getApplicationInfo() {
    ApplicationInfo info = new ApplicationInfo();
    info.nativeLibraryDir = ai.elizaresearch.alphaphone.ResidentTestPorts.nativeDirectory;
    return info;
  }
  public File getFilesDir() {
    return new File(ai.elizaresearch.alphaphone.ResidentTestPorts.nativeDirectory);
  }
  public SharedPreferences getSharedPreferences(String name, int mode) {
    return new SharedPreferences();
  }
  public <T> T getSystemService(Class<T> type) {
    return null;
  }
}`,
    'android/content/SharedPreferences.java': `package android.content;
public class SharedPreferences {
  public Editor edit() {
    return new Editor();
  }
  public static class Editor {
    public Editor putString(String key, String value) {
      return this;
    }
    public void apply() {}
  }
}`,
    'android/content/Intent.java': `package android.content;
public class Intent {
  public boolean getBooleanExtra(String key, boolean fallback) {
    return fallback;
  }
}`,
    'android/content/pm/ApplicationInfo.java': `package android.content.pm;
public class ApplicationInfo {
  public String nativeLibraryDir;
}`,
    'android/content/res/AssetManager.java': `package android.content.res;
import java.io.*;
public class AssetManager {
  public InputStream open(String name) throws IOException {
    if (name.equals("agent/agent-bundle.js") && ai.elizaresearch.alphaphone.ResidentTestPorts.packaged)
      return new ByteArrayInputStream(new byte[0]);
    throw new FileNotFoundException(name);
  }
}`,
    'android/app/Activity.java': `package android.app;
public class Activity extends android.content.Context {
  public boolean hasWindowFocus() {
    return true;
  }
  public android.content.Intent getIntent() {
    return new android.content.Intent();
  }
}`,
    'android/app/KeyguardManager.java': `package android.app;
public class KeyguardManager {
  public boolean isKeyguardLocked() {
    return false;
  }
}`,
    'android/os/SystemClock.java': `package android.os;
public class SystemClock {
  public static long elapsedRealtime() {
    return System.nanoTime() / 1000000;
  }
}`,
    'android/os/Process.java': `package android.os;
public class Process {
  public static int myUid() {
    return 100000;
  }
}`,
    'android/util/Log.java': `package android.util;
public class Log {
  public static int i(String tag, String value) {
    return 0;
  }
  public static int w(String tag, String value) {
    return 0;
  }
}`,
    'com/getcapacitor/JSObject.java': `package com.getcapacitor;
public class JSObject extends org.json.JSONObject {
  public JSObject() {}
  public JSObject(String value) {
    super(value);
  }
  public JSObject put(String key, Object value) {
    super.put(key, value);
    return this;
  }
  public JSObject put(String key, boolean value) {
    super.put(key, value);
    return this;
  }
  public JSObject put(String key, long value) {
    super.put(key, value);
    return this;
  }
  public JSObject put(String key, int value) {
    super.put(key, value);
    return this;
  }
}`,
    'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
public class PluginCall {
  private final JSObject input;
  public volatile JSObject result;
  public volatile String rejection;
  public int completions;
  public PluginCall(JSObject input) {
    this.input = input;
  }
  public String getString(String key) {
    return input.optString(key, null);
  }
  public String getString(String key, String fallback) {
    return input.optString(key, fallback);
  }
  public JSObject getObject(String key) {
    org.json.JSONObject value = input.optJSONObject(key);
    return value == null ? null : new JSObject(value.toString());
  }
  public synchronized void resolve() {
    resolve(new JSObject());
  }
  public synchronized void resolve(JSObject value) {
    result = value;
    completions++;
    notifyAll();
  }
  public synchronized void reject(String value) {
    rejection = value;
    completions++;
    notifyAll();
  }
  public void reject(String value, String code) {
    reject(value);
  }
}`,
    'com/getcapacitor/Plugin.java': `package com.getcapacitor;
public class Plugin {
  private final android.app.Activity activity = new android.app.Activity();
  public void load() {}
  protected void handleOnDestroy() {}
  public android.content.Context getContext() {
    return activity;
  }
  public android.app.Activity getActivity() {
    return activity;
  }
  public void notifyListeners(String name, JSObject value) {}
  public void notifyListeners(String name, JSObject value, boolean retained) {}
}`,
    'com/getcapacitor/PluginMethod.java': `package com.getcapacitor;
public @interface PluginMethod {}`,
    'com/getcapacitor/annotation/CapacitorPlugin.java': `package com.getcapacitor.annotation;
public @interface CapacitorPlugin {
  String name();
}`,
    'ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java': `package ai.eliza.plugins.securestore.nativeonly;
public class JsonCredentialSlots {
  public static final Object LOCK = new Object();
}`,
    'ai/elizaresearch/alphaphone/BuildConfig.java': `package ai.elizaresearch.alphaphone;
public class BuildConfig {
  public static final boolean DEBUG = true, ELIZA_DEV_ALLOW_TEST_MOCKS = false;
  public static final String ELIZA_RUNTIME_PROFILE = "native";
}`,
    'ai/elizaresearch/alphaphone/AlphaAssistActivity.java': `package ai.elizaresearch.alphaphone;
public class AlphaAssistActivity extends android.app.Activity {
  public static final String EXTRA_ASSISTANT = "assistant";
  public String takeInvocation() {
    throw new AssertionError("Unused activity capability");
  }
}`,
    'ai/elizaresearch/alphaphone/AlphaCredentialStore.java': `package ai.elizaresearch.alphaphone;
public class AlphaCredentialStore {
  private final Runnable owner;
  public AlphaCredentialStore(android.content.Context context) {
    this(context, () -> {});
  }
  public AlphaCredentialStore(android.content.Context context, Runnable owner) {
    this.owner = owner;
  }
  public void assertCurrent() {
    owner.run();
  }
  public String readCredentialSlot(String key) {
    owner.run();
    return ResidentTestPorts.slots.get(key);
  }
  public void writeCredentialSlot(String key, String value) {
    owner.run();
    throw new AssertionError("Unused credential mutation");
  }
  public void removeCredentialSlot(String key) {
    throw new AssertionError("Unused credential removal");
  }
  public String compareExchangeProviderAdmission(
      String a, String b, String c, String d, org.json.JSONObject e) {
    throw new AssertionError("Unused provider admission");
  }
  public void rollbackProviderAdmission(String a, String b) {
    throw new AssertionError("Unused rollback");
  }
  public boolean compareExchangeCredentialSlot(String key, String before, String value) {
    throw new AssertionError("Unused credential CAS");
  }
  public org.json.JSONObject providerAdmissionSnapshot() {
    throw new AssertionError("Unused provider snapshot");
  }
}`,
    'ai/elizaresearch/alphaphone/ElizaAgentService.java': `package ai.elizaresearch.alphaphone;
import android.content.Context;
import org.json.JSONObject;
public class ElizaAgentService {
  public static class LocalStreamHandle {
    public boolean cancelled;
    public void cancel() {
      cancelled = true;
    }
  }
  public interface RecoveryOperation {
    JSONObject run() throws Exception;
  }
  public interface RecoveryAuthority {
    JSONObject run(RecoveryOperation operation) throws Exception;
  }
  public static void start(Context context) {
    ResidentTestPorts.start();
  }
  public static void stop(Context context) {
    ResidentTestPorts.stop();
  }
  public static long stopForCredentialChange(Context context) {
    throw new AssertionError("Unused credential shutdown");
  }
  public static boolean isCredentialShutdownConfirmed(long request) {
    return false;
  }
  public static JSONObject getLocalAgentBootState(Context context) {
    return ResidentTestPorts.boot();
  }
  public static String localAgentToken() {
    return ResidentTestPorts.rootToken;
  }
  public static String requestLocalAgent(String input) {
    return ResidentTestPorts.request(input);
  }
  public static void requestLocalAgentStream(
      String input, java.util.function.Consumer<String> events, LocalStreamHandle handle) {
    throw new AssertionError("Unused stream");
  }
  public static void subscribeLocalAgentEvents(
      String input, java.util.function.Consumer<String> events, LocalStreamHandle handle) {
    throw new AssertionError("Unused voice stream");
  }
  public static JSONObject archiveIpcRecovery(String token, RecoveryAuthority authority) {
    throw new AssertionError("Unused archive");
  }
  public static JSONObject reviewIpcRecovery(RecoveryAuthority authority) {
    throw new AssertionError("Unused review");
  }
}`,
    'ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java': `package ai.elizaresearch.alphaphone;
public class AlphaConnectionPlugin {
  public static org.json.JSONObject readCloudIdentity(String token) {
    throw new AssertionError("Unused identity");
  }
  public static org.json.JSONObject providerAdmissionSnapshot(android.content.Context context) {
    throw new AssertionError("Unused identity");
  }
}`,
    'ai/elizaresearch/alphaphone/WorkflowWorkerAssets.java': `package ai.elizaresearch.alphaphone;
public class WorkflowWorkerAssets {
  public interface Asset {
    java.io.InputStream open(String name) throws java.io.IOException;
  }
  public static java.io.File install(java.io.File root, java.io.InputStream index, Asset asset) {
    throw new AssertionError("Unused asset install");
  }
  public static void configureEnvironment(java.io.File root, java.util.Map<String, String> env) {
    throw new AssertionError("Unused asset config");
  }
}`,
    'ai/elizaresearch/alphaphone/NativeLiveVoicePipe.java': `package ai.elizaresearch.alphaphone;
public class NativeLiveVoicePipe {
  public interface Transport {
    void check() throws Exception;
    void cancelInFlight();
    org.json.JSONObject post(org.json.JSONObject body) throws Exception;
  }
}`,
    'ai/elizaresearch/alphaphone/ResidentResultSession.java': `package ai.elizaresearch.alphaphone;
public class ResidentResultSession {
  public static org.json.JSONObject snapshot(String owner, String token, long expiresAt, String root) {
    throw new AssertionError("Unused result capture");
  }
}`
  };
  files['android/Manifest.java']='package android; public class Manifest {public static class permission {public static final String RECORD_AUDIO="record";}}';
  files['android/content/pm/PackageManager.java']='package android.content.pm;public class PackageManager {public static final int PERMISSION_GRANTED=0;}';
  files['ai/eliza/plugins/system/SenseListenerClient.java']='package ai.eliza.plugins.system; public class SenseListenerClient {public interface PowerLaunchValidator {boolean isCurrent();boolean authorize(String candidate,java.util.function.BooleanSupplier consume);}}';
  files['ai/elizaresearch/alphaphone/AlphaCanonicalNotifications.java']='package ai.elizaresearch.alphaphone;public class AlphaCanonicalNotifications {public static void stop(){}public static void suspendForRestart(){}public static void forget(Object context){}public static void ensure(Object context){}public static boolean ownsSession(){return false;}}';
  files['ai/elizaresearch/alphaphone/NativeNotificationProjector.java']='package ai.elizaresearch.alphaphone;public class NativeNotificationProjector {public static void retireOwner(Object context,String owner){throw new AssertionError("Unexercised notification projection");}}';
  files['ai/elizaresearch/alphaphone/NativeNotificationWire.java']='package ai.elizaresearch.alphaphone;public class NativeNotificationWire {public static String pagePath(org.json.JSONObject cursor){throw new AssertionError("Unexercised notification page");}}';
  files['android/content/Context.java']=files['android/content/Context.java'].replace('public static final int MODE_PRIVATE = 0;', 'public static final int MODE_PRIVATE = 0; public int checkSelfPermission(String name){return 0;}');
  files['android/content/res/AssetManager.java']=files['android/content/res/AssetManager.java'].replace('throw new FileNotFoundException(name);', 'if(name.equals("owner-routes.json"))return new FileInputStream("config/owner-routes.json");throw new FileNotFoundException(name);');
  files['com/getcapacitor/PluginCall.java']=files['com/getcapacitor/PluginCall.java'].replace('public String getString(String key) {','public Boolean getBoolean(String key){return input.has(key)?input.getBoolean(key):null;}public String getString(String key) {');
  files['ai/elizaresearch/alphaphone/AlphaCredentialStore.java']=files['ai/elizaresearch/alphaphone/AlphaCredentialStore.java'].replace('private final Runnable owner;', 'private final Runnable owner; public void removeProviderIfPresent(){throw new AssertionError("Unexercised provider removal");}public boolean removeProviderIfCurrent(String guard){throw new AssertionError("Unexercised provider removal");}public String providerBindingGuard(String expected){throw new AssertionError("Unexercised binding guard");}');
  files['ai/elizaresearch/alphaphone/ElizaAgentService.java']=files['ai/elizaresearch/alphaphone/ElizaAgentService.java'].replace('public static void start(Context context) {', 'public static long reserveCredentialShutdown(){throw new AssertionError("Unexercised strict shutdown reserve");}public static void retryCredentialShutdown(Context context,long request){throw new AssertionError("Unexercised strict shutdown retry");}public static boolean abandonCredentialShutdown(long request){return true;}public static boolean releaseCredentialShutdown(long request){return true;}public static String localAgentToken(Context context){return localAgentToken();}public static void start(Context context) {');
  const paths = [];
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, source);
    paths.push(path);
  }
  return {paths, sources: files, directory: root, close: () => rmSync(root, {recursive: true, force: true})};
}
