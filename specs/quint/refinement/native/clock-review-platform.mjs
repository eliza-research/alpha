import assert from 'node:assert/strict';

/** The complete Clock-specific source methods with unrelated recovery ports omitted. */
export function clockJournalBridge(source) {
  const read=source.match(/^ private static JSONObject read\([^\n]+/m)?.[0];
  const start=source.indexOf(' private final android.os.Handler clockMain');
  assert.ok(read && start>=0 && source.slice(start).includes('ClockAgentReview.abandon(this)'));
  return `package ai.elizaresearch.alphaphone;
import com.getcapacitor.*;
import ai.eliza.plugins.actionjournal.ActionJournal;
import ai.eliza.plugins.actionjournal.ActionJournalPlugin;
import java.util.Set;
import org.json.JSONObject;
import static ai.eliza.plugins.actionjournal.ActionJournal.field;
import static ai.eliza.plugins.actionjournal.ActionJournal.sameJson;
public final class AlphaActionJournalPlugin extends ActionJournalPlugin {
 @Override protected ActionJournal createJournal(){return AlphaActionJournal.get(getContext());}
 ${read}
 ${source.slice(start,source.lastIndexOf('}'))}
}
`;
}

export const clockPlatform={
  'android/content/Context.java': `package android.content;
public class Context {
 public static final String KEYGUARD_SERVICE="keyguard";
 public Context getApplicationContext(){return this;}
 public String getPackageName(){return "ai.elizaresearch.alphaphone";}
}`,
  'android/content/ComponentName.java': `package android.content;
public record ComponentName(String packageName,String className) {}`,
  'android/content/ActivityNotFoundException.java': `package android.content;
public class ActivityNotFoundException extends RuntimeException {}`,
  'android/content/DialogInterface.java': `package android.content;
public interface DialogInterface {
 interface OnClickListener {void onClick(DialogInterface dialog,int button);}
 interface OnCancelListener {void onCancel(DialogInterface dialog);}
}`,
  'android/content/Intent.java': `package android.content;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
public final class Intent {
 public final String action;
 public final Map<String,Object> extras=new LinkedHashMap<>();
 public ComponentName component;
 public Intent(String action){this.action=action;}
 public Intent putExtra(String key,int value){extras.put(key,value);return this;}
 public Intent putExtra(String key,boolean value){extras.put(key,value);return this;}
 public Intent putExtra(String key,String value){extras.put(key,value);return this;}
 public Intent putIntegerArrayListExtra(String key,ArrayList<Integer> value){extras.put(key,value);return this;}
 public Intent setComponent(ComponentName value){component=value;return this;}
}`,
  'android/content/pm/ActivityInfo.java': `package android.content.pm;
public class ActivityInfo {public String packageName,name;}`,
  'android/content/pm/ResolveInfo.java': `package android.content.pm;
public class ResolveInfo {public ActivityInfo activityInfo;}`,
  'android/content/pm/PackageManager.java': `package android.content.pm;
public final class PackageManager {
 private final android.app.Activity activity;
 public PackageManager(android.app.Activity activity){this.activity=activity;}
 public ResolveInfo resolveActivity(android.content.Intent intent,int flags){
  if(activity.receiver==null)return null;
  ResolveInfo result=new ResolveInfo();result.activityInfo=new ActivityInfo();
  result.activityInfo.packageName=activity.receiver;result.activityInfo.name=activity.receiver+".Clock";
  return result;
 }
}`,
  'android/os/Looper.java': `package android.os;
public final class Looper {
 private static final Looper main=new Looper();
 private static final ThreadLocal<Looper> active=new ThreadLocal<>();
 public static Looper getMainLooper(){return main;}
 public static Looper myLooper(){return active.get();}
 static void runMain(Runnable task){Looper before=active.get();active.set(main);try{task.run();}finally{active.set(before);}}
}`,
  'android/os/Handler.java': `package android.os;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
public final class Handler {
 private static final BlockingQueue<Runnable> held=new LinkedBlockingQueue<>();
 public static volatile int holdAt;
 public static volatile boolean refuse;
 public Handler(Looper looper){}
 public boolean post(Runnable task){
  if(refuse)return false;
  if(holdAt>0 && --holdAt==0)held.add(task);
  else Looper.runMain(task);
  return true;
 }
 public void removeCallbacks(Runnable task){held.remove(task);}
 public static Runnable take()throws Exception{
  Runnable task=held.poll(3,TimeUnit.SECONDS);if(task==null)throw new AssertionError("Expected queued Clock main-thread task");return task;
 }
 public static void run(Runnable task){Looper.runMain(task);}
}`,
  'android/app/KeyguardManager.java': `package android.app;
public final class KeyguardManager {
 public boolean locked;
 public boolean isKeyguardLocked(){return locked;}
}`,
  'android/app/Activity.java': `package android.app;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.Looper;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;
public final class Activity extends Context {
 public final KeyguardManager keyguard=new KeyguardManager();
 public final List<AlertDialog> dialogs=new ArrayList<>();
 public final List<Intent> delivered=new ArrayList<>();
 public Consumer<Intent> beforeStart=unused->{};
 public boolean finishing,destroyed,focused=true;
 public String receiver="com.synthetic.clock",effect="opened";
 public int attempted;
 public boolean isFinishing(){return finishing;}
 public boolean isDestroyed(){return destroyed;}
 public boolean hasWindowFocus(){return focused;}
 public Object getSystemService(String name){return name.equals(KEYGUARD_SERVICE)?keyguard:null;}
 public PackageManager getPackageManager(){return new PackageManager(this);}
 public void startActivity(Intent intent){
  if(Looper.myLooper()!=Looper.getMainLooper())throw new AssertionError("Expected Android effect on main");
  beforeStart.accept(intent);attempted++;
  switch(effect){
   case "missing": throw new ActivityNotFoundException();
   case "denied": throw new SecurityException();
   case "unknown-before": throw new IllegalStateException("Synthetic dispatch error before delivery");
   default: delivered.add(intent);
  }
  if(effect.equals("unknown-after"))throw new IllegalStateException("Synthetic dispatch error after delivery");
 }
 public void runOnUiThread(Runnable task){new Handler(Looper.getMainLooper()).post(task);}
}`,
  'android/app/AlertDialog.java': `package android.app;
import android.content.DialogInterface;
public final class AlertDialog implements DialogInterface {
 private final Activity activity;
 public String text;
 private OnClickListener positive,negative;
 private OnCancelListener cancelled;
 public boolean visible;
 private AlertDialog(Activity activity){this.activity=activity;}
 public void show(){visible=true;activity.dialogs.add(this);}
 public void dismiss(){visible=false;}
 /** Even after dismissal, a previously queued callback is a separate input. */
 public void deliver(String choice){
  visible=false;
  switch(choice){
   case "positive":positive.onClick(this,1);break;
   case "negative":negative.onClick(this,-1);break;
   case "cancel":cancelled.onCancel(this);break;
   default:throw new AssertionError("Unexpected choice");
  }
 }
 public static final class Builder {
  private final AlertDialog dialog;
  public Builder(Activity activity){dialog=new AlertDialog(activity);}
  public Builder setTitle(String title){return this;}
  public Builder setMessage(String value){dialog.text=value;return this;}
  public Builder setPositiveButton(String label,OnClickListener listener){dialog.positive=listener;return this;}
  public Builder setNegativeButton(String label,OnClickListener listener){dialog.negative=listener;return this;}
  public Builder setOnCancelListener(OnCancelListener listener){dialog.cancelled=listener;return this;}
  public AlertDialog create(){return dialog;}
 }
}`,
  'android/provider/AlarmClock.java': `package android.provider;
public final class AlarmClock {
 public static final String ACTION_SET_ALARM="android.intent.action.SET_ALARM", ACTION_SHOW_ALARMS="android.intent.action.SHOW_ALARMS",
 ACTION_DISMISS_ALARM="android.intent.action.DISMISS_ALARM", ACTION_SNOOZE_ALARM="android.intent.action.SNOOZE_ALARM",
 EXTRA_HOUR="hour", EXTRA_MINUTES="minutes", EXTRA_MESSAGE="message", EXTRA_SKIP_UI="skip", EXTRA_DAYS="days",
 EXTRA_ALARM_SNOOZE_DURATION="snooze-duration";
}`,
  'android/icu/util/TimeZone.java': `package android.icu.util;
public final class TimeZone {
 public static String getCanonicalID(String id){
  if(id.equals("Etc/UTC"))return "UTC";
  return java.util.Set.of("UTC","America/Los_Angeles").contains(id)?id:null;
 }
}`,
  'com/getcapacitor/Plugin.java': `package com.getcapacitor;
public abstract class Plugin {
 public final android.app.Activity activity=new android.app.Activity();
 public android.app.Activity getActivity(){return activity;}
 public android.content.Context getContext(){return activity;}
 protected void handleOnDestroy(){activity.destroyed=true;}
}`,
  'com/getcapacitor/PluginMethod.java': `package com.getcapacitor; public @interface PluginMethod {}`,
  'com/getcapacitor/JSObject.java': `package com.getcapacitor;
public class JSObject extends org.json.JSONObject { public JSObject(){} }`,
  'com/getcapacitor/JSArray.java': `package com.getcapacitor;
public class JSArray extends org.json.JSONArray {}`,
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
public final class PluginCall {
 private final JSONObject input;
 public volatile JSObject result;
 public volatile String rejection;
 private final CountDownLatch answered=new CountDownLatch(1);
 public PluginCall(JSONObject input){this.input=input;}
 public String getString(String key){return input.optString(key,null);}
 public JSONObject getObject(String key){return input.optJSONObject(key);}
 public synchronized void resolve(JSObject value){if(done())throw new AssertionError("Duplicate answer");result=value;answered.countDown();}
 public synchronized void reject(String reason){if(done())throw new AssertionError("Duplicate answer");rejection=reason;answered.countDown();}
 public boolean done(){return answered.getCount()==0;}
 public void await()throws Exception{if(!answered.await(4,TimeUnit.SECONDS))throw new AssertionError("Clock call unanswered");}
}`,
  'ai/elizaresearch/alphaphone/ClockReviewSupport.java': `package ai.elizaresearch.alphaphone;
import org.json.JSONObject;
final class AlphaCredentialStore {
 AlphaCredentialStore(android.content.Context context){}
 String readCredentialSlot(String key){return ClockReviewTraces.slots.get(key);}
 void writeCredentialSlot(String key,String value)throws Exception{ClockReviewTraces.write(key,value);}
}
final class CalendarAvailabilityJournalResult {
 static final String TYPE="unused-calendar";
 static void check(JSONObject retained,String id,String status,JSONObject result){throw new AssertionError();}
}
final class SmsActionJournalResult {
 static void check(JSONObject entry,String status,JSONObject result){throw new AssertionError();}
}
final class System {
 static long currentTimeMillis(){return ClockReviewTraces.now;}
}
`,
};
