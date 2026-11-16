import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {root} from './java.mjs';

const plugin = 'vendor/eliza/plugins/plugin-native-passwords/android/';
const passwordSource = plugin + 'src/main/java/ai/eliza/plugins/passwords/';
const storageSource = 'vendor/eliza/plugins/plugin-native-secure-store/android-nativeonly/src/main/java/ai/eliza/plugins/securestore/nativeonly/';
export const vaultSources = [
  ...['PasswordsPlugin', 'PasswordsConfig', 'PasswordVaultAccess', 'PasswordUnlock', 'PasswordRequests',
    'PasswordGenerator', 'PasswordEditorPolicy', 'PasswordFormPolicy', 'PasswordSurfaces'].map(name => passwordSource + name + '.java'),
  ...['PasswordVaultStore', 'PasswordVaultFrame', 'CredentialAccessSession', 'PasswordFacets'].map(name => storageSource + name + '.java'),
];
export const vaultResources = [
  'android/app/src/main/res/values/eliza_passwords.xml', plugin + 'src/main/res/values/eliza_passwords.xml',
];

function resourcePorts() {
  const xml = vaultResources.map(file => readFileSync(join(root, file), 'utf8'));
  let id = 0;
  const rows = {
    string:['vault_directory', 'key_alias', 'vault_aad', 'token_scheme', 'unlock_title', 'unlock_subtitle'],
    integer:['unlock_seconds'],
    bool:['allow_biometric', 'host_is_browser', 'bridge_accepts_secrets'],
  };
  const r = Object.entries(rows).map(([type, shortNames]) => {
    const fields = shortNames.map(short => {
      const name = 'eliza_passwords_' + short;
      const pattern = new RegExp('<' + type + ' name="' + name + '"[^>]*>([^<]*)</' + type + '>');
      const value = xml.map(source => pattern.exec(source)?.[1]).find(item => item !== undefined);
      assert.ok(value !== undefined, name);
      return {name, id:++id, type, value};
    });
    return [type, fields];
  });
  const definitions = r.map(([type, values]) => ' public static class ' + type + ' {\n' +
    values.map(({name, id}) => '  public static final int ' + name + '=' + id + ';').join('\n') + '\n }');
  const getters = r.map(([type, values]) => {
    const [kind, method] = {string:['String','getString'], integer:['int','getInteger'], bool:['boolean','getBoolean']}[type];
    const cases = values.map(({id, value}) => {
      if (type === 'integer') assert.match(value, /^\d+$/);
      if (type === 'bool') assert.match(value, /^(true|false)$/);
      return '   case ' + id + ' -> ' + (type === 'string' ? JSON.stringify(value) : value) + ';';
    }).join('\n');
    return ' public ' + kind + ' ' + method + '(int id) { return switch(id) {\n' + cases +
      '\n   default -> throw new AssertionError("Unexpected resource");\n }; }';
  });
  return {
    'ai/eliza/plugins/passwords/R.java': 'package ai.eliza.plugins.passwords;\npublic class R {\n' +
      definitions.join('\n') + '\n public static class array { public static final int eliza_passwords_trusted_browsers=100; }\n}',
    'android/content/res/Resources.java': 'package android.content.res;\npublic class Resources {\n' +
      getters.join('\n') + '\n public String[] getStringArray(int id) { if(id!=100) throw new AssertionError("Unexpected array"); return new String[0]; }\n}',
  };
}

