import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';

/** Deterministic command delivery, Android PendingIntent identity, and plugin reply ports. */
export function navigationServicePlatform(){
 const directory=mkdtempSync(join(tmpdir(),'quint-navigation-service-'));
 const files={
  'androidx/annotation/Nullable.java':'package androidx.annotation;public @interface Nullable {}',
  'android/Manifest.java':`package android;public class Manifest {public static class permission {
   public static final String ACCESS_FINE_LOCATION="fine", ACCESS_COARSE_LOCATION="coarse";}}`,
  'android/R.java':'package android;public class R {public static class drawable {public static final int ic_menu_directions=1;}}',
  'ai/elizaresearch/alphaphone/R.java':'package ai.elizaresearch.alphaphone;public class R {public static class drawable {public static final int ic_navigation=1;}}',
  'android/os/IBinder.java':'package android.os;public interface IBinder {}',
  'android/os/SystemClock.java':'package android.os;public class SystemClock {public static long elapsedRealtime(){return 1000;}}',
  'android/os/Build.java':`package android.os;public class Build {
   public static class VERSION {public static final int SDK_INT=36;}
   public static class VERSION_CODES {public static final int Q=29;}
  }`,
  'android/util/Base64.java':`package android.util;public class Base64 {
   public static final int NO_WRAP=2;
   public static String encodeToString(byte[] value,int flags){throw new AssertionError("Unexpected regional transport");}
  }`,
  'android/net/Uri.java':`package android.net;public record Uri(String value) {
   public static Uri parse(String value){return new Uri(value);}
  }`,
  'android/content/ComponentName.java':`package android.content;
   public record ComponentName(String packageName,String className) {
    public ComponentName(Context context,Class<?> type){this(context.getPackageName(),type.getName());}
   }`,
  'android/content/Intent.java':`package android.content;
   import java.util.HashMap;
   import android.net.Uri;
   public class Intent {
    public static final int FLAG_ACTIVITY_SINGLE_TOP=1,FLAG_ACTIVITY_CLEAR_TOP=2;
    public static final String ACTION_MAIN="android.intent.action.MAIN",ACTION_ASSIST="android.intent.action.ASSIST";
    public static final String CATEGORY_HOME="android.intent.category.HOME",CATEGORY_LAUNCHER="android.intent.category.LAUNCHER";
    public final Class<?> type;
    private final ComponentName component;
    public final java.util.Set<String> categories=new java.util.HashSet<>();
    private final HashMap<String,String> extras=new HashMap<>();
    private String action;
    private Uri data;
    public Intent(){type=null;component=null;}
    public Intent(Context context,Class<?> type){this.type=type;component=new ComponentName(context,type);}
    public ComponentName getComponent(){return component;}
    public Intent addCategory(String category){categories.add(category);return this;}
    public Intent setAction(String value){action=value;return this;}
    public String getAction(){return action;}
    public Intent setFlags(int flags){return this;}
    public Intent setData(Uri value){data=value;return this;}
    public Uri getData(){return data;}
    public Intent putExtra(String key,String value){extras.put(key,value);return this;}
    public String getStringExtra(String key){return extras.get(key);}
   }`,
  'android/content/Context.java':`package android.content;
   import ai.elizaresearch.alphaphone.NavigationServicePorts;
   import android.content.pm.PackageManager;
   public class Context {
    public Context getApplicationContext(){return this;}
    public String getPackageName(){return "ai.elizaresearch.alphaphone";}
    public PackageManager getPackageManager(){return new PackageManager();}
    public int checkSelfPermission(String permission){return NavigationServicePorts.permission?0:-1;}
    public ComponentName startForegroundService(Intent intent){NavigationServicePorts.start(intent);return null;}
    public ComponentName startService(Intent intent){NavigationServicePorts.command(intent);return null;}
    public boolean stopService(Intent intent){NavigationServicePorts.fallbackStops++;return true;}
    public <T>T getSystemService(Class<T> type){return type.cast(NavigationServicePorts.notifications);}
   }`,
  'android/content/pm/PackageManager.java':`package android.content.pm;
   import ai.elizaresearch.alphaphone.NavigationServicePorts;
   public class PackageManager {
    public static final int PERMISSION_GRANTED=0;
    public static class NameNotFoundException extends Exception {}
    public ServiceInfo getServiceInfo(android.content.ComponentName component,int flags)throws NameNotFoundException{
     if(!NavigationServicePorts.declared)throw new NameNotFoundException();
     return new ServiceInfo();
    }
   }`,
  'android/content/pm/ServiceInfo.java':`package android.content.pm;public class ServiceInfo {
   public static final int FOREGROUND_SERVICE_TYPE_LOCATION=8;
   public int getForegroundServiceType(){return FOREGROUND_SERVICE_TYPE_LOCATION;}
  }`,
  'android/app/Activity.java':`package android.app;
   public class Activity extends android.content.Context {
    public android.content.ComponentName getComponentName(){return new android.content.ComponentName(this,getClass());}
    public boolean isFinishing(){return false;}
    public boolean isDestroyed(){return false;}
   }`,
  'android/app/PendingIntent.java':`package android.app;
   import android.content.*;
   import java.util.HashMap;
   public class PendingIntent {
    public static final int FLAG_IMMUTABLE=1,FLAG_UPDATE_CURRENT=2;
    private static final HashMap<String,PendingIntent> services=new HashMap<>();
    public Intent intent;
    private PendingIntent(Intent intent){this.intent=intent;}
    public static PendingIntent getActivity(Context context,int request,Intent intent,int flags){return new PendingIntent(intent);}
    public static PendingIntent getService(Context context,int request,Intent intent,int flags){
     String key=intent.type+":"+intent.getAction()+":"+intent.getData()+":"+request;
     PendingIntent held=services.computeIfAbsent(key,ignored->new PendingIntent(intent));
     if((flags&FLAG_UPDATE_CURRENT)!=0)held.intent=intent;
     return held;
    }
   }`,
  'android/app/Notification.java':`package android.app;
   public class Notification {
    public static final int VISIBILITY_PUBLIC=1;
    public static final String CATEGORY_NAVIGATION="navigation";
    public String title,text;
    public PendingIntent stop;
    public static class Action {
     final PendingIntent stop;
     Action(PendingIntent value){stop=value;}
     public static class Builder {
      final PendingIntent value;
      public Builder(Object icon,String title,PendingIntent stop){value=stop;}
      public Action build(){return new Action(value);}
     }
    }
    public static class Builder {
     final Notification value=new Notification();
     public Builder(android.content.Context context,String channel){}
     public Builder setSmallIcon(int icon){return this;}
     public Builder setContentTitle(String title){value.title=title;return this;}
     public Builder setContentText(String text){value.text=text;return this;}
     public Builder setContentIntent(PendingIntent intent){return this;}
     public Builder setOngoing(boolean value){return this;}
     public Builder setOnlyAlertOnce(boolean value){return this;}
     public Builder setShowWhen(boolean value){return this;}
     public Builder setCategory(String category){return this;}
     public Builder setVisibility(int visibility){return this;}
     public Builder addAction(Action action){value.stop=action.stop;return this;}
     public Notification build(){return value;}
    }
   }`,
  'android/app/NotificationChannel.java':`package android.app;public record NotificationChannel(String id,String title,int importance) {
   public void setDescription(String value){}
   public void setShowBadge(boolean value){}
   public void setLockscreenVisibility(int value){}
  }`,
  'android/app/NotificationManager.java':`package android.app;public class NotificationManager {
   public static final int IMPORTANCE_LOW=2;
   private NotificationChannel channel;
   public NotificationChannel getNotificationChannel(String id){return channel;}
   public void createNotificationChannel(NotificationChannel value){channel=value;}
  }`,
  'android/app/Service.java':`package android.app;
   import android.content.*;
   import ai.elizaresearch.alphaphone.NavigationServicePorts;
   public class Service extends Context {
    public static final int START_NOT_STICKY=2,STOP_FOREGROUND_REMOVE=1;
    public boolean foreground,stopped;
    public int latestStartId,foregroundCalls,stopForegroundCalls,stopSelfCalls;
    public Notification notification;
    public android.os.IBinder onBind(Intent intent){return null;}
    public int onStartCommand(Intent intent,int flags,int startId){return START_NOT_STICKY;}
    public void onTaskRemoved(Intent intent){}
    public void onDestroy(){}
    public void startForeground(int id,Notification value){
     if(NavigationServicePorts.failForeground){NavigationServicePorts.failForeground=false;throw new IllegalStateException("foreground refused");}
     foregroundCalls++;notification=value;foreground=true;
    }
    public void startForeground(int id,Notification value,int type){startForeground(id,value);}
    public void stopForeground(int flags){stopForegroundCalls++;foreground=false;}
    public void stopSelf(){stopSelfCalls++;stopped=true;}
    public void stopSelf(int id){stopSelfCalls++;if(id==latestStartId)stopped=true;}
   }`,
  'com/getcapacitor/PluginMethod.java':'package com.getcapacitor;public @interface PluginMethod {}',
  'com/getcapacitor/annotation/CapacitorPlugin.java':'package com.getcapacitor.annotation;public @interface CapacitorPlugin {String name();}',
  'com/getcapacitor/Plugin.java':`package com.getcapacitor;
   public class Plugin {
    public int fixtureOwner;
    public android.app.Activity fixtureActivity=new ai.elizaresearch.alphaphone.MainActivity();
    public android.app.Activity getActivity(){return fixtureActivity;}
    public final org.json.JSONArray events=new org.json.JSONArray();
    public android.content.Context getContext(){return ai.elizaresearch.alphaphone.NavigationServicePorts.context;}
    public void load(){}
    protected void handleOnDestroy(){}
    public void notifyListeners(String name,JSObject value){
     events.put(new org.json.JSONObject().put("name",name).put("value",value));
     ai.elizaresearch.alphaphone.NavigationServicePorts.event(fixtureOwner,name,value);
    }
   }`,
  'com/getcapacitor/PluginCall.java':`package com.getcapacitor;
   public class PluginCall {
    final JSObject data;
    public JSObject result;
    public String code,error;
    public int settles;
    public PluginCall(JSObject data){this.data=data;}
    public String getString(String key){return data.getString(key);}
    public String getString(String key,String fallback){return data.getString(key,fallback);}
    public void resolve(){settles++;}
    public void resolve(JSObject value){result=value;resolve();}
    public void reject(String message){error=message;settles++;}
    public void reject(String message,String reason){code=reason;reject(message);}
   }`,
  'ai/elizaresearch/alphaphone/BuildConfig.java':'package ai.elizaresearch.alphaphone;public class BuildConfig {public static final boolean ELIZA_DEV_ALLOW_TEST_MOCKS=false;}',
  'ai/elizaresearch/alphaphone/MainActivity.java':`package ai.elizaresearch.alphaphone;public class MainActivity extends android.app.Activity {
   public boolean consumeNavigationOpen(){throw new AssertionError("Notification launch is outside this service-ownership campaign");}
   public void clearNavigationOpen(){throw new AssertionError("Notification launch is outside this service-ownership campaign");}
  }`,
  'ai/elizaresearch/alphaphone/AlphaAssistActivity.java':'package ai.elizaresearch.alphaphone;public class AlphaAssistActivity extends MainActivity {}',
  'ai/elizaresearch/alphaphone/AlphaPowerVoiceActivity.java':'package ai.elizaresearch.alphaphone;public class AlphaPowerVoiceActivity extends AlphaAssistActivity {}'
 };
 for(const [name,body] of Object.entries(files)){
  const file=join(directory,name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,body);
 }
 return {paths:Object.keys(files).map(name=>join(directory,name)),close:()=>rmSync(directory,{recursive:true,force:true})};
}
