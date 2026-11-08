import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';

/** Android/Capacitor presentation and storage ports for the actual native coordinator. */
export function signInPlatform() {
  const root = mkdtempSync(join(tmpdir(), 'quint-sign-in-platform-'));
  const files = {
    'android/content/SharedPreferences.java': `package android.content;
public interface SharedPreferences {String getString(String key,String fallback);Editor edit();interface Editor {Editor remove(String key);Editor putString(String key,String value);void apply();}}`,
    'android/content/Context.java': `package android.content;
import java.util.HashMap;import android.content.pm.PackageManager;
public class Context {public static final int MODE_PRIVATE=0;private final HashMap<String,String> values=new HashMap<>();public Context getApplicationContext(){return this;}public String getPackageName(){return "ai.elizaresearch.alphaphone";}public PackageManager getPackageManager(){return new PackageManager();}public <T>T getSystemService(Class<T> type){return null;}
 public SharedPreferences getSharedPreferences(String name,int mode){return new SharedPreferences(){public String getString(String key,String fallback){return values.getOrDefault(key,fallback);}public Editor edit(){return new Editor(){public Editor remove(String key){values.remove(key);return this;}public Editor putString(String key,String value){values.put(key,value);return this;}public void apply(){}};}};}}`,
    'android/content/Intent.java': `package android.content;
import android.net.Uri;
public class Intent {public static final String ACTION_VIEW="view",CATEGORY_BROWSABLE="browse";private Uri uri;public Intent(){}public Intent(String action){}public Intent(String action,Uri value){uri=value;}public Uri getData(){return uri;}public Intent setData(Uri value){uri=value;return this;}public Intent addCategory(String value){return this;}public Intent setPackage(String value){return this;}}`,
    'android/content/DialogInterface.java': `package android.content;public interface DialogInterface {interface OnClickListener {void onClick(DialogInterface dialog,int which);}interface OnCancelListener {void onCancel(DialogInterface dialog);}}`,
    'android/app/Activity.java': `package android.app;
import android.content.*;import ai.elizaresearch.alphaphone.SignInTestPorts;
public class Activity extends Context {public Intent getIntent(){return new Intent();}public boolean isFinishing(){return false;}public boolean isDestroyed(){return false;}public void runOnUiThread(Runnable task){task.run();}public void startActivity(Intent intent){SignInTestPorts.browserOpened=true;}}`,
    'android/app/AlertDialog.java': `package android.app;
import android.content.*;import ai.elizaresearch.alphaphone.SignInTestPorts;
public class AlertDialog implements DialogInterface {private OnClickListener yes;public void setCanceledOnTouchOutside(boolean value){}public void show(){SignInTestPorts.authorizations++;yes.onClick(this,1);}public void dismiss(){}
 public static class Builder {private final AlertDialog dialog=new AlertDialog();public Builder(Activity activity){}public Builder setTitle(String value){return this;}public Builder setMessage(String value){return this;}public Builder setPositiveButton(String name,OnClickListener yes){dialog.yes=yes;return this;}public Builder setNegativeButton(String name,OnClickListener no){return this;}public Builder setOnCancelListener(OnCancelListener cancel){return this;}public AlertDialog create(){return dialog;}}}`,
    'android/net/Uri.java': `package android.net;
public class Uri {private final String value;private Uri(String text){value=text;}public static Uri parse(String value){return new Uri(value);}public String getScheme(){return java.net.URI.create(value).getScheme();}public static String encode(String value){return java.net.URLEncoder.encode(value,java.nio.charset.StandardCharsets.UTF_8);}public String toString(){return value;}}`,
    'android/os/Looper.java': 'package android.os;public class Looper {public static Looper getMainLooper(){return new Looper();}}',
    'android/os/Handler.java': 'package android.os;public class Handler {public Handler(Looper looper){}public boolean post(Runnable task){task.run();return true;}public boolean postDelayed(Runnable task,long delay){return true;}}',
    'android/os/Build.java': 'package android.os;public class Build {public static class VERSION {public static final int SDK_INT=30;}public static class VERSION_CODES {public static final int S=31;}}',
    'android/content/pm/PackageManager.java': `package android.content.pm;
import java.util.*;import android.content.Intent;
public class PackageManager {public static final int GET_SIGNING_CERTIFICATES=1,GET_SIGNATURES=4,MATCH_DEFAULT_ONLY=2;public PackageInfo getPackageInfo(String name,int flags){return new PackageInfo();}public java.util.List<ResolveInfo> queryIntentActivities(Intent intent,int flags){return java.util.List.of(new ResolveInfo());}public java.util.List<ResolveInfo> queryIntentServices(Intent intent,int flags){return java.util.List.of();}public ResolveInfo resolveActivity(Intent intent,int flags){return new ResolveInfo();}}`,
    'android/content/pm/PackageInfo.java': 'package android.content.pm;public class PackageInfo {public SigningInfo signingInfo=new SigningInfo();public Signature[] signatures=new Signature[0];}',
    'android/content/pm/SigningInfo.java': 'package android.content.pm;public class SigningInfo {public Signature[] getApkContentsSigners(){return new Signature[]{new Signature()};}}',
    'android/content/pm/Signature.java': 'package android.content.pm;public class Signature {public byte[] toByteArray(){return new byte[0];}}',
    'android/content/pm/verify/domain/DomainVerificationManager.java': 'package android.content.pm.verify.domain;public class DomainVerificationManager {public DomainVerificationUserState getDomainVerificationUserState(String name){return null;}}',
    'android/content/pm/verify/domain/DomainVerificationUserState.java': 'package android.content.pm.verify.domain;import java.util.Map;public class DomainVerificationUserState {public static final int DOMAIN_STATE_VERIFIED=1,DOMAIN_STATE_SELECTED=2;public Map<String,Integer> getHostToStateMap(){return Map.of();}public boolean isLinkHandlingAllowed(){return false;}}',
    'androidx/browser/customtabs/CustomTabsClient.java': 'package androidx.browser.customtabs;import android.content.Context;public class CustomTabsClient {public static String getPackageName(Context context,Object packages){return null;}}',
    'androidx/browser/customtabs/CustomTabsIntent.java': `package androidx.browser.customtabs;
import android.content.Intent;import android.app.Activity;import android.net.Uri;
public class CustomTabsIntent {public static final int SHARE_STATE_OFF=0;public Intent intent=new Intent();public void launchUrl(Activity activity,Uri uri){}public static class Builder {public Builder setShowTitle(boolean value){return this;}public Builder setShareState(int value){return this;}public CustomTabsIntent build(){return new CustomTabsIntent();}}}`,
    'com/getcapacitor/JSObject.java': `package com.getcapacitor;
import org.json.JSONObject;
public class JSObject extends JSONObject {public JSObject put(String key,boolean value){super.put(key,value);return this;}public JSObject put(String key,long value){super.put(key,value);return this;}public JSObject put(String key,int value){super.put(key,value);return this;}public JSObject put(String key,Object value){super.put(key,value);return this;}public static JSObject fromJSONObject(JSONObject object){JSObject value=new JSObject();for(String key:object.keySet())value.put(key,object.get(key));return value;}}`,
    'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
import ai.elizaresearch.alphaphone.SignInTestPorts;
public class PluginCall {private final JSObject input;public volatile JSObject result;public volatile String rejection;public PluginCall(JSObject data){input=data;}public JSObject getData(){return input;}public String getString(String key){return input.optString(key,null);}public String getString(String key,String fallback){return input.optString(key,fallback);}public Boolean getBoolean(String key,boolean fallback){return input.optBoolean(key,fallback);}public void resolve(){result=new JSObject();}public void resolve(JSObject value){result=value;SignInTestPorts.outcomes.add(value);}public void reject(String message){rejection=message;}public void reject(String message,String code){rejection=code;}}`,
    'com/getcapacitor/Plugin.java': `package com.getcapacitor;
import android.content.*;import android.app.Activity;import ai.elizaresearch.alphaphone.SignInTestPorts;
public class Plugin {private final Activity activity=new Activity();public void load(){}protected void handleOnNewIntent(Intent intent){}protected void handleOnPause(){}protected void handleOnResume(){}protected void handleOnDestroy(){}public Context getContext(){return activity;}public Activity getActivity(){return activity;}public void notifyListeners(String name,JSObject value,boolean retain){SignInTestPorts.outcomes.add(value);}}`,
    'com/getcapacitor/PluginMethod.java': 'package com.getcapacitor;public @interface PluginMethod {}',
    'com/getcapacitor/annotation/CapacitorPlugin.java': 'package com.getcapacitor.annotation;public @interface CapacitorPlugin {String name();}',
    'ai/elizaresearch/alphaphone/BuildConfig.java': 'package ai.elizaresearch.alphaphone;public class BuildConfig {public static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=false;}',
    'ai/elizaresearch/alphaphone/AlphaCredentialStore.java': `package ai.elizaresearch.alphaphone;
import android.content.Context;
public class AlphaCredentialStore {
  public boolean legacyCloudRecoveryEligible(){return false;}
  public boolean restoreLegacyCloudCredential(){throw new AssertionError("Unexpected legacy restore");}
  private final Runnable owner;
  public AlphaCredentialStore(Context context) {
    this(context, () -> {});
  }
  public AlphaCredentialStore(Context context, Runnable check) {
    owner = check;
  }
  public String readCredentialSlot(String key) {
    owner.run();
    String value = SignInTestPorts.values.get(key);
    if (key.equals(SignInTestPorts.pauseReadSlot)) {
      if (SignInTestPorts.pauseReadSkips > 0) SignInTestPorts.pauseReadSkips--;
      else {
        SignInTestPorts.pauseReadSlot = null;
        SignInTestPorts.checkpoint("read:" + key);
      }
    }
    return value;
  }
  public void writeCredentialSlot(String key, String value) {
    owner.run();
    if (key.equals(SignInTestPorts.failSlot)) {
      SignInTestPorts.checkpoint("failed-write:" + key);
      throw new IllegalStateException("storage unavailable");
    }
    synchronized (SignInTestPorts.values) {
      SignInTestPorts.values.put(key, value);
    }
    SignInTestPorts.checkpoint("write:" + key);
  }
  public boolean compareExchangeCredentialSlot(String key, String expected, String value) {
    owner.run();
    SignInTestPorts.checkpoint("cas:" + key);
    synchronized (SignInTestPorts.values) {
      if (!java.util.Objects.equals(SignInTestPorts.values.get(key), expected))
        return false;
      if (value == null)
        removeCredentialSlot(key);
      else
        writeCredentialSlot(key, value);
      return true;
    }
  }
  public void removeCredentialSlot(String key) {
    owner.run();
    if (key.equals(SignInTestPorts.failRemoveSlot)) {
      SignInTestPorts.checkpoint("failed-remove:" + key);
      throw new IllegalStateException("storage unavailable");
    }
    synchronized (SignInTestPorts.values) {
      SignInTestPorts.values.remove(key);
    }
    SignInTestPorts.checkpoint("remove:" + key);
  }
}`,
    'ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java': 'package ai.elizaresearch.alphaphone;public class AlphaLocalAgentPlugin {private static long intent;public static long reserveCredentialIntent(){return ++intent;}public static <T>T withCredentialRead(java.util.concurrent.Callable<T> read)throws Exception{return read.call();}public static void requireCredentialIntent(long value){if(value!=intent)throw new IllegalStateException("changed");}}',
  };
  files['android/content/pm/ResolveInfo.java']='package android.content.pm;public class ResolveInfo{public ServiceInfo serviceInfo=new ServiceInfo(),activityInfo=new ServiceInfo();public static class ServiceInfo{public boolean exported=true;public String packageName="fixture.browser";}}';
  files['android/os/CancellationSignal.java']='package android.os;public class CancellationSignal{public void cancel(){}}';
  files['android/util/Log.java']='package android.util;public class Log{public static int i(String tag,String value){return 0;}}';
  files['ai/eliza/auth/cloud/NativeGoogleCredential.java']='package ai.eliza.auth.cloud;public class NativeGoogleCredential{public interface Callback{void token(String token);void failure(String code);}public static void request(android.app.Activity activity,String client,String nonce,android.os.CancellationSignal signal,Callback callback){throw new AssertionError("Unexpected native Google picker");}public static void clear(android.app.Activity activity,Runnable done){done.run();}}';
  const paths = [];
  for (const [name, source] of Object.entries(files)) { const path = join(root, name); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, source); paths.push(path); }
  return {paths, close: () => rmSync(root, {recursive: true, force: true})};
}
