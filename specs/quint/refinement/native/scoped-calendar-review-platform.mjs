import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {materializeNativePatches} from '../../../../scripts/prepare-patched-native.mjs';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.mjs';
import {root} from './java.mjs';

const module='plugins/plugin-native-calendar/android';
const calendarSource=module+'/src/main/java/ai/eliza/plugins/calendar/';
const shared='vendor/eliza/plugins/plugin-native-calendar/test/jvm/android/';
const fixtures='test/fixtures/';
const manifest='android/upstream-native-sources.json';
export const calendarReviewPorts={
  'android/Manifest.java': `package android;
public final class Manifest {public static final class permission {
 public static final String READ_CALENDAR="read",WRITE_CALENDAR="write";
}}`,
  'android/content/pm/PackageManager.java': `package android.content.pm;
public final class PackageManager {public static final int PERMISSION_GRANTED=0;}`,
  'android/content/Context.java': `package android.content;
public class Context {
 public final android.app.KeyguardManager lock=new android.app.KeyguardManager();
 public final java.util.concurrent.atomic.AtomicInteger permissionReads=new java.util.concurrent.atomic.AtomicInteger();
 public volatile boolean granted=true;
 public volatile java.util.function.IntConsumer afterPermissionRead=unused->{};
 public final ContentResolver resolver;
 public Context(ContentResolver resolver){this.resolver=resolver;}
 public ContentResolver getContentResolver(){return resolver;}
 public <T> T getSystemService(Class<T> type){return type.cast(lock);}
}`,
  'androidx/core/content/ContextCompat.java': `package androidx.core.content;
public final class ContextCompat {
 public static int checkSelfPermission(android.content.Context context,String permission){
  boolean granted=context.granted;
  context.afterPermissionRead.accept(context.permissionReads.incrementAndGet());
  return granted?0:-1;
 }
}`,
  'android/os/SystemClock.java': `package android.os;
public final class SystemClock {
 public static volatile long now;
 public static long elapsedRealtime(){return now;}
}`,
  'android/content/OperationApplicationException.java': `package android.content;
public class OperationApplicationException extends Exception {}`,
  'android/app/KeyguardManager.java': `package android.app;
public final class KeyguardManager {
 public volatile boolean locked;
 public boolean isDeviceLocked(){return locked;}
}`,
  'androidx/lifecycle/Lifecycle.java': `package androidx.lifecycle;
public final class Lifecycle {
 public enum State {STARTED,RESUMED;
  public boolean isAtLeast(State state){return compareTo(state)>=0;}
 }
 public volatile State state=State.RESUMED;
 public State getCurrentState(){return state;}
}`,
  'android/app/Activity.java': `package android.app;
public final class Activity {
 public final androidx.lifecycle.Lifecycle lifecycle=new androidx.lifecycle.Lifecycle();
 public final java.util.concurrent.BlockingQueue<Runnable> ui=new java.util.concurrent.LinkedBlockingQueue<>();
 public volatile boolean focused=true,dialogFocused,finishing,destroyed;
 public AlertDialog shown;
 public boolean hasWindowFocus(){return focused;}
 public boolean isFinishing(){return finishing;}
 public boolean isDestroyed(){return destroyed;}
 public androidx.lifecycle.Lifecycle getLifecycle(){return lifecycle;}
 public void runOnUiThread(Runnable task){ui.add(task);}
}`,
  'android/content/DialogInterface.java': `package android.content;
public interface DialogInterface {
 interface OnClickListener {void onClick(DialogInterface dialog,int button);}
 interface OnDismissListener {void onDismiss(DialogInterface dialog);}
}`,
  'android/app/AlertDialog.java': `package android.app;
import android.content.DialogInterface;
public final class AlertDialog implements DialogInterface {
 private final Activity activity;
 private OnClickListener positive,negative;
 private OnDismissListener dismissed;
 private boolean showing;
 public String message;
 private AlertDialog(Activity activity){this.activity=activity;}
 public boolean isShowing(){return showing;}
 public void show(){showing=true;activity.shown=this;}
 public void dismiss(){if(showing){showing=false;dismissed.onDismiss(this);}}
 public void choose(boolean confirm){
  if(!showing)throw new AssertionError("No review dialog");
  (confirm?positive:negative).onClick(this,confirm?1:-1);
  dismiss();
 }
 public void setOnDismissListener(OnDismissListener callback){dismissed=callback;}
 public Window getWindow(){return new Window();}
 public final class Window {public Window getDecorView(){return this;}public boolean hasWindowFocus(){return activity.dialogFocused;}}
 public static final class Builder {
  private final AlertDialog dialog;
  public Builder(Activity activity){dialog=new AlertDialog(activity);}
  public Builder setTitle(String title){return this;}
  public Builder setMessage(String message){dialog.message=message;return this;}
  public Builder setNegativeButton(String label,OnClickListener listener){dialog.negative=listener;return this;}
  public Builder setPositiveButton(String label,OnClickListener listener){dialog.positive=listener;return this;}
  public AlertDialog create(){return dialog;}
 }
}`,
  'com/getcapacitor/JSObject.java': `package com.getcapacitor;
public final class JSObject extends org.json.JSONObject {}`,
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor;
public final class PluginCall {
 private final JSObject data;
 private final java.util.concurrent.CompletableFuture<JSObject> response=new java.util.concurrent.CompletableFuture<>();
 public PluginCall(JSObject data){this.data=data;}
 public JSObject getData(){return data;}
 public org.json.JSONObject getObject(String key){return data.optJSONObject(key);}
 public String getString(String key){return getString(key,null);}
 public String getString(String key,String fallback){return data.optString(key,fallback);}
 public void resolve(JSObject result){if(!response.complete(result))throw new AssertionError("Duplicate response");}
 public String status(){JSObject result=response.getNow(null);return result==null?"pending":result.getString("status");}
 public JSObject result()throws Exception{return response.get(5,java.util.concurrent.TimeUnit.SECONDS);}
}`,
  'ai/alphacompute/alphaphone/AlphaCalendarPlugin.java': `package ai.alphacompute.alphaphone;
public final class AlphaCalendarPlugin {
 public final android.app.Activity activity=new android.app.Activity();
 public final android.content.Context context;
 public final java.util.List<org.json.JSONObject> stages=new java.util.ArrayList<>();
 public boolean refuseStage;
 public AlphaCalendarPlugin(android.content.ContentResolver provider){context=new android.content.Context(provider);}
 public android.content.Context getContext(){return context;}
 public android.app.Activity getActivity(){return activity;}
 public com.getcapacitor.JSObject enqueueReviewedDeletion(org.json.JSONObject target,String operationId)throws Exception{
  stages.add(new org.json.JSONObject(target.toString()));
  if(refuseStage)throw new java.io.IOException("Synthetic enqueue receipt lost");
  com.getcapacitor.JSObject result=new com.getcapacitor.JSObject();result.put("status","queued");return result;
 }
}`,
  'android/provider/CalendarContract.java': `package android.provider;
import android.net.Uri;
public final class CalendarContract {
 public static final String AUTHORITY="calendar",ACCOUNT_TYPE_LOCAL="LOCAL";
 public static final class Calendars {public static final Uri CONTENT_URI=new Uri("calendars");public static final int CAL_ACCESS_CONTRIBUTOR=500;}
 public static final class Events {public static final Uri CONTENT_URI=new Uri("events"),CONTENT_EXCEPTION_URI=new Uri("exceptions");public static final String DTSTART="dtstart",STATUS="eventStatus",ORIGINAL_INSTANCE_TIME="originalInstanceTime";public static final int STATUS_CANCELED=2;}
 public static final class Instances {public static final Uri CONTENT_URI=new Uri("instances");public static final String EVENT_ID="event_id",BEGIN="begin",END="end";}
 public static final class Attendees {public static final Uri CONTENT_URI=new Uri("attendees");}
 public static final class Reminders {public static final Uri CONTENT_URI=new Uri("reminders");}
}`,
};

export function scopedCalendarReviewPlatform(){
  const temporary=mkdtempSync(join(tmpdir(),'alpha-scoped-calendar-review-'));
  const close=()=>rmSync(temporary,{recursive:true,force:true});
  try {
    const staged=join(temporary,'staged');
    mkdirSync(staged);
    const catalog=JSON.parse(readFileSync(join(root,manifest),'utf8'));
    const patches=catalog.patches.filter(patch=>patch.module===module);
    const source=upstreamNativeSource(root);
    const verified=materializeNativePatches({source,
      manifest:{...catalog,baseCommit:source.pin,modules:[module],patches},patchRoot:join(root,'patches/eliza'),temporary:staged});
    const guardFiles=['CalendarEventGuard.java','read/CalendarSourceIdentity.java'].map(name=>calendarSource+name);
    const put=(name,bytes)=>{
      const path=join(temporary,'ports',name);
      mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);return path;
    };
    const contentValues=shared+'content/ContentValues.java';
    const values=readFileSync(join(root,contentValues),'utf8').replace('public void put(String key,Long value)',
      'public int size(){return values.size();}public void put(String key,Integer value){values.put(key,value);}public void put(String key,Long value)');
    const generated=[...Object.entries(calendarReviewPorts).map(([name,bytes])=>put(name,bytes)),
      put('android/content/ContentValues.java',values),...guardFiles.map(name=>join(staged,name))];
    const providerFiles=[...['content/ContentUris.java','database/Cursor.java','net/Uri.java'].map(name=>shared+name),
      ...['ContentResolver.java','ContentProviderOperation.java'].map(name=>fixtures+'scoped-calendar-jvm/android/content/'+name),
      ...['SqliteCalendarProvider.java','ScopedCalendarSnapshotTest.java'].map(name=>fixtures+name)];
    return {compiled:[...generated,...providerFiles],generated,
      sources:[manifest,'upstream.lock.json','scripts/upstream-native-source.mjs','scripts/prepare-patched-native.mjs',
        ...guardFiles.map(name=>'vendor/eliza/'+name),...patches.map(row=>'patches/eliza/'+row.file),contentValues,...providerFiles],
      expected:Object.fromEntries(guardFiles.map(name=>[join(staged,name),verified.files[name]])),close};
  } catch(error){close();throw error;}
}
