import assert from 'node:assert/strict';

function between(source, first, last) {
  const start=source.indexOf(first), end=source.indexOf(last,start+first.length);
  assert.ok(start>=0&&end>start,`SMS source anchors ${first}, ${last}`);
  return source.slice(start,end);
}
function member(source, regex) {
  const value=source.match(regex)?.[0];
  assert.ok(value,`SMS source member ${regex}`);
  return value;
}

export function smsMembers(plugin, mms, provider) {
  return {
    'ai/eliza/plugins/messages/TelephonyPlugin.java': `package ai.eliza.plugins.messages;
import android.telephony.*;
import android.content.Intent;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;
public abstract class TelephonyPlugin extends Plugin {
 ${between(plugin,' public static final Pattern NUMBER',' /** Runs a request that launches')}
 ${between(plugin,' private android.app.AlertDialog review;',' // ---- Reviewed native MMS')}
 ${member(plugin,/^ @Override protected void handleOnDestroy\(\)[^\n]+/m)}
 private void stopObserving(){}
 private void resumeObserving(){}
 private void stopObservingVoicemail(){}
 private void resumeObservingVoicemail(){}
 protected interface ReadTask {JSObject run(android.os.CancellationSignal signal)throws Exception;}
 protected final void fencedRead(PluginCall call,String alias,String name,ReadTask work){throw new AssertionError("Unrelated Contacts read");}
}`,
    'ai/eliza/plugins/messages/MmsStore.java': `package ai.eliza.plugins.messages;
import android.content.*;
import android.net.Uri;
import android.provider.Telephony;
import java.io.File;
import java.util.List;
public final class MmsStore {
 ${between(mms,' public static boolean isDefaultSmsApp',' /** Inserts one incoming SMS')}
 ${between(mms,' public static long persistOutgoingSms',' /**\n  * Marks one conversation')}
 static String newFileName(){throw new AssertionError("MMS outside SMS fixture");}
 static File file(Context c,String name){throw new AssertionError("MMS outside SMS fixture");}
 static Uri fileUri(String authority,String name){throw new AssertionError("MMS outside SMS fixture");}
 static void delete(Context c,String name){throw new AssertionError("MMS outside SMS fixture");}
 static long persistOutgoingMms(Context c,String[] to,List<MmsPdu.Part> parts,String txn,int sim,long at){throw new AssertionError("MMS outside SMS fixture");}
 static void settleOutgoingMms(Context c,long row,boolean success){throw new AssertionError("MMS outside SMS fixture");}
}`,
    'ai/eliza/plugins/messages/SmsProviderReader.java': `package ai.eliza.plugins.messages;
import android.database.Cursor;
final class SmsProviderReader {
 ${['longAt','intAt','textAt'].map(name=>member(provider,new RegExp('^ static (?:int|long|String) '+name+'\\([^\\n]+','m'))).join('\n')}
}`,
  };
}

