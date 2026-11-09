import assert from 'node:assert/strict';

const member = (source, pattern) => {
  const value = source.match(pattern)?.[0];
  assert.ok(value, 'workflow notice source anchor');
  return value;
};

export function workflowNoticePlatform(host, alpha) {
  const start = host.indexOf(' @PluginMethod public void postWorkflow(');
  const end = host.indexOf(' private static String identity(', start);
  assert.ok(start >= 0 && end > start, 'workflow bridge method range');
  const methods = host.slice(start, end).replaceAll('@PluginMethod ', '');
  const shared = name => member(host, new RegExp('^ protected [^\\n]+ '+name+'\\([^\\n]+', 'm'));
  const product = name => member(alpha, new RegExp('^ @Override protected [^\\n]+ '+name+'\\([^\\n]+', 'm'));
  return {
    'ai/alphacompute/alphaphone/AlphaNotificationsPlugin.java': `package ai.alphacompute.alphaphone;
import android.content.Context;
import com.getcapacitor.*;
import ai.eliza.plugins.notifications.*;
abstract class FixtureNoticeHost {
 final ForegroundNoticeGate noticeGate=new ForegroundNoticeGate(new ForegroundNoticeGate.MainThread(){
  public boolean isCurrent(){return false;}
  public boolean post(Runnable work){work.run();return true;}
  public void remove(Runnable work){}
 },WorkflowPorts::requireForeground,WorkflowPorts.worker::add);
 ${member(host, /^ protected interface NoticeWork [^\n]+/m)}
 ${shared('noticeWork')}
 ${shared('requireNoticeForeground')}
 ${shared('poster')}
 ${shared('delivery')}
 protected abstract NoticeRoutes routes();
 protected abstract HostNoticePoster.Config posterConfig();
 protected abstract NoticeDelivery.Config deliveryConfig();
 protected abstract NoticeDelivery.Storage noticeStorage();
 protected abstract NoticeRoutes.Config routesConfig();
 Context getContext(){return WorkflowPorts.context;}
 void destroy(){noticeGate.destroy();}
 ${methods}
}
final class AlphaNotificationsPlugin extends FixtureNoticeHost {
 ${['noticeStorage','deliveryConfig','routesConfig','routes','posterConfig'].map(product).join('\n')}
}
`,
    'com/getcapacitor/JSObject.java': `package com.getcapacitor;
import org.json.JSONObject;
public class JSObject extends JSONObject {}
`,
    'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
import org.json.JSONObject;
public final class PluginCall {
 public final JSONObject input;
 public JSObject result;
 public boolean rejected;
 public PluginCall(JSONObject input){this.input=input;}
 public String getString(String key){return input.optString(key,null);}
 public JSONObject getObject(String key){return input.optJSONObject(key);}
 public void resolve(JSObject value){if(rejected||result!=null)throw new AssertionError("Repeated result");result=value;}
 public void reject(String failure){if(rejected||result!=null)throw new AssertionError("Repeated refusal");rejected=true;}
}
`,
    'android/Manifest.java': `package android;
public final class Manifest {public static final class permission {public static final String POST_NOTIFICATIONS="fixture";}}
`,
    'android/content/Context.java': `package android.content;
public class Context {
 private final android.app.NotificationManager manager=new android.app.NotificationManager();
 private final android.content.pm.PackageManager packages=new android.content.pm.PackageManager();
 public Context getApplicationContext(){return this;}
 public <T>T getSystemService(Class<T> type){return type.cast(manager);}
 public android.content.pm.PackageManager getPackageManager(){return packages;}
 public int checkSelfPermission(String permission){return 0;}
 public String getPackageName(){return "ai.alphacompute.alphaphone";}
}
`,
    'android/content/pm/PackageManager.java': `package android.content.pm;
public class PackageManager {
 public static final int PERMISSION_GRANTED=0;
 public android.content.Intent getLaunchIntentForPackage(String name){return new android.content.Intent();}
}
`,
    'android/content/Intent.java': `package android.content;
public class Intent {
 public String action;
 public android.net.Uri data;
 public Intent setAction(String value){action=value;return this;}
 public Intent setData(android.net.Uri value){data=value;return this;}
}
`,
    'android/net/Uri.java': `package android.net;
public final class Uri {
 private final String value; private Uri(String value){this.value=value;}
 public static Uri parse(String value){return new Uri(value);}
 public String toString(){return value;}
}
`,
    'android/os/Build.java': `package android.os;
public final class Build {public static final class VERSION {public static final int SDK_INT=37;}}
`,
    'android/os/SystemClock.java': `package android.os;
public final class SystemClock {
 private static long time;
 // The fixture supplies one active-list observation after notify, without a real wait.
 public static long elapsedRealtime(){return time+=2000;}
}
`,
    'android/app/PendingIntent.java': `package android.app;
import android.content.Context;
import android.content.Intent;
public final class PendingIntent {
 public static final int FLAG_IMMUTABLE=1,FLAG_UPDATE_CURRENT=2,FLAG_NO_CREATE=4;
 public final Intent intent;
 private PendingIntent(Intent intent){this.intent=intent;}
 public static PendingIntent getActivity(Context context,int code,Intent intent,int flags){return (flags&FLAG_NO_CREATE)!=0?null:new PendingIntent(intent);}
 public void cancel(){}
}
`,
    'android/app/NotificationChannel.java': `package android.app;
public final class NotificationChannel {
 final String id;final int importance;
 public NotificationChannel(String id,String name,int importance){this.id=id;this.importance=importance;}
 public void setDescription(String value){}
 public void setLockscreenVisibility(int value){}
 public int getImportance(){return importance;}
 public String getGroup(){return null;}
}
`,
    'android/app/NotificationChannelGroup.java': `package android.app;
public final class NotificationChannelGroup {public boolean isBlocked(){return false;}}
`,
    'android/app/Notification.java': `package android.app;
import android.content.Context;
import java.util.HashMap;
public final class Notification {
 public static final int VISIBILITY_PRIVATE=1,GROUP_ALERT_SUMMARY=1;
 public static final String CATEGORY_STATUS="status",CATEGORY_REMINDER="reminder",EXTRA_TITLE="title",EXTRA_TEXT="text",EXTRA_BIG_TEXT="big";
 public static final class Extras extends HashMap<String,CharSequence> {
  public CharSequence getCharSequence(String key,CharSequence fallback){return getOrDefault(key,fallback);}
 }
 public final Extras extras=new Extras();
 public final String channel;
 public int visibility;
 public long timeout;
 public PendingIntent tap;
 private Notification(String channel){this.channel=channel;}
 public String getChannelId(){return channel;}
 public static final class BigTextStyle {CharSequence value;public BigTextStyle bigText(CharSequence value){this.value=value;return this;}}
 public static final class Action {
  public static final class Builder {
   public Builder(Object icon,String title,PendingIntent tap){}
   public Builder setAuthenticationRequired(boolean value){return this;}
   public Action build(){return new Action();}
  }
 }
 public static final class Builder {
  private final Notification notice;
  public Builder(Context context,String channel){notice=new Notification(channel);}
  public Builder setSmallIcon(int value){return this;}
  public Builder setContentTitle(CharSequence value){notice.extras.put(EXTRA_TITLE,value);return this;}
  public Builder setContentText(CharSequence value){notice.extras.put(EXTRA_TEXT,value);return this;}
  public Builder setStyle(BigTextStyle value){notice.extras.put(EXTRA_BIG_TEXT,value.value);return this;}
  public Builder setVisibility(int value){notice.visibility=value;return this;}
  public Builder setPublicVersion(Notification value){return this;}
  public Builder setOnlyAlertOnce(boolean value){return this;}
  public Builder setAutoCancel(boolean value){return this;}
  public Builder setTimeoutAfter(long value){notice.timeout=value;return this;}
  public Builder setCategory(String value){return this;}
  public Builder setContentIntent(PendingIntent value){notice.tap=value;return this;}
  public Builder addAction(Action value){return this;}
  public Builder setGroup(String value){return this;}
  public Builder setGroupAlertBehavior(int value){return this;}
  public Notification build(){return notice;}
 }
}
`,
    'android/service/notification/StatusBarNotification.java': `package android.service.notification;
public final class StatusBarNotification {
 private final String tag;private final int id;private final android.app.Notification notice;
 public StatusBarNotification(String tag,int id,android.app.Notification notice){this.tag=tag;this.id=id;this.notice=notice;}
 public String getTag(){return tag;}
 public int getId(){return id;}
 public android.app.Notification getNotification(){return notice;}
}
`,
    'android/app/NotificationManager.java': `package android.app;
import android.service.notification.StatusBarNotification;
import java.util.HashMap;
public final class NotificationManager {
 public static final int IMPORTANCE_NONE=0,IMPORTANCE_DEFAULT=3,IMPORTANCE_HIGH=4;
 private final HashMap<String,NotificationChannel> channels=new HashMap<>();
 public boolean enabled=true;
 public String mode="visible";
 public Runnable onNotify=()->{};
 public int posts,cancels;
 public StatusBarNotification active,delayed;
 public void createNotificationChannel(NotificationChannel channel){channels.putIfAbsent(channel.id,channel);}
 public NotificationChannel getNotificationChannel(String id){return channels.get(id);}
 public NotificationChannelGroup getNotificationChannelGroup(String id){return null;}
 public boolean areNotificationsEnabled(){return enabled;}
 public StatusBarNotification[] getActiveNotifications(){return active==null?new StatusBarNotification[0]:new StatusBarNotification[]{active};}
 public void notify(String tag,int id,Notification notice){
  if("refused".equals(mode))throw new IllegalStateException("Synthetic manager refusal before posting");
  posts++;var row=new StatusBarNotification(tag,id,notice);
  if("late".equals(mode))delayed=row;else active=row;
  onNotify.run();
  if("lost".equals(mode))throw new IllegalStateException("Synthetic lost manager reply");
 }
 public void cancel(String tag,int id){cancels++;active=null;delayed=null;}
}
`,
  };
}