export function vaultReadbackPlatform() {
  const temporary = mkdtempSync(join(tmpdir(), 'alpha-vault-readback-'));
  try {
    const ports = {
      ...resourcePorts(),
      'android/content/Context.java': `package android.content;
import java.io.File;
public class Context {
 public Context getApplicationContext(){return this;}
 public String getPackageName(){return "ai.alphacompute.alphaphone";}
 public android.content.res.Resources getResources(){return new android.content.res.Resources();}
 public File getNoBackupFilesDir(){return new File(System.getProperty("alpha.fixture.vault"));}
 public android.content.pm.PackageManager getPackageManager(){throw new AssertionError("Package authority is outside this replay");}
 public <T> T getSystemService(Class<T> type) {
  if (type==android.app.KeyguardManager.class) return type.cast(new android.app.KeyguardManager());
  return null;
 }
}`,
      'android/content/pm/PackageManager.java': `package android.content.pm;
public class PackageManager {
 public static final int GET_SIGNING_CERTIFICATES=1, CERT_INPUT_SHA256=2;
 public boolean hasSigningCertificate(String id,byte[] digest,int type){throw new AssertionError();}
 public PackageInfo getPackageInfo(String id,int flags){throw new AssertionError();}
}`,
      'android/content/pm/PackageInfo.java': 'package android.content.pm; public class PackageInfo { public SigningInfo signingInfo; }',
      'android/content/pm/SigningInfo.java': 'package android.content.pm; public class SigningInfo { public boolean hasMultipleSigners(){throw new AssertionError();} public Signature[] getSigningCertificateHistory(){throw new AssertionError();} }',
      'android/content/pm/Signature.java': 'package android.content.pm; public class Signature { public byte[] toByteArray(){throw new AssertionError();} }',
      'android/content/ComponentName.java': 'package android.content; public class ComponentName { public String getPackageName(){throw new AssertionError();} }',
      'android/content/ActivityNotFoundException.java': 'package android.content; public class ActivityNotFoundException extends RuntimeException {}',
      'android/content/Intent.java': 'package android.content; public class Intent { public Intent(String action){} public Intent(String action,android.net.Uri uri){} }',
      'android/net/Uri.java': 'package android.net; public class Uri { public static Uri parse(String value){throw new AssertionError();} }',
      'android/provider/Settings.java': 'package android.provider; public class Settings { public static final String ACTION_REQUEST_SET_AUTOFILL_SERVICE="autofill",ACTION_SETTINGS="settings"; }',
      'android/view/autofill/AutofillManager.java': 'package android.view.autofill; public class AutofillManager { public boolean isAutofillSupported(){throw new AssertionError();} public android.content.ComponentName getAutofillServiceComponentName(){throw new AssertionError();} }',
      'android/app/Activity.java': `package android.app;
public class Activity extends android.content.Context {
 private final Application app=new Application();
 public Application getApplication(){return app;}
 public void runOnUiThread(Runnable action){action.run();}
 public java.util.concurrent.Executor getMainExecutor(){return Runnable::run;}
 public boolean isFinishing(){return false;}
 public boolean isDestroyed(){return false;}
 public String getString(int id){return getResources().getString(id);}
 public void startActivity(android.content.Intent intent){throw new AssertionError("External dispatch");}
}`,
      'android/app/Application.java': `package android.app;
import android.os.Bundle;
public class Application {
 public interface ActivityLifecycleCallbacks {
  void onActivityCreated(Activity a,Bundle state);
  void onActivityStarted(Activity a);
  void onActivityResumed(Activity a);
  void onActivityPaused(Activity a);
  void onActivityStopped(Activity a);
  void onActivitySaveInstanceState(Activity a,Bundle state);
  void onActivityDestroyed(Activity a);
 }
 private ActivityLifecycleCallbacks pending;
 public void registerActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback){
  if(pending!=null) throw new AssertionError("Overlapping prompt"); pending=callback;
 }
 public void unregisterActivityLifecycleCallbacks(ActivityLifecycleCallbacks callback){
  if(pending!=callback) throw new AssertionError("Unowned prompt"); pending=null;
 }
}`,
      'android/app/KeyguardManager.java': 'package android.app; public class KeyguardManager { public boolean isDeviceSecure(){return true;} public boolean isDeviceLocked(){return false;} }',
      'android/os/Bundle.java': 'package android.os; public class Bundle {}',
      'android/os/Build.java': 'package android.os; public class Build { public static class VERSION { public static final int SDK_INT=36; } }',
      'android/os/SystemClock.java': 'package android.os; public class SystemClock { public static long now=1000; public static long elapsedRealtime(){return now;} }',
      'android/os/UserManager.java': 'package android.os; public class UserManager { public boolean isUserUnlocked(){throw new AssertionError();} }',
      'android/os/Looper.java': 'package android.os; public class Looper { private static final Looper MAIN=new Looper(); public static Looper myLooper(){return MAIN;} public static Looper getMainLooper(){return MAIN;} }',
      'android/os/Handler.java': 'package android.os; public class Handler { public Handler(Looper loop){} public void post(Runnable action){action.run();} }',
      'android/os/CancellationSignal.java': 'package android.os; public class CancellationSignal { public boolean cancelled; public void cancel(){cancelled=true;} }',
      'android/hardware/biometrics/BiometricManager.java': 'package android.hardware.biometrics; public class BiometricManager { public static class Authenticators { public static final int DEVICE_CREDENTIAL=1,BIOMETRIC_STRONG=2; } }',
      'android/hardware/biometrics/BiometricPrompt.java': `package android.hardware.biometrics;
import android.app.Activity;
import android.os.CancellationSignal;
import java.util.concurrent.Executor;
public class BiometricPrompt {
 public static final int BIOMETRIC_ERROR_USER_CANCELED=1,BIOMETRIC_ERROR_CANCELED=2;
 public static AuthenticationCallback pending;
 public static CancellationSignal signal;
 public static class AuthenticationResult {}
 public static class AuthenticationCallback {
  public void onAuthenticationSucceeded(AuthenticationResult result){}
  public void onAuthenticationError(int code,CharSequence message){}
  public void onAuthenticationFailed(){}
 }
 public static class Builder {
  public Builder(Activity activity){}
  public Builder setTitle(String text){return this;}
  public Builder setSubtitle(String text){return this;}
  public Builder setAllowedAuthenticators(int authenticators){return this;}
  public Builder setDeviceCredentialAllowed(boolean allowed){return this;}
  public BiometricPrompt build(){return new BiometricPrompt();}
 }
 public void authenticate(CancellationSignal cancellation,Executor executor,AuthenticationCallback callback){
  if(pending!=null)throw new AssertionError("A challenge already waits");
  pending=callback;
  signal=cancellation;
 }
 public static void deliverSuccess(){
  if(pending==null)throw new AssertionError("No challenge");
  AuthenticationCallback callback=pending; pending=null;
  callback.onAuthenticationSucceeded(new AuthenticationResult());
 }
}`,
      'android/security/keystore/KeyPermanentlyInvalidatedException.java': 'package android.security.keystore; public class KeyPermanentlyInvalidatedException extends java.security.InvalidKeyException {}',
      'android/security/keystore/UserNotAuthenticatedException.java': 'package android.security.keystore; public class UserNotAuthenticatedException extends java.security.InvalidKeyException {}',
      'android/security/keystore/KeyProperties.java': 'package android.security.keystore; public class KeyProperties { public static final int AUTH_DEVICE_CREDENTIAL=1,AUTH_BIOMETRIC_STRONG=2,PURPOSE_ENCRYPT=4,PURPOSE_DECRYPT=8; public static final String KEY_ALGORITHM_AES="AES",BLOCK_MODE_GCM="GCM",ENCRYPTION_PADDING_NONE="NoPadding"; }',
      'android/security/keystore/KeyInfo.java': `package android.security.keystore;
public class KeyInfo implements java.security.spec.KeySpec {
 private final int seconds;
 private final boolean biometric;
 public KeyInfo(int seconds, boolean biometric){this.seconds=seconds;this.biometric=biometric;}
 public boolean isUserAuthenticationRequired(){return true;}
 public int getUserAuthenticationValidityDurationSeconds(){return seconds;}
 public int getUserAuthenticationType(){return KeyProperties.AUTH_DEVICE_CREDENTIAL|(biometric?KeyProperties.AUTH_BIOMETRIC_STRONG:0);}
}`,
      'android/security/keystore/KeyGenParameterSpec.java': `package android.security.keystore;
public class KeyGenParameterSpec implements java.security.spec.AlgorithmParameterSpec {
 public static class Builder {
  public Builder(String name,int purpose){}
  public Builder setKeySize(int size){return this;}
  public Builder setBlockModes(String... modes){return this;}
  public Builder setEncryptionPaddings(String... padding){return this;}
  public Builder setRandomizedEncryptionRequired(boolean required){return this;}
  public Builder setUserAuthenticationRequired(boolean required){return this;}
  public Builder setUserAuthenticationParameters(int seconds,int authenticators){return this;}
  public Builder setUserAuthenticationValidityDurationSeconds(int seconds){return this;}
  public Builder setUnlockedDeviceRequired(boolean required){return this;}
  public KeyGenParameterSpec build(){throw new AssertionError("This fixture pre-seeds a synthetic key");}
 }
}`,
      'android/util/AtomicFile.java': `package android.util;
import java.io.*;
import java.nio.file.Files;
public class AtomicFile {
 private final File file;
 public AtomicFile(File file){this.file=file;}
 public File getBaseFile(){return file;}
 public byte[] readFully() throws IOException{return Files.readAllBytes(file.toPath());}
 public FileOutputStream startWrite(){throw new AssertionError("The replay performs no vault write");}
 public void finishWrite(FileOutputStream stream){throw new AssertionError();}
 public void failWrite(FileOutputStream stream){throw new AssertionError();}
 public void delete(){try { Files.deleteIfExists(file.toPath()); } catch(IOException failed){throw new AssertionError(failed);} }
}`,
      'com/getcapacitor/annotation/CapacitorPlugin.java': 'package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }',
      'com/getcapacitor/PluginMethod.java': 'package com.getcapacitor; public @interface PluginMethod {}',
      'com/getcapacitor/Plugin.java': `package com.getcapacitor;
public class Plugin {
 private final android.app.Activity activity=new android.app.Activity();
 public android.app.Activity getActivity(){return activity;}
 public android.content.Context getContext(){return activity;}
 protected void handleOnStop(){}
 protected void handleOnResume(){}
 protected void handleOnDestroy(){}
}`,
      'com/getcapacitor/JSObject.java': 'package com.getcapacitor; public class JSObject extends org.json.JSONObject { public int getInteger(String key,int value){return optInt(key,value);} public boolean getBoolean(String key,boolean value){return optBoolean(key,value);} }',
      'com/getcapacitor/JSArray.java': 'package com.getcapacitor; public class JSArray extends org.json.JSONArray {}',
      'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
public class PluginCall {
 public JSObject result;
 public String rejection;
 private final JSObject data=new JSObject();
 public JSObject getData(){return data;}
 public String getString(String key){return data.optString(key,null);}
 public String getString(String key,String value){return data.optString(key,value);}
 public JSObject getObject(String key){throw new AssertionError();}
 public JSArray getArray(String key,JSArray value){throw new AssertionError();}
 public void resolve(JSObject value){ if(result!=null||rejection!=null)throw new AssertionError("Duplicate reply"); result=value; }
 public void reject(String message,String code){ if(result!=null||rejection!=null)throw new AssertionError("Duplicate reply"); rejection=code; }
}`,
      'ai/eliza/plugins/passwords/PasswordEditor.java': `package ai.eliza.plugins.passwords;
import android.app.Activity;
public class PasswordEditor {
 public static class Busy extends RuntimeException {}
 public interface Result { void saved(String id,long revision); void cancelled(); }
 public static void dismiss(){}
 public static void dismiss(Activity owner){}
 public static void open(Activity owner,PasswordVaultAccess access,long ticket,PasswordEditorPolicy.Request request,Result result){throw new AssertionError();}
}`,
      'ai/eliza/plugins/passwords/PasswordSheet.java': 'package ai.eliza.plugins.passwords; public class PasswordSheet { public static String bindingLabel(android.content.Context context,String facet){return facet;} }',
      'ai/eliza/plugins/passwords/SecretSurfaces.java': `package ai.eliza.plugins.passwords;
public class SecretSurfaces {
 public static final int REVEAL_MILLIS=1,CLIPBOARD_MILLIS=1;
 public static void reveal(android.app.Activity a,String label,String value){throw new AssertionError();}
 public static void copy(android.app.Activity a,String value){throw new AssertionError();}
 public static void dismiss(){}
 public static void resume(android.app.Activity a){}
}`,
    };
    const paths = Object.entries(ports).map(([name, source]) => {
      const file = join(temporary, name);
      mkdirSync(dirname(file), {recursive:true});
      writeFileSync(file, source);
      return file;
    });
    return {directory:temporary, paths, close:() => rmSync(temporary, {recursive:true, force:true})};
  } catch (error) {
    rmSync(temporary, {recursive:true, force:true});
    throw error;
  }
}
