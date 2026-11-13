/** Controlled JVM Android ports. Scheduling and reminder policy stay in the pinned engine. */
export const reminderPlatform = {
  'android/Manifest.java': `package android;
public final class Manifest { public static final class permission { public static final String POST_NOTIFICATIONS="POST_NOTIFICATIONS"; } }`,
  'android/R.java': `package android;
public final class R { public static final class drawable { public static final int ic_popup_reminder=1; } }`,
  'android/os/Build.java': `package android.os;
public final class Build { public static final class VERSION { public static final int SDK_INT=35; } }`,
  'android/os/SystemClock.java': `package android.os;
public final class SystemClock { public static long elapsedRealtime(){return 0;} }`,
  'android/content/pm/PackageManager.java': `package android.content.pm;
public final class PackageManager { public static final int PERMISSION_GRANTED=0; }`,
  'android/net/Uri.java': `package android.net;
public final class Uri {
 private final String text;
 private Uri(String text){this.text=text;}
 public static Uri parse(String text){return new Uri(text);}
 public String getScheme(){return java.net.URI.create(text).getScheme();}
 public String getQuery(){return java.net.URI.create(text).getQuery();}
 public String getFragment(){return java.net.URI.create(text).getFragment();}
 public String toString(){return text;}
}`,
  'android/content/Intent.java': `package android.content;
import android.net.Uri;
import java.util.HashMap;
import java.util.Map;
public final class Intent {
 public static final String ACTION_BOOT_COMPLETED="BOOT",ACTION_MY_PACKAGE_REPLACED="REPLACED",ACTION_TIME_CHANGED="TIME",ACTION_TIMEZONE_CHANGED="ZONE";
 public static final int FLAG_ACTIVITY_CLEAR_TOP=1,FLAG_ACTIVITY_SINGLE_TOP=2;
 private final Class<?> component;
 private final Map<String,String> extras=new HashMap<>();
 private String action;
 private Uri data;
 public Intent(Context context,Class<?> component){this.component=component;}
 public Intent(String action){this.component=null;this.action=action;}
 public Intent(Intent from){component=from.component;action=from.action;data=from.data;extras.putAll(from.extras);}
 public Intent setAction(String value){action=value;return this;}
 public String getAction(){return action;}
 public Intent setData(Uri value){data=value;return this;}
 public Uri getData(){return data;}
 public Intent addFlags(int flags){return this;}
 public Intent putExtra(String name,String value){extras.put(name,value);return this;}
 public String getStringExtra(String name){return extras.get(name);}
 public String identity(){return component+"|"+action+"|"+data;}
}`,
  'android/content/BroadcastReceiver.java': `package android.content;
public abstract class BroadcastReceiver { public abstract void onReceive(Context context,Intent intent); }`,
  'android/content/SharedPreferences.java': `package android.content;
import java.util.Map;
import java.util.Set;
public interface SharedPreferences {
 Map<String,?> getAll(); String getString(String key,String fallback); boolean contains(String key);
 Set<String> getStringSet(String key,Set<String> fallback); int getInt(String key,int fallback); long getLong(String key,long fallback);
 float getFloat(String key,float fallback); boolean getBoolean(String key,boolean fallback);
 interface OnSharedPreferenceChangeListener {}
 void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener);
 void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener listener);
 Editor edit();
 interface Editor {
  Editor putString(String key,String value); Editor remove(String key); Editor clear(); boolean commit(); void apply();
  Editor putStringSet(String key,Set<String> value); Editor putInt(String key,int value); Editor putLong(String key,long value);
  Editor putFloat(String key,float value); Editor putBoolean(String key,boolean value);
 }
}`,
  'android/content/Context.java': `package android.content;
import android.app.*;
import java.io.File;
import java.util.*;
public final class Context {
 public static final int MODE_PRIVATE=0;
 public final AlarmManager alarms=new AlarmManager();
 public final NotificationManager notices=new NotificationManager();
 public final Map<String,String> secure=new HashMap<>();
 public final Map<String,Preferences> stores=new HashMap<>();
 public boolean permission=true, refuseSecure;
 public int boot=1;
 public Context getApplicationContext(){return this;}
 public boolean isDeviceProtectedStorage(){return false;}
 public File getDataDir(){return new File("/synthetic-alpha-reminder");}
 public String getPackageName(){return "ai.alphacompute.alphaphone";}
 public Context getContentResolver(){return this;}
 public int checkSelfPermission(String name){return permission?0:-1;}
 public <T> T getSystemService(Class<T> type){return type.cast(type==AlarmManager.class?alarms:notices);}
 public Preferences getSharedPreferences(String name,int mode){return stores.computeIfAbsent(name,key->new Preferences());}
 public void recreateProcess(){for(Preferences prefs:stores.values())prefs.reload();}

 public static final class Preferences implements SharedPreferences {
  private Map<String,Object> memory=new HashMap<>(),disk=new HashMap<>();
  public int refusalAt;
  public boolean commitButReportFailure;
  public Map<String,?> durable(){return new HashMap<>(disk);}
  public void reload(){memory=new HashMap<>(disk);}
  public Map<String,?> getAll(){return new HashMap<>(memory);}
  public String getString(String key,String fallback){return (String)memory.getOrDefault(key,fallback);}
  public boolean contains(String key){return memory.containsKey(key);}
  public int getInt(String key,int fallback){return (Integer)memory.getOrDefault(key,fallback);}
  public long getLong(String key,long fallback){return (Long)memory.getOrDefault(key,fallback);}
  public float getFloat(String key,float fallback){return (Float)memory.getOrDefault(key,fallback);}
  public boolean getBoolean(String key,boolean fallback){return (Boolean)memory.getOrDefault(key,fallback);}
  @SuppressWarnings("unchecked") public Set<String> getStringSet(String key,Set<String> fallback){return (Set<String>)memory.getOrDefault(key,fallback);}
  public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener unused){}
  public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener unused){}
  public Editor edit(){return new Editor(){
   private final Map<String,Object> changes=new HashMap<>();
   private final Set<String> removed=new HashSet<>();
   private boolean clear;
   private Editor put(String key,Object value){changes.put(key,value);removed.remove(key);return this;}
   public Editor putString(String key,String value){return value==null?remove(key):put(key,value);}
   public Editor putInt(String key,int value){return put(key,value);}
   public Editor putLong(String key,long value){return put(key,value);}
   public Editor putFloat(String key,float value){return put(key,value);}
   public Editor putBoolean(String key,boolean value){return put(key,value);}
   public Editor putStringSet(String key,Set<String> value){return put(key,value);}
   public Editor remove(String key){changes.remove(key);removed.add(key);return this;}
   public Editor clear(){clear=true;return this;}
   public boolean commit(){
    if(clear)memory.clear();
    removed.forEach(memory::remove);memory.putAll(changes);
    boolean refused=refusalAt>0&&--refusalAt==0;
    if(!refused||commitButReportFailure)disk=new HashMap<>(memory);
    return !refused;
   }
   public void apply(){commit();}
  };}
 }
}`,
  'android/provider/Settings.java': `package android.provider;
public final class Settings { public static final class Global {
 public static final String BOOT_COUNT="boot_count";
 public static int getInt(android.content.Context context,String name,int fallback){return context.boot;}
} }`,
  'android/app/Activity.java': `package android.app; public class Activity {}`,
  'android/app/PendingIntent.java': `package android.app;
import android.content.Context;
import android.content.Intent;
import java.util.*;
public final class PendingIntent {
 public static final int FLAG_IMMUTABLE=1,FLAG_UPDATE_CURRENT=2,FLAG_NO_CREATE=4;
 private static final Map<String,PendingIntent> registry=new HashMap<>();
 public final Intent intent;
 private final String identity;
 private PendingIntent(String identity,Intent intent){this.identity=identity;this.intent=new Intent(intent);}
 public static void reboot(){registry.clear();}
 private static PendingIntent get(String kind,Context context,int code,Intent intent,int flags){
  if((flags&FLAG_IMMUTABLE)==0)throw new AssertionError("Reminder routes are immutable");
  String key=kind+"|"+context.getPackageName()+"|"+code+"|"+intent.identity();
  if((flags&FLAG_NO_CREATE)!=0)return registry.get(key);
  return registry.computeIfAbsent(key,ignored->new PendingIntent(key,intent));
 }
 public static PendingIntent getActivity(Context c,int code,Intent intent,int flags){return get("activity",c,code,intent,flags);}
 public static PendingIntent getBroadcast(Context c,int code,Intent intent,int flags){return get("broadcast",c,code,intent,flags);}
 @Override public boolean equals(Object other){return other instanceof PendingIntent p&&identity.equals(p.identity);}
 @Override public int hashCode(){return identity.hashCode();}
}`,
  'android/app/AlarmManager.java': `package android.app;
import java.util.LinkedHashMap;
import java.util.Map;
public final class AlarmManager {
 public static final int RTC_WAKEUP=0;
 public final Map<PendingIntent,Long> live=new LinkedHashMap<>();
 public boolean refuse,exactAllowed,revokeExact;
 public java.util.function.Consumer<PendingIntent> beforeArm=unused->{};
 public int attempts,exactCalls,inexactCalls;
 public int exactType,inexactType;public long exactWhen,inexactWhen;public PendingIntent exactIntent,inexactIntent;
 public boolean canScheduleExactAlarms(){return exactAllowed;}
 public void setExactAndAllowWhileIdle(int type,long when,PendingIntent intent){exactCalls++;exactType=type;exactWhen=when;exactIntent=intent;arm(true,type,when,intent);}
 public void setAndAllowWhileIdle(int type,long when,PendingIntent intent){
  inexactCalls++;inexactType=type;inexactWhen=when;inexactIntent=intent;arm(false,type,when,intent);
 }
 private void arm(boolean exact,int type,long when,PendingIntent intent){
  if(type!=RTC_WAKEUP)throw new AssertionError("Expected RTC_WAKEUP");
  attempts++;
  if(exact&&revokeExact)throw new SecurityException("Synthetic exact-alarm capability revocation");
  beforeArm.accept(intent);
  if(refuse)throw new IllegalStateException("Synthetic AlarmManager refusal");
  live.put(intent,when);
 }
 public void cancel(PendingIntent intent){live.remove(intent);}
}`,
  'android/app/NotificationChannel.java': `package android.app;
public final class NotificationChannel {
 public final String id;
 private final int importance;
 private int visibility;
 public NotificationChannel(String id,String label,int importance){this.id=id;this.importance=importance;}
 public int getImportance(){return importance;}
 public boolean hasUserSetImportance(){return false;}
 public void setDescription(String value){}
 public void setLockscreenVisibility(int value){visibility=value;}
 public int getLockscreenVisibility(){return visibility;}
 public Object getSound(){return null;}
 public Object getAudioAttributes(){return null;}
 public void setSound(Object sound,Object attributes){}
 public boolean shouldVibrate(){return false;}
 public void enableVibration(boolean value){}
 public long[] getVibrationPattern(){return null;}
 public void setVibrationPattern(long[] value){}
 public void setBypassDnd(boolean value){}
}`,
  'android/app/Notification.java': `package android.app;
import android.content.Context;
import java.util.*;
public final class Notification {
 public static final int VISIBILITY_PRIVATE=0;
 public static final String CATEGORY_REMINDER="reminder";
 public final String channel;
 public String title,text,category;
 public int visibility;
 public boolean autoCancel,onlyAlertOnce;
 public Notification publicVersion;
 public PendingIntent contentIntent;
 public Action[] actions;
 private Notification(String channel){this.channel=channel;}
 public static final class BigTextStyle { public BigTextStyle bigText(String value){return this;} }
 public static final class Action {
  public final String title;
  public final PendingIntent actionIntent;
  public boolean authenticationRequired;
  private Action(String title,PendingIntent actionIntent){this.title=title;this.actionIntent=actionIntent;}
  public static final class Builder {
   private final Action action;
   public Builder(Object icon,String title,PendingIntent intent){action=new Action(title,intent);}
   public Builder setAuthenticationRequired(boolean required){action.authenticationRequired=required;return this;}
   public Action build(){return action;}
  }
 }
 public static final class Builder {
  private final Notification notice;
  private final List<Action> actions=new ArrayList<>();
  public Builder(Context c,String channel){notice=new Notification(channel);}
  public Builder setSmallIcon(int icon){return this;}
  public Builder setContentTitle(String value){notice.title=value;return this;}
  public Builder setContentText(String value){notice.text=value;return this;}
  public Builder setStyle(BigTextStyle style){return this;}
  public Builder setVisibility(int value){notice.visibility=value;return this;}
  public Builder setPublicVersion(Notification value){notice.publicVersion=value;return this;}
  public Builder setContentIntent(PendingIntent value){notice.contentIntent=value;return this;}
  public Builder setOnlyAlertOnce(boolean value){notice.onlyAlertOnce=value;return this;}
  public Builder setAutoCancel(boolean value){notice.autoCancel=value;return this;}
  public Builder setCategory(String value){notice.category=value;return this;}
  public Builder addAction(Action action){actions.add(action);return this;}
  public Notification build(){notice.actions=actions.toArray(Action[]::new);return notice;}
 }
}`,
  'android/service/notification/StatusBarNotification.java': `package android.service.notification;
import android.app.Notification;
public record StatusBarNotification(String tag,int id,Notification notification) {
 public String getTag(){return tag;} public int getId(){return id;} public Notification getNotification(){return notification;}
}`,
  'android/app/NotificationManager.java': `package android.app;
import java.util.*;
import java.util.function.Consumer;
import android.service.notification.StatusBarNotification;
public final class NotificationManager {
 public static final int IMPORTANCE_NONE=0,IMPORTANCE_DEFAULT=3,IMPORTANCE_HIGH=4;
 public final Map<String,StatusBarNotification> live=new LinkedHashMap<>();
 public final Map<String,NotificationChannel> channels=new HashMap<>();
 public Consumer<Notification> beforePost=unused->{};
 public boolean enabled=true,refuse;
 public int posts;
 public boolean areNotificationsEnabled(){return enabled;}
 public NotificationChannel getNotificationChannel(String id){return channels.get(id);}
 public void createNotificationChannel(NotificationChannel channel){channels.putIfAbsent(channel.id,channel);}
 public StatusBarNotification[] getActiveNotifications(){return live.values().toArray(StatusBarNotification[]::new);}
 public void notify(String tag,int id,Notification notice){
  beforePost.accept(notice);
  if(refuse)throw new IllegalStateException("Synthetic notification refusal");
  live.put(tag,new StatusBarNotification(tag,id,notice));posts++;
 }
 public void cancel(String tag,int id){live.remove(tag);}
}`,
  'ai/alphacompute/alphaphone/MainActivity.java': `package ai.alphacompute.alphaphone;
public final class MainActivity extends android.app.Activity {}`,
  'ai/alphacompute/alphaphone/AlphaCredentialStore.java': `package ai.alphacompute.alphaphone;
public final class AlphaCredentialStore {
 private final android.content.Context context;
 AlphaCredentialStore(android.content.Context context){this.context=context;}
 String readCredentialSlot(String slot){return context.secure.get(slot);}
 void writeCredentialSlot(String slot,String value)throws Exception{
  if(context.refuseSecure)throw new java.io.IOException("Synthetic secure-slot refusal");
  context.secure.put(slot,value);
 }
}`,
};