export const smsPlatform={
  'android/Manifest.java': `package android;
public final class Manifest {public static final class permission {
 public static final String SEND_SMS="sendSms",READ_PHONE_STATE="phoneState",READ_SMS="sms",READ_CONTACTS="contacts",READ_CALL_LOG="callLog";
}}`,
  'android/os/Build.java': `package android.os;
public final class Build {public static final class VERSION {public static final int SDK_INT=35;}}`,
  'android/os/Looper.java': `package android.os;
public final class Looper {
 private static final Looper main=new Looper();private static final ThreadLocal<Looper> active=new ThreadLocal<>();
 public static Looper getMainLooper(){return main;}
 public static Looper myLooper(){return active.get();}
 public static void runMain(Runnable task){Looper before=active.get();active.set(main);try{task.run();}finally{active.set(before);}}
}`,
  'android/os/Handler.java': `package android.os;
public final class Handler {
 public Handler(Looper looper){}
 public boolean post(Runnable task){Looper.runMain(task);return true;}
}`,
  'android/os/CancellationSignal.java': `package android.os;
public final class CancellationSignal {public void cancel(){}}`,
  'android/os/UserManager.java': `package android.os;
public final class UserManager {
 public boolean unlocked=true,foreground=true;
 public boolean isUserUnlocked(){return unlocked;}
 public boolean isUserForeground(){return foreground;}
}`,
  'android/util/Log.java': `package android.util;
public final class Log {public static int w(String tag,String text){return 0;} public static int w(String tag,String text,Throwable failure){return 0;}}`,
  'android/content/pm/PackageManager.java': `package android.content.pm;
public final class PackageManager {public static final int PERMISSION_GRANTED=0;}`,
  'android/net/Uri.java': `package android.net;
public record Uri(String text) {
 public static Uri parse(String text){return new Uri(text);}
 public static Uri fromParts(String scheme,String value,String fragment){return new Uri(scheme+":"+value);}
 public static Uri withAppendedPath(Uri root,String path){return new Uri(root.text+"/"+path);}
 public String toString(){return text;}
}`,
  'android/content/ContentUris.java': `package android.content;
import android.net.Uri;
public final class ContentUris {
 public static Uri withAppendedId(Uri uri,long id){return Uri.withAppendedPath(uri,Long.toString(id));}
 public static long parseId(Uri uri){return Long.parseLong(uri.text().substring(uri.text().lastIndexOf('/')+1));}
}`,
  'android/content/ContentValues.java': `package android.content;
import java.util.LinkedHashMap;
public final class ContentValues extends LinkedHashMap<String,Object>{}`,
  'android/content/Intent.java': `package android.content;
import java.util.*;
import android.net.Uri;
public final class Intent {
 public static final String ACTION_SCREEN_OFF="screen-off";
 private final String action;
 private final Map<String,Object> extras=new HashMap<>();
 private Uri data;
 public Class<?> component;public String pkg;
 public Intent(String action){this.action=action;}
 public Intent(Intent other){action=other.action;data=other.data;extras.putAll(other.extras);component=other.component;pkg=other.pkg;}
 public String getAction(){return action;}
 public Intent setClass(Context context,Class<?> type){component=type;return this;}
 public Intent setPackage(String value){pkg=value;return this;}
 public Intent setData(Uri value){data=value;return this;}
 public Uri getData(){return data;}
 public Intent putExtra(String key,String value){extras.put(key,value);return this;}
 public Intent putExtra(String key,int value){extras.put(key,value);return this;}
 public String getStringExtra(String key){return (String)extras.get(key);}
 public int getIntExtra(String key,int fallback){return (Integer)extras.getOrDefault(key,fallback);}
 public byte[] getByteArrayExtra(String key){return (byte[])extras.get(key);}
}`,
  'android/content/IntentFilter.java': `package android.content; public record IntentFilter(String action){}`,
  'android/content/BroadcastReceiver.java': `package android.content;
public abstract class BroadcastReceiver {
 public int code;public int accepted,finished;
 public abstract void onReceive(Context c,Intent i);
 public int getResultCode(){return code;}
 public PendingResult goAsync(){accepted++;return new PendingResult();}
 public final class PendingResult{public void finish(){finished++;}}
}`,
  'android/content/DialogInterface.java': `package android.content;
public interface DialogInterface {
 int BUTTON_POSITIVE=-1;
 interface OnClickListener{void onClick(DialogInterface dialog,int which);}
 interface OnDismissListener{void onDismiss(DialogInterface dialog);}
}`,
  'android/app/KeyguardManager.java': `package android.app;
public final class KeyguardManager {public boolean locked;public boolean isDeviceLocked(){return locked;}}`,
  'android/app/Activity.java': `package android.app;
import java.util.*;
import android.content.Context;
public final class Activity {
 public static final int RESULT_OK=-1;
 public final Context context;
 public final List<AlertDialog> dialogs=new ArrayList<>();
 public boolean closing, destroyed;
 public Activity(Context context){this.context=context;}
 public boolean isFinishing(){return closing;}
 public boolean isDestroyed(){return destroyed;}
}`,
  'android/view/WindowManager.java': `package android.view;
public interface WindowManager {final class LayoutParams{public static final int FLAG_SECURE=8192;}}`,
  'android/view/Window.java': `package android.view;
public final class Window {public int flags;public void addFlags(int value){flags|=value;}}`,
  'android/widget/Button.java': `package android.widget;
public final class Button {public boolean filtered;public void setFilterTouchesWhenObscured(boolean value){filtered=value;}}`,
  'android/app/AlertDialog.java': `package android.app;
import android.content.DialogInterface;
import android.view.Window;
import android.widget.Button;
public final class AlertDialog implements DialogInterface {
 private final Activity activity;private OnClickListener send;private OnDismissListener dismissed;
 private final Window window=new Window();private final Button button=new Button();
 public String title,message;public boolean visible;
 private AlertDialog(Activity activity){this.activity=activity;}
 public void setOnDismissListener(OnDismissListener listener){dismissed=listener;}
 public Window getWindow(){return window;}
 public Button getButton(int index){return button;}
 public void show(){visible=true;activity.dialogs.add(this);}
 public void dismiss(){if(!visible)return;visible=false;if(dismissed!=null)dismissed.onDismiss(this);}
 public void clickSend(){send.onClick(this,BUTTON_POSITIVE);dismiss();}
 public static final class Builder {
  private final AlertDialog dialog;
  public Builder(Activity activity){dialog=new AlertDialog(activity);}
  public Builder setTitle(String value){dialog.title=value;return this;}
  public Builder setMessage(String value){dialog.message=value;return this;}
  public Builder setNegativeButton(String label,OnClickListener listener){return this;}
  public Builder setPositiveButton(String label,OnClickListener listener){dialog.send=listener;return this;}
  public AlertDialog create(){return dialog;}
 }
}`,
  'android/app/PendingIntent.java': `package android.app;
import android.content.*;
public final class PendingIntent {
 public static final int FLAG_IMMUTABLE=1,FLAG_ONE_SHOT=2,FLAG_MUTABLE=4;
 public final Intent intent;public final int flags;
 private PendingIntent(Intent value,int flags){intent=new Intent(value);this.flags=flags;}
 public static PendingIntent getBroadcast(Context context,int code,Intent intent,int flags){return new PendingIntent(intent,flags);}
}`,
  'android/telephony/SubscriptionInfo.java': `package android.telephony;
public record SubscriptionInfo(int id,int slot,int carrier) {
 public int getSubscriptionId(){return id;} public int getSimSlotIndex(){return slot;} public int getCarrierId(){return carrier;}
 public CharSequence getDisplayName(){return "Synthetic SIM";}public CharSequence getCarrierName(){return "Synthetic carrier";}
}`,
  'android/telephony/SubscriptionManager.java': `package android.telephony;
import java.util.*;
public final class SubscriptionManager {
 public int revision=1;
 public List<SubscriptionInfo> getActiveSubscriptionInfoList(){
  return revision==0?List.of():List.of(new SubscriptionInfo(7,revision==3?1:0,revision==2?19:18));
 }
}`,
  'android/telephony/TelephonyManager.java': `package android.telephony;
public final class TelephonyManager {public boolean capable=true;public boolean isSmsCapable(){return capable;}}`,
  'android/telephony/SmsManager.java': `package android.telephony;
import android.app.PendingIntent;
import android.content.Context;
import android.net.Uri;
import java.util.*;
public final class SmsManager {
 public static final String EXTRA_MMS_DATA="mms-data";
 public record Call(String address,List<String> parts,List<PendingIntent> sent,List<PendingIntent> delivery,int sim){}
 private final Context context;private int sim;
 public int parts=1,attempts;public String mode="complete";
 public final List<Call> accepted=new ArrayList<>();
 public java.util.function.Consumer<Call> before=unused->{};
 public SmsManager(Context context){this.context=context;}
 public SmsManager createForSubscriptionId(int id){sim=id;return this;}
 public static SmsManager getSmsManagerForSubscriptionId(int id){throw new AssertionError("API 35 uses a bound manager");}
 public ArrayList<String> divideMessage(String body){
  if(parts<0)throw new IllegalStateException("Synthetic divider refusal");
  ArrayList<String> out=new ArrayList<>();
  if(parts==1)out.add(body);
  if(parts==2){int middle=body.length()/2;out.add(body.substring(0,middle));out.add(body.substring(middle));}
  return out;
 }
 public void sendTextMessage(String address,String service,String part,PendingIntent sent,PendingIntent delivery){
  submit(new Call(address,List.of(part),List.of(sent),List.of(delivery),sim));
 }
 public void sendMultipartTextMessage(String address,String service,ArrayList<String> parts,ArrayList<PendingIntent> sent,ArrayList<PendingIntent> delivery){
  submit(new Call(address,List.copyOf(parts),List.copyOf(sent),List.copyOf(delivery),sim));
 }
 private void submit(Call call){
  before.accept(call);attempts++;
  if(mode.equals("throw-before"))throw new IllegalStateException("Synthetic radio refusal before handoff");
  accepted.add(call);
  if(mode.equals("guard-change"))context.subscriptions.revision=2;
  if(mode.equals("throw-after"))throw new IllegalStateException("Synthetic radio refusal after handoff");
 }
 public void sendMultimediaMessage(Context c,Uri uri,String location,Object options,PendingIntent sent){throw new AssertionError("MMS outside SMS fixture");}
}`,
  'android/provider/Settings.java': `package android.provider;
public final class Settings {public static final class Global{
 public static final String BOOT_COUNT="boot";
 public static int getInt(android.content.ContentResolver resolver,String key,int fallback){return resolver.boot();}
}}`,
  'android/provider/Telephony.java': `package android.provider;
import android.net.Uri;
public final class Telephony {public static final class Sms {
 public static final Uri CONTENT_URI=Uri.parse("content://sms");
 public static final String _ID="_id", ADDRESS="address", BODY="body", DATE="date", CREATOR="creator", TYPE="type", SUBSCRIPTION_ID="sub_id", STATUS="status", READ="read", SEEN="seen";
 public static final int MESSAGE_TYPE_OUTBOX=4;
 public static String getDefaultSmsPackage(android.content.Context context){return context.role?context.getPackageName():"other.sms";}
 public static final class Outbox{public static final Uri CONTENT_URI=Uri.parse("content://sms/outbox");}
}}`,
  'android/database/Cursor.java': `package android.database;
public interface Cursor extends AutoCloseable {
 boolean moveToFirst();boolean moveToNext();int getColumnIndex(String name);boolean isNull(int i);long getLong(int i);int getInt(int i);String getString(int i);void close();
}`,
  'android/content/ContentResolver.java': `package android.content;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Telephony.Sms;
import java.util.*;
public final class ContentResolver {
 private final Context context;
 public final Map<Long,ContentValues> rows=new LinkedHashMap<>();
 public boolean refuseInsert;
 public long sequence=100;
 public ContentResolver(Context context){this.context=context;}
 public int boot(){return context.boot;}
 public Uri insert(Uri uri,ContentValues value){
  if(refuseInsert)return null;
  if(!uri.equals(Sms.Outbox.CONTENT_URI)||!context.role)throw new AssertionError("Only default SMS owns an outbox insertion");
  long id=++sequence;value.put(Sms._ID,id);value.put(Sms.CREATOR,context.getPackageName());value.put(Sms.STATUS,-1);rows.put(id,value);
  return ContentUris.withAppendedId(Sms.CONTENT_URI,id);
 }
 public int update(Uri uri,ContentValues value,String where,String[] args){
  if(!where.equals(Sms.TYPE+" = ? AND "+Sms.CREATOR+" = ?")||args.length!=2||!args[0].equals("4")||!context.role)
   throw new AssertionError("Only exact app-owned outbox row may settle");
  ContentValues row=rows.get(ContentUris.parseId(uri));
  if(row==null||!String.valueOf(row.get(Sms.TYPE)).equals(args[0])||!Objects.equals(row.get(Sms.CREATOR),args[1]))return 0;
  row.putAll(value);return 1;
 }
 public Cursor query(Uri uri,String[] fields,String where,String[] args,String order){
  List<ContentValues> result=new ArrayList<>();
  if(uri.equals(Sms.CONTENT_URI)){
   String selection=Sms.ADDRESS+" = ? AND "+Sms.CREATOR+" = ? AND "+Sms.DATE+" >= ? AND "+Sms.DATE+
    " <= ? AND "+Sms.TYPE+" IN (2,4,5,6) AND "+Sms.SUBSCRIPTION_ID+" = ?";
   if(!selection.equals(where)||args.length!=5||!Arrays.equals(fields,new String[]{Sms._ID,Sms.BODY})||!order.equals(Sms._ID+" ASC"))
    throw new AssertionError("Exact bounded provider attribution query");
   for(ContentValues row:rows.values()){
    long date=((Number)row.get(Sms.DATE)).longValue();
    if(Objects.equals(row.get(Sms.ADDRESS),args[0])&&Objects.equals(row.get(Sms.CREATOR),args[1])&&
     date>=Long.parseLong(args[2])&&date<=Long.parseLong(args[3])&&Set.of(2,4,5,6).contains(row.get(Sms.TYPE))&&
     String.valueOf(row.get(Sms.SUBSCRIPTION_ID)).equals(args[4]))result.add(row);
   }
  }else{
   if(!Arrays.equals(fields,new String[]{Sms.STATUS})||where!=null)throw new AssertionError("Only selected row's delivery status");
   ContentValues row=rows.get(ContentUris.parseId(uri));if(row!=null)result.add(row);
  }
  return new Cursor(){
   int index=-1;
   Object value(int i){return result.get(index).get(fields[i]);}
   public boolean moveToFirst(){index=0;return !result.isEmpty();}
   public boolean moveToNext(){return ++index<result.size();}
   public int getColumnIndex(String name){return Arrays.asList(fields).indexOf(name);}
   public boolean isNull(int i){return value(i)==null;}
   public long getLong(int i){return ((Number)value(i)).longValue();}
   public int getInt(int i){return ((Number)value(i)).intValue();}
   public String getString(int i){return (String)value(i);}
   public void close(){}
  };
 }
}`,
  'android/content/Context.java': `package android.content;
import android.app.KeyguardManager;
import android.os.UserManager;
import android.telephony.*;
import java.io.File;
import java.util.*;
public final class Context {
 public boolean admitted=true,send=true,phone=true,read=true,role;
 public int boot=1;
 public final Map<String,String> slots=new java.util.concurrent.ConcurrentHashMap<>();
 public final KeyguardManager lock=new KeyguardManager();
 public final UserManager users=new UserManager();
 public final SubscriptionManager subscriptions=new SubscriptionManager();
 public final TelephonyManager telephony=new TelephonyManager();
 public final SmsManager radio=new SmsManager(this);
 public final ContentResolver provider=new ContentResolver(this);
 public final List<BroadcastReceiver> dynamicReceivers=new ArrayList<>();
 public final File noBackup;
 public Context(){try{noBackup=java.nio.file.Files.createTempDirectory("alpha-sms-jvm").toFile();}
  catch(java.io.IOException failure){throw new IllegalStateException(failure);}}
 public String getPackageName(){return "ai.alphacompute.alphaphone";}
 public Context getApplicationContext(){return this;}
 public File getNoBackupFilesDir(){return noBackup;}
 public ContentResolver getContentResolver(){return provider;}
 public int checkSelfPermission(String permission){
  boolean yes=switch(permission){case "sendSms" -> send;case "phoneState" -> phone;case "sms" -> read;default -> true;};
  return yes?0:-1;
 }
 public <T>T getSystemService(Class<T> type){
  Object value=type==KeyguardManager.class?lock:type==UserManager.class?users:type==SubscriptionManager.class?subscriptions:
   type==TelephonyManager.class?telephony:type==SmsManager.class?radio:null;
  return type.cast(value);
 }
 public void unregisterReceiver(BroadcastReceiver receiver){dynamicReceivers.remove(receiver);}
}`,
  'androidx/core/content/ContextCompat.java': `package androidx.core.content;
import android.content.*;
public final class ContextCompat {
 public static final int RECEIVER_NOT_EXPORTED=1;
 public static void registerReceiver(Context c,BroadcastReceiver r,IntentFilter filter,int flags){
  if(flags!=RECEIVER_NOT_EXPORTED)throw new AssertionError("Synthetic local receiver must be private");
  c.dynamicReceivers.add(r);
 }
}`,
  'com/getcapacitor/PermissionState.java': `package com.getcapacitor;public enum PermissionState{GRANTED,DENIED}`,
  'com/getcapacitor/Plugin.java': `package com.getcapacitor;
import android.app.Activity;
import android.content.Context;
import java.util.*;
public abstract class Plugin {
 private Context context;public Activity activity;
 public final List<JSObject> notices=new ArrayList<>();
 public void attach(Context value){context=value;activity=new Activity(value);}
 public Context getContext(){return context;}
 public Activity getActivity(){return activity;}
 public PermissionState getPermissionState(String alias){return context.checkSelfPermission(alias)==0?PermissionState.GRANTED:PermissionState.DENIED;}
 public void load(){}
 protected void handleOnPause(){}protected void handleOnResume(){}protected void handleOnDestroy(){activity.destroyed=true;}
 protected void notifyListeners(String event,JSObject body){
  if(!event.equals("smsSendUpdated")||!body.keySet().equals(Set.of("operationId")))throw new AssertionError("Only opaque SMS update may cross bridge");
  notices.add(body);
 }
}`,
  'com/getcapacitor/PluginMethod.java': `package com.getcapacitor;public @interface PluginMethod {}`,
  'com/getcapacitor/JSObject.java': `package com.getcapacitor;public class JSObject extends org.json.JSONObject {}`,
  'com/getcapacitor/JSArray.java': `package com.getcapacitor;public class JSArray extends org.json.JSONArray {}`,
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
public final class PluginCall {
 private final JSObject data;public JSObject result;public String rejection;public boolean answered;
 public PluginCall(JSObject data){this.data=data;}
 public JSObject getData(){return data;}
 public String getString(String key){return data.optString(key,null);}
 public String getString(String key,String fallback){return data.optString(key,fallback);}
 public Integer getInt(String key,int fallback){return data.optInt(key,fallback);}
 public JSArray getArray(String key){return data.opt(key) instanceof JSArray?(JSArray)data.opt(key):null;}
 public void resolve(){resolve(new JSObject());}
 public void resolve(JSObject value){answer();result=value;}
 public void reject(String text){reject(text,"closed");}
 public void reject(String text,String code){answer();rejection=code;}
 private void answer(){if(answered)throw new AssertionError("Duplicate plugin answer");answered=true;}
}`,
  'com/getcapacitor/annotation/Permission.java': `package com.getcapacitor.annotation;
public @interface Permission {String alias();String[] strings();}`,
  'com/getcapacitor/annotation/CapacitorPlugin.java': `package com.getcapacitor.annotation;
@java.lang.annotation.Retention(java.lang.annotation.RetentionPolicy.RUNTIME)
public @interface CapacitorPlugin {String name();Permission[] permissions();}`,
  'ai/eliza/plugins/contacts/ContactsCatalog.java': `package ai.eliza.plugins.contacts;
public final class ContactsCatalog {
 public ContactsCatalog(android.content.Context context){}
 public com.getcapacitor.JSObject list(String query,int limit,android.os.CancellationSignal cancel){throw new AssertionError("Contacts outside SMS fixture");}
}`,
  'ai/alphacompute/alphaphone/SmsFixtureSupport.java': `package ai.alphacompute.alphaphone;
import android.content.Context;
final class AlphaImageCapability {
 static final String UNAVAILABLE="Synthetic image refused";
 static String featureName(String name){return name+".aosp_image";}
 static boolean verified(Context context){return context.admitted;}
}
final class BuildConfig {static final String APPLICATION_ID="ai.alphacompute.alphaphone";}
final class AlphaCredentialStore {
 private final Context context;
 AlphaCredentialStore(Context context){this.context=context;}
 String readCredentialSlot(String slot){return context.slots.get(slot);}
 void writeCredentialSlot(String slot,String value)throws Exception{ai.eliza.plugins.messages.SmsDispatchTraces.write(context,slot,value);}
}`,
  'ai/eliza/plugins/messages/SmsFixtureSupport.java': `package ai.eliza.plugins.messages;
final class System {static long currentTimeMillis(){return SmsDispatchTraces.now;}}
final class MmsPdu {
 static final int SEND_CONF=1,RESPONSE_OK=0;
 static final class Part{Part(String type,String charset,String name,String id,String location,byte[] data){}static Part text(String body,String name){throw new AssertionError();}}
 static final class Message{int type,responseStatus;}
 static Message parse(byte[] value){throw new AssertionError("MMS outside SMS fixture");}
}`,
};
