import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {app,root} from './java.mjs';

export const gmailProduct=['GmailBackground','GmailDeliveryWorker','AlphaGmailPlugin','CloudDeployment','LocalAgentProviderAdmission','PluginWorkers'].map(name=>app+name+'.java');
const notificationSource='plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/';
export const gmailShared=['MailBackgroundDelivery','MailHistoryReconciliation'].map(name=>notificationSource+name+'.java');
export const providerAdmission='plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java';

export function gmailBackgroundPlatform() {
  const directory=mkdtempSync(join(tmpdir(),'quint-gmail-background-'));
  const close=()=>rmSync(directory,{recursive:true,force:true});
  try {
    const provider=readFileSync(join(root,'vendor/eliza',providerAdmission),'utf8');
    const start=provider.indexOf(' private static String cloudId(Object value)');
    const end=provider.indexOf(' private static JSONObject cloudIdentity(JSONObject selected)',start);
    assert.ok(start>=0&&end>start&&provider.slice(start,end).includes('verifiedCloudIdentity'));
    const files={
      'android/content/Context.java':`package android.content;
public class Context {
 public final android.app.KeyguardManager keyguard=new android.app.KeyguardManager();
 public Context getApplicationContext(){return this;}
 public String getPackageName(){return "fixture.alpha";}
 public <T>T getSystemService(Class<T> type){return type.cast(keyguard);}
}`,
      'android/content/Intent.java':`package android.content;
public final class Intent {
 public Object data;
 public Intent(){}
 public Intent(String action){}
 public Intent putExtra(String key,String value){return this;}
 public Intent setData(Object value){data=value;return this;}
}`,
      'android/app/Activity.java':`package android.app;
public class Activity extends android.content.Context {
 public boolean focused=true,finishing,destroyed;
 public boolean isFinishing(){return finishing;}
 public boolean isDestroyed(){return destroyed;}
 public boolean hasWindowFocus(){return focused;}
 public android.content.Intent getIntent(){return new android.content.Intent();}
 public void startActivity(android.content.Intent intent){throw new AssertionError("Android launch is closed");}
}`,
      'android/app/KeyguardManager.java':`package android.app;
public final class KeyguardManager {public boolean locked;public boolean isDeviceLocked(){return locked;}}`,
      'android/provider/Settings.java':`package android.provider;
public final class Settings {
 public static final String ACTION_CHANNEL_NOTIFICATION_SETTINGS="settings",EXTRA_APP_PACKAGE="app",EXTRA_CHANNEL_ID="channel";
}`,
      'androidx/annotation/NonNull.java':'package androidx.annotation;public @interface NonNull {}',
      'androidx/work/Data.java':`package androidx.work;
public record Data(java.util.Map<String,String> values) {
 public String getString(String key){return values.get(key);}
 public static final class Builder {
  private final java.util.Map<String,String> data=new java.util.HashMap<>();
  public Builder putString(String key,String value){data.put(key,value);return this;}
  public Data build(){return new Data(java.util.Map.copyOf(data));}
 }
}`,
      'androidx/work/Worker.java':`package androidx.work;
import android.content.Context;
public abstract class Worker {
 private final Context context;
 private final WorkerParameters parameters;
 public Worker(Context context,WorkerParameters parameters){this.context=context;this.parameters=parameters;}
 public final Context getApplicationContext(){return context;}
 public final Data getInputData(){return parameters.data;}
 public final boolean isStopped(){return parameters.stopped;}
 public abstract Result doWork();
 public record Result(String status) {
  public static Result failure(){return new Result("failure");}
  public static Result retry(){return new Result("retry");}
  public static Result success(){return new Result("success");}
 }
}`,
      'androidx/work/WorkerParameters.java':`package androidx.work;
public final class WorkerParameters {
 public final Data data;
 public volatile boolean stopped;
 public WorkerParameters(Data data){this.data=data;}
}`,
      'androidx/work/Constraints.java':`package androidx.work;
public record Constraints(NetworkType network) {
 public static final class Builder {
  private NetworkType network;
  public Builder setRequiredNetworkType(NetworkType value){network=value;return this;}
  public Constraints build(){return new Constraints(network);}
 }
}`,
      'androidx/work/NetworkType.java':'package androidx.work;public enum NetworkType {CONNECTED}',
      'androidx/work/BackoffPolicy.java':'package androidx.work;public enum BackoffPolicy {EXPONENTIAL}',
      'androidx/work/ExistingWorkPolicy.java':'package androidx.work;public enum ExistingWorkPolicy {KEEP}',
      'androidx/work/ExistingPeriodicWorkPolicy.java':'package androidx.work;public enum ExistingPeriodicWorkPolicy {UPDATE}',
      'androidx/work/WorkManager.java':`package androidx.work;
import android.content.Context;
import ai.alphacompute.alphaphone.GmailBackgroundTraces;
public final class WorkManager {
 private static final WorkManager INSTANCE=new WorkManager();
 public static WorkManager getInstance(Context context){return INSTANCE;}
 public void enqueueUniquePeriodicWork(String name,ExistingPeriodicWorkPolicy policy,PeriodicWorkRequest work){
  GmailBackgroundTraces.schedule(name,policy.name(),work.fields,work.interval);
 }
 public void enqueueUniqueWork(String name,ExistingWorkPolicy policy,OneTimeWorkRequest work){
  GmailBackgroundTraces.schedule(name,policy.name(),work.fields,0);
 }
 public void cancelUniqueWork(String name){GmailBackgroundTraces.cancelWork(name);}
}`,
      'androidx/work/WorkFields.java':`package androidx.work;
public final class WorkFields {
 public final Class<?> worker;
 public Data data;
 public Constraints constraints;
 public BackoffPolicy backoff;
 public long delay;
 WorkFields(Class<?> worker){this.worker=worker;}
}`,
      ...Object.fromEntries(['Periodic','OneTime'].map(mode=>[`androidx/work/${mode}WorkRequest.java`,`package androidx.work;
import java.util.concurrent.TimeUnit;
public final class ${mode}WorkRequest {
 public final WorkFields fields;
 ${mode==='Periodic'?'public final long interval;':''}
 private ${mode}WorkRequest(Builder builder){fields=builder.fields;${mode==='Periodic'?'interval=builder.interval;':''}}
 public static final class Builder {
  private final WorkFields fields;
  ${mode==='Periodic'?'private final long interval;':''}
  public Builder(Class<?> worker${mode==='Periodic'?',long interval,TimeUnit unit':''}){
   fields=new WorkFields(worker);${mode==='Periodic'?'this.interval=unit.toSeconds(interval);':''}
  }
  public Builder setInputData(Data value){fields.data=value;return this;}
  public Builder setConstraints(Constraints value){fields.constraints=value;return this;}
  public Builder setBackoffCriteria(BackoffPolicy policy,long value,TimeUnit unit){fields.backoff=policy;fields.delay=unit.toSeconds(value);return this;}
  public ${mode}WorkRequest build(){return new ${mode}WorkRequest(this);}
 }
}`])),
      'com/getcapacitor/Plugin.java':`package com.getcapacitor;
public abstract class Plugin {
 public final android.app.Activity activity=new android.app.Activity();
 public int pendingEvents;
 public android.app.Activity getActivity(){return activity;}
 public android.content.Context getContext(){return activity;}
 protected void notifyListeners(String event,JSObject value,boolean retained){
  if(!event.equals("pendingMail")||value.length()!=0||!retained)throw new AssertionError("Unexpected bridge event");
  pendingEvents++;
 }
 public void load(){}
 protected void handleOnNewIntent(android.content.Intent intent){}
 protected void handleOnResume(){}
 protected void handleOnPause(){}
 protected void handleOnDestroy(){activity.destroyed=true;}
}`,
      'com/getcapacitor/annotation/CapacitorPlugin.java':'package com.getcapacitor.annotation;public @interface CapacitorPlugin {String name();}',
      'com/getcapacitor/PluginMethod.java':'package com.getcapacitor;public @interface PluginMethod {}',
      'com/getcapacitor/JSObject.java':`package com.getcapacitor;
public final class JSObject extends org.json.JSONObject {public JSObject(){}public JSObject(String value){super(value);}}`,
      'com/getcapacitor/PluginCall.java':`package com.getcapacitor;
import java.util.concurrent.*;
public final class PluginCall {
 private final org.json.JSONObject input;
 private final CountDownLatch answered=new CountDownLatch(1);
 public JSObject result;
 public String rejection;
 public PluginCall(org.json.JSONObject input){this.input=input;}
 public String getString(String key){return input.optString(key,null);}
 public void resolve(){resolve(new JSObject());}
 public synchronized void resolve(JSObject value){if(answered.getCount()==0)throw new AssertionError("Duplicate response");result=value;answered.countDown();}
 public synchronized void reject(String reason){if(answered.getCount()==0)throw new AssertionError("Duplicate response");rejection=reason;answered.countDown();}
 public void await()throws Exception{if(!answered.await(5,TimeUnit.SECONDS))throw new AssertionError("Closed Gmail call unanswered");}
}`,
      'ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java':`package ai.eliza.plugins.agent.runtime;
import java.util.UUID;
import org.json.JSONObject;
public class NativeProviderAdmission {
${provider.slice(start,end)}
}`,
      'ai/eliza/plugins/notifications/MailNoticePoster.java':`package ai.eliza.plugins.notifications;
import android.content.Context;
import android.content.Intent;
import ai.alphacompute.alphaphone.GmailBackgroundTraces;
public final class MailNoticePoster implements MailBackgroundDelivery.Notices {
 public static final class Config {
  public final String channel,name,description,action,open,ask,tag,title,text,publicTitle,publicText,askLabel;
  public final int icon;
  public final Class<?> activity;
  public Config(String channel,String name,String description,String action,String open,String ask,String tag,
    int icon,String title,String text,String publicTitle,String publicText,String askLabel,Class<?> activity) {
   this.channel=channel;this.name=name;this.description=description;this.action=action;this.open=open;
   this.ask=ask;this.tag=tag;this.icon=icon;this.title=title;this.text=text;this.publicTitle=publicTitle;
   this.publicText=publicText;this.askLabel=askLabel;this.activity=activity;
  }
 }
 public static final class Tap {public String key;public boolean question;}
 public MailNoticePoster(Context context,Config config){GmailBackgroundTraces.configurePoster(config);}
 public boolean allowed(){return GmailBackgroundTraces.allowed;}
 public boolean active(String key){return GmailBackgroundTraces.active(key);}
 public void post(String key){GmailBackgroundTraces.post(key);}
 public void cancel(String key){GmailBackgroundTraces.cancel(key);}
 public void cancelAll(){GmailBackgroundTraces.cancelAll();}
 public Tap tap(Intent intent){if(intent==null||intent.data==null)return null;throw new AssertionError("Intent delivery outside this replay");}
}`,
      'ai/alphacompute/alphaphone/GmailPorts.java':`package ai.alphacompute.alphaphone;
import android.content.Context;
final class AlphaCredentialStore {
 interface CloudChangeObserver {void changed()throws Exception;}
 static CloudChangeObserver observer;
 static void observeCloudChanges(CloudChangeObserver value){observer=value;}
 AlphaCredentialStore(Context context){}
 String readCredentialSlot(String key)throws Exception{return GmailBackgroundTraces.read(key);}
 void writeCredentialSlot(String key,String value)throws Exception{GmailBackgroundTraces.write(key,value);}
 void removeCredentialSlot(String key)throws Exception{GmailBackgroundTraces.remove(key);}
}
final class AlphaLocalAgentPlugin {
 static final Object LIFECYCLE=new Object();
 static Object credentialLifecycleLock(){return LIFECYCLE;}
}
final class AlphaDataReset {
 static final AlphaDataReset RESET=new AlphaDataReset();
 boolean pending(Context context){return GmailBackgroundTraces.reset;}
}
final class MainActivity extends android.app.Activity {}
final class R {static final class drawable {static final int notification_icon=1;}}
`,
    };
    const paths=Object.entries(files).map(([name,source])=>{
      const path=join(directory,name);
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(path,source);
      return path;
    });
    return {paths,close};
  }catch(error){close();throw error;}
}
