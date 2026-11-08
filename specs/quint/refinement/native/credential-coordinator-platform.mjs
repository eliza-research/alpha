import {writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {root} from './java.mjs';
import {dirname, join} from 'node:path';
import {residentPlatform} from './resident-platform.mjs';

/** Reuses OS/service fixture surfaces while executing both actual native plugins and the store. */
export function credentialCoordinatorPlatform() {
  const base=residentPlatform();
  const files={...base.sources};
  delete files['ai/elizaresearch/alphaphone/AlphaCredentialStore.java'];
  delete files['ai/elizaresearch/alphaphone/AlphaConnectionPlugin.java'];
  delete files['ai/elizaresearch/alphaphone/OwnerRoutes.java'];
  const routes=JSON.stringify(readFileSync(join(root,'config/owner-routes.json'),'utf8'));
  files['android/content/res/AssetManager.java']=files['android/content/res/AssetManager.java'].replace(
    'if (name.equals("agent/agent-bundle.js")',
    'if(name.equals("owner-routes.json"))return new ByteArrayInputStream('+routes+'.getBytes(java.nio.charset.StandardCharsets.UTF_8));\n    if (name.equals("agent/agent-bundle.js")');
  files['android/content/Context.java']=files['android/content/Context.java'].replace('public class Context {','public class Context {\npublic java.io.File getNoBackupFilesDir(){return getFilesDir();}');
  files['android/content/Intent.java']=`package android.content;
public class Intent {
  public static final String ACTION_VIEW = "view", CATEGORY_BROWSABLE = "browse", CATEGORY_DEFAULT = "default";
  private android.net.Uri data;
  public Intent() {}
  public Intent(String action, android.net.Uri value) {
    data = value;
  }
  public android.net.Uri getData() {
    return data;
  }
  public Intent setData(android.net.Uri value) {
    data = value;
    return this;
  }
  public Intent addCategory(String value) {
    return this;
  }
  public Intent setPackage(String value) {
    return this;
  }
  public boolean getBooleanExtra(String key, boolean fallback) {
    return fallback;
  }
}`;
  files['android/app/Activity.java']=`package android.app;
public class Activity extends android.content.Context {
  private android.content.Intent intent = new android.content.Intent();
  public boolean isFinishing() { return false; }
  public boolean isDestroyed() { return false; }
  public boolean hasWindowFocus() {
    return true;
  }
  public android.content.Intent getIntent() {
    return intent;
  }
  public void setIntent(android.content.Intent value) {
    intent = value;
  }
  public androidx.lifecycle.Lifecycle getLifecycle() {
    return new androidx.lifecycle.Lifecycle();
  }
  public void runOnUiThread(Runnable task) {
    task.run();
  }
  public void startActivity(android.content.Intent intent) {
    throw new AssertionError("Unexercised browser");
  }
}`;
  files['androidx/lifecycle/Lifecycle.java']='package androidx.lifecycle;public class Lifecycle {public enum State {RESUMED;public boolean isAtLeast(State other){return true;}}public State getCurrentState(){return State.RESUMED;}}';
  files['android/content/pm/PackageManager.java']=files['android/content/pm/PackageManager.java'].replace('public static final int PERMISSION_GRANTED=0;', 'public static final int PERMISSION_GRANTED=0,MATCH_DEFAULT_ONLY=1;public java.util.List<Object> queryIntentActivities(android.content.Intent intent,int flags){return java.util.List.of();}');
  files['android/content/pm/verify/domain/DomainVerificationManager.java']='package android.content.pm.verify.domain;public class DomainVerificationManager {public DomainVerificationUserState getDomainVerificationUserState(String name){return null;}}';
  files['android/content/pm/verify/domain/DomainVerificationUserState.java']='package android.content.pm.verify.domain;public class DomainVerificationUserState {public static final int DOMAIN_STATE_VERIFIED=1,DOMAIN_STATE_SELECTED=2;public java.util.Map<String,Integer> getHostToStateMap(){return java.util.Map.of();}public boolean isLinkHandlingAllowed(){return false;}}';
  files['android/net/Uri.java']=`package android.net;
public class Uri {
  private final java.net.URI value;
  private Uri(String value) {
    this.value = java.net.URI.create(value);
  }
  public static Uri parse(String value) {
    return new Uri(value);
  }
  public String getScheme() {
    return value.getScheme();
  }
  public String getHost() {
    return value.getHost();
  }
  public int getPort() {
    return value.getPort();
  }
  public String getUserInfo() {
    return value.getUserInfo();
  }
  public String getPath() {
    return value.getPath();
  }
  public String getFragment() {
    return value.getFragment();
  }
  public String getEncodedQuery() {
    return value.getRawQuery();
  }
  public String getEncodedFragment() {
    return value.getRawFragment();
  }
  public java.util.Set<String> getQueryParameterNames() {
    throw new AssertionError("Unused query");
  }
  public java.util.List<String> getQueryParameters(String key) {
    throw new AssertionError("Unused query");
  }
  public String getQueryParameter(String key) {
    throw new AssertionError("Unused query");
  }
}`;
  files['android/os/Build.java']='package android.os;public class Build {public static class VERSION {public static final int SDK_INT=30;}public static class VERSION_CODES {public static final int S=31;}}';
  files['android/os/SystemClock.java']='package android.os;public class SystemClock {public static long elapsedRealtime(){return ai.elizaresearch.alphaphone.CredentialCoordinatorPorts.elapsed();}}';
  files['android/util/AtomicFile.java']='package android.util;public class AtomicFile {}';
  files['android/util/Log.java']=files['android/util/Log.java'].replace('public class Log {','public class Log { public static int d(String tag,String value){return 0;}');
  files['androidx/browser/customtabs/CustomTabsClient.java']='package androidx.browser.customtabs;public class CustomTabsClient {public static String getPackageName(android.content.Context context,Object packages){return null;}}';
  files['androidx/browser/customtabs/CustomTabsIntent.java']=`package androidx.browser.customtabs;
public class CustomTabsIntent {
  public static final int SHARE_STATE_OFF = 0;
  public android.content.Intent intent = new android.content.Intent();
  public void launchUrl(android.app.Activity activity, android.net.Uri uri) {
    throw new AssertionError("Unused browser");
  }
  public static class Builder {
    public Builder setShowTitle(boolean value) {
      return this;
    }
    public Builder setShareState(int value) {
      return this;
    }
    public CustomTabsIntent build() {
      return new CustomTabsIntent();
    }
  }
}`;
  files['com/getcapacitor/Plugin.java']=files['com/getcapacitor/Plugin.java'].replace('public void load()', 'protected void handleOnNewIntent(android.content.Intent intent){}protected void handleOnResume(){}public void load()');
  files['com/getcapacitor/Plugin.java']=files['com/getcapacitor/Plugin.java']
   .replace('public void notifyListeners(String name, JSObject value) {}','public void notifyListeners(String name, JSObject value) {ai.elizaresearch.alphaphone.CredentialCoordinatorPorts.notification(name,value);}')
   .replace('public void notifyListeners(String name, JSObject value, boolean retained) {}','public void notifyListeners(String name, JSObject value, boolean retained) {ai.elizaresearch.alphaphone.CredentialCoordinatorPorts.notification(name,value);}');
  files['com/getcapacitor/PluginCall.java']=files['com/getcapacitor/PluginCall.java'].replace('public synchronized void resolve()', 'public long getLong(String key,long fallback){return input.optLong(key,fallback);}public JSObject getObject(String key,JSObject fallback){JSObject value=getObject(key);return value==null?fallback:value;}public synchronized void resolve()');
  files['ai/elizaresearch/alphaphone/BuildConfig.java']=files['ai/elizaresearch/alphaphone/BuildConfig.java'].replace('public class BuildConfig {','public class BuildConfig {public static final String ELIZAOS_APP_LINK_HOST="";');
  files['ai/elizaresearch/alphaphone/NotificationAccess.java']='package ai.elizaresearch.alphaphone;public class NotificationAccess {public static void pause(android.content.Context context,boolean value){throw new AssertionError("Unused notifications");}}';
  files['ai/elizaresearch/alphaphone/CalendarSyncBridge.java']='package ai.elizaresearch.alphaphone;public class CalendarSyncBridge {public static final String SLOT="native-calendar-sync:v1";}';
  files['ai/eliza/plugins/securestore/nativeonly/JsonCredentialSlots.java']=`package ai.eliza.plugins.securestore.nativeonly;
import java.util.*;
import java.util.function.ToIntFunction;
import ai.elizaresearch.alphaphone.CredentialCoordinatorPorts;
public class JsonCredentialSlots {
  public static final Object LOCK = new Object();
  public static final Map<String, String> VALUES = new java.util.concurrent.ConcurrentHashMap<>();
  public static class CapacityException extends Exception {}
  public JsonCredentialSlots(java.io.File directory, String alias, ToIntFunction<String> limit) {}
  public JsonCredentialSlots(
      java.io.File directory, String alias, ToIntFunction<String> limit, ToIntFunction<String> retained) {}
  public String read(String key) throws Exception {
    return CredentialCoordinatorPorts.read(key);
  }
  public void write(String key, String value) throws Exception {
    CredentialCoordinatorPorts.write(key, value);
  }
  public void remove(String key) throws Exception {
    CredentialCoordinatorPorts.write(key, null);
  }
  public String slotHash(String key) {
    return key;
  }
  public android.util.AtomicFile slotFile(String hash) {
    return new android.util.AtomicFile();
  }
}`;
  files['ai/elizaresearch/alphaphone/ElizaAgentService.java']=files['ai/elizaresearch/alphaphone/ElizaAgentService.java']
   .replace('throw new AssertionError("Unused credential shutdown");','return CredentialCoordinatorPorts.strictStop();')
   .replace('throw new AssertionError("Unused credential reservation");','return ++CredentialCoordinatorPorts.strictEpoch;')
   .replace('throw new AssertionError("Unused credential retry");','CredentialCoordinatorPorts.dispatchStrictStop(request);')
   .replace('return false;','return CredentialCoordinatorPorts.confirmed && request==CredentialCoordinatorPorts.strictEpoch;')
   .replace('return ResidentTestPorts.boot();','return CredentialCoordinatorPorts.boot();')
   .replace('return ResidentTestPorts.request(input);','return CredentialCoordinatorPorts.request(input);')
   .replace('throw new AssertionError("Unused stream");','CredentialCoordinatorPorts.stream(input,events,handle);')
   .replace('public boolean cancelled;', 'public volatile boolean cancelled;');
  const paths=[];
  for(const [name,source] of Object.entries(files)){const path=join(base.directory,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,source);paths.push(path);}
  return {paths,sources:files,directory:base.directory,close:base.close};
}
