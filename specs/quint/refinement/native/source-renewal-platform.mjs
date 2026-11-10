import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {app,root} from './java.mjs';

export const renewalBridge=app+'AlphaHostedResultsPlugin.java';
export const renewalOwner='plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/NoticeOwner.java';

function exact(text, first, last) {
  const start=text.indexOf(first), end=text.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,`renewal source anchors ${first}, ${last}`);
  return text.slice(start,end).replaceAll('@PluginMethod ','');
}

export function sourceRenewalPlatform(temporary) {
  const bridge=readFileSync(join(root,renewalBridge),'utf8');
  const files={
    'ai/elizaresearch/alphaphone/AlphaHostedResultsPlugin.java':`package ai.elizaresearch.alphaphone;
import android.content.Intent;
import com.getcapacitor.*;
import java.util.concurrent.*;
final class AlphaHostedResultsPlugin extends Plugin {
${exact(bridge,' static final String CHANNEL=', ' private void channel()')}
${exact(bridge,' private void sourceForeground()', ' @PluginMethod public void nativeSourceIdentity')}
${exact(bridge,' @PluginMethod public void pendingSourceRenewal(', ' @Override public void load()')}
${exact(bridge,' @Override protected void handleOnNewIntent(', ' /** The page reports')}
${exact(bridge,' @Override protected void handleOnDestroy()', '\n}')}
}`,
    'ai/elizaresearch/alphaphone/FixtureRenewalPorts.java':`package ai.elizaresearch.alphaphone;
import android.content.Context;
import org.json.*;
final class MainActivity {}
final class R {static final class drawable {static final int notification_icon=1;}}
final class System {static long currentTimeMillis(){return SourceRenewalTraces.now;}}
final class AlphaCredentialStore {
 final Context context;
 AlphaCredentialStore(Context context){this.context=context;}
 String readCredentialSlot(String slot){return SourceRenewalTraces.read(context,slot);}
 void writeCredentialSlot(String slot,String value)throws Exception{SourceRenewalTraces.write(context,slot,value);}
}
final class NativeDigestSources {
 static final class SourceChanged extends SecurityException {SourceChanged(String reason){super(reason);}}
}
final class NativeDigestHost {
 final Context context;
 NativeDigestHost(Context context){this.context=context;}
 JSONObject read(JSONObject input)throws Exception{return SourceRenewalTraces.describe(context,input);}
}
final class HostedDelivery {
 HostedResultNotices notices;
 static HostedDelivery get(Context context){throw new AssertionError("Ordinary hosted result lane is outside the renewal fixture");}
}`,
    'android/Manifest.java':'package android;public final class Manifest {public static final class permission {public static final String POST_NOTIFICATIONS="notify";}}',
    'android/content/pm/PackageManager.java':'package android.content.pm;public final class PackageManager {public static final int PERMISSION_GRANTED=0;}',
    'android/provider/Settings.java':'package android.provider;public final class Settings {}',
    'android/os/Build.java':'package android.os;public final class Build {public static final class VERSION {public static final int SDK_INT=36;}}',
    'android/os/Looper.java':'package android.os;public final class Looper {public static Looper getMainLooper(){return new Looper();}}',
    'android/os/Handler.java':`package android.os;
public final class Handler {
 public Handler(Looper looper){}
 public boolean post(Runnable work){work.run();return true;}
 public void removeCallbacks(Runnable work){}
}`,
    'android/app/KeyguardManager.java':'package android.app;public final class KeyguardManager {public boolean locked;public boolean isDeviceLocked(){return locked;}}',
    'android/app/Activity.java':`package android.app;
public final class Activity {
 public boolean focused=true,destroyed;
 public boolean hasWindowFocus(){return focused;}
 public boolean isFinishing(){return false;}
 public boolean isDestroyed(){return destroyed;}
}`,
    'android/content/Context.java':`package android.content;
import android.app.*;
public final class Context {
 public final NotificationManager manager=new NotificationManager();
 public final KeyguardManager keyguard=new KeyguardManager();
 public Context getApplicationContext(){return this;}
 public int checkSelfPermission(String permission){if(!permission.equals("notify"))throw new AssertionError(permission);return 0;}
 public <T>T getSystemService(Class<T> kind){
  if(kind==NotificationManager.class)return kind.cast(manager);
  if(kind==KeyguardManager.class)return kind.cast(keyguard);
  throw new AssertionError(kind);
 }
}`,
    'android/net/Uri.java':`package android.net;
public record Uri(String value) {
 public static Uri parse(String value){return new Uri(value);}
 @Override public String toString(){return value;}
}`,
    'android/content/Intent.java':`package android.content;
import android.net.Uri;
public final class Intent {
 public static final int FLAG_ACTIVITY_CLEAR_TOP=1,FLAG_ACTIVITY_SINGLE_TOP=2;
 public final Class<?> component;
 public String action;
 public Uri data;
 public int flags;
 public Intent(Context context,Class<?> component){this.component=component;}
 public Intent(Intent other){component=other.component;action=other.action;data=other.data;flags=other.flags;}
 public String getAction(){return action;}
 public Uri getData(){return data;}
 public Intent setAction(String value){action=value;return this;}
 public Intent setData(Uri value){data=value;return this;}
 public Intent addFlags(int value){flags|=value;return this;}
}`,
    'android/app/PendingIntent.java':`package android.app;
import android.content.*;
public final class PendingIntent {
 public static final int FLAG_IMMUTABLE=1,FLAG_UPDATE_CURRENT=2,FLAG_NO_CREATE=4;
 public final int code;
 public final Intent intent;
 public boolean cancelled;
 private PendingIntent(int code,Intent intent){this.code=code;this.intent=new Intent(intent);}
 public static PendingIntent getActivity(Context context,int code,Intent intent,int flags){
  if((flags&FLAG_IMMUTABLE)==0)throw new AssertionError("Notice tap must be immutable");
  return context.manager.tap(code,intent,(flags&FLAG_NO_CREATE)!=0);
 }
 static PendingIntent fresh(int code,Intent intent){return new PendingIntent(code,intent);}
 public void cancel(){cancelled=true;}
}`,
    'android/app/NotificationChannel.java':`package android.app;
public final class NotificationChannel {
 final String id;final int importance;
 public NotificationChannel(String id,String name,int importance){this.id=id;this.importance=importance;}
 public void setDescription(String value){}
 public void setLockscreenVisibility(int value){}
 public int getImportance(){return importance;}
}`,
    'android/app/Notification.java':`package android.app;
import android.content.Context;
import java.util.*;
public final class Notification {
 public static final int GROUP_ALERT_SUMMARY=1;
 public static final int VISIBILITY_PRIVATE=1;
 public static final String CATEGORY_STATUS="status",CATEGORY_REMINDER="reminder";
 public String channel,title,text,category;
 public int visibility,icon;
 public long timeout;
 public boolean onlyOnce,autoCancel;
 public PendingIntent tap;
 public Notification publicNotice;
 public final List<Action> actions=new ArrayList<>();
 public record Action(String title,PendingIntent tap,boolean authenticated) {
  public static final class Builder {
   final String title;final PendingIntent tap;boolean authenticated;
   public Builder(Object icon,String title,PendingIntent tap){this.title=title;this.tap=tap;}
   public Builder setAuthenticationRequired(boolean value){authenticated=value;return this;}
   public Action build(){return new Action(title,tap,authenticated);}
  }
 }
 public static final class Builder {
  final Notification n=new Notification();
  public Builder(Context context,String channel){n.channel=channel;}
  public Builder setSmallIcon(int value){n.icon=value;return this;}
  public Builder setContentTitle(String value){n.title=value;return this;}
  public Builder setContentText(String value){n.text=value;return this;}
  public Builder setVisibility(int value){n.visibility=value;return this;}
  public Builder setPublicVersion(Notification value){n.publicNotice=value;return this;}
  public Builder setContentIntent(PendingIntent value){n.tap=value;return this;}
  public Builder addAction(Action value){n.actions.add(value);return this;}
  public Builder setOnlyAlertOnce(boolean value){n.onlyOnce=value;return this;}
  public Builder setGroup(String group){return this;}
  public Builder setGroupAlertBehavior(int behavior){return this;}
  public Builder setAutoCancel(boolean value){n.autoCancel=value;return this;}
  public Builder setTimeoutAfter(long value){n.timeout=value;return this;}
  public Builder setCategory(String value){n.category=value;return this;}
  public Notification build(){return n;}
 }
}`,
    'android/service/notification/StatusBarNotification.java':`package android.service.notification;
public record StatusBarNotification(String tag) {public String getTag(){return tag;}}`,
    'android/app/NotificationManager.java':`package android.app;
import android.content.Intent;
import android.service.notification.StatusBarNotification;
import java.util.*;
public final class NotificationManager {
 public static final int IMPORTANCE_NONE=0,IMPORTANCE_DEFAULT=3;
 private final Map<String,NotificationChannel> channels=new LinkedHashMap<>();
 public final Map<String,Notification> active=new LinkedHashMap<>();
 public final Map<String,PendingIntent> taps=new LinkedHashMap<>();
 public String gate="allowed";
 public int reads,posts,cancels;
 public boolean refusePost;
 public void createNotificationChannel(NotificationChannel c){channels.putIfAbsent(c.id,c);}
 public NotificationChannel getNotificationChannel(String id){return channels.get(id);}
 public boolean areNotificationsEnabled(){return gate.equals("allowed")||gate.equals("flip")&&reads++%2==0;}
 public StatusBarNotification[] getActiveNotifications(){return active.keySet().stream().map(StatusBarNotification::new).toArray(StatusBarNotification[]::new);}
 public PendingIntent tap(int code,Intent intent,boolean existing){
  String key=code+"|"+intent.component.getName()+"|"+intent.action+"|"+intent.data;
  PendingIntent old=taps.get(key);
  if(old!=null&&!old.cancelled)return old;
  if(existing)return null;
  PendingIntent fresh=PendingIntent.fresh(code,intent);taps.put(key,fresh);return fresh;
 }
 public void notify(String tag,int id,Notification notice){
  if(id!=0)throw new AssertionError("Exact notice id");
  ai.elizaresearch.alphaphone.SourceRenewalTraces.beforeNotify(tag,notice);
  if(refusePost)throw new IllegalStateException("Synthetic notify refusal");
  posts++;active.put(tag,notice);
 }
 public void cancel(String tag,int id){if(id!=0)throw new AssertionError("Exact notice id");cancels++;active.remove(tag);}
}`,
    'com/getcapacitor/Plugin.java':`package com.getcapacitor;
import android.content.*;
import android.app.Activity;
public class Plugin {
 private Context context;
 private final Activity activity=new Activity();
 public int wakeups;
 public void attach(Context value){context=value;}
 public Context getContext(){return context;}
 public Activity getActivity(){return activity;}
 public void notifyListeners(String name,JSObject body,boolean retained){
  if(!name.equals("renewSource")||!body.isEmpty()||!retained)throw new AssertionError("Only an empty retained renewal wakeup");
  wakeups++;
 }
 protected void handleOnNewIntent(Intent intent){}
 protected void handleOnResume(){}
 protected void handleOnPause(){}
 protected void handleOnDestroy(){activity.destroyed=true;}
}`,
    'com/getcapacitor/annotation/PluginAnnotation.java':'package com.getcapacitor.annotation;public @interface PluginAnnotation {}',
    'com/getcapacitor/JSObject.java':`package com.getcapacitor;
public final class JSObject extends org.json.JSONObject {
 public JSObject(){}
 public JSObject(String value){super(value);}
}`,
    'com/getcapacitor/PluginCall.java':`package com.getcapacitor;
import org.json.JSONObject;
public final class PluginCall {
 final JSONObject data;
 public JSObject result;
 public String rejection;
 public boolean answered;
 public PluginCall(JSONObject value){data=value;}
 public String getString(String key,String fallback){return data.optString(key,fallback);}
 public Boolean getBoolean(String key,Boolean fallback){return data.opt(key) instanceof Boolean?(Boolean)data.opt(key):fallback;}
 public void resolve(){resolve(new JSObject());}
 public void resolve(JSObject value){answer();result=value;}
 public void reject(String reason){answer();rejection=reason;}
 private void answer(){if(answered)throw new AssertionError("Duplicate bridge answer");answered=true;}
}`,
  };
  return Object.entries(files).map(([name,body])=>{
    const file=join(temporary,'driver',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);return file;
  });
}
