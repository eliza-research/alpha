import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {materializeNativePatches} from '../../../../scripts/prepare-patched-native.ts';
import {upstreamNativeSource} from '../../../../scripts/upstream-native-source.ts';
import {root} from './java.mjs';
import {calendarReviewPorts} from './scoped-calendar-review-platform.mjs';

const calendar='plugins/plugin-native-calendar/android';
const deletion='plugins/plugin-native-action-journal/android';
const shared='vendor/eliza/plugins/plugin-native-calendar/test/jvm/android/';
const manifest='android/upstream-native-sources.json';
const testFixture='test/fixtures/scoped-calendar-jvm/android/content/';
const stagedPaths=[
  calendar+'/src/main/java/ai/eliza/plugins/calendar/write/CalendarEventOptions.java',
  ...['DeferredDeletionJournal.java','DeletionDeadline.java'].map(name=>deletion+'/src/main/java/ai/eliza/plugins/actionjournal/deletion/'+name),
];
const pinnedPaths=[
  'plugins/plugin-native-notifications/android/src/main/java/ai/eliza/plugins/notifications/NoticeOwner.java',
  'plugins/plugin-native-agent/android/src/main/java/ai/eliza/plugins/agent/runtime/NativeProviderAdmission.java',
];
const inherited=['android/Manifest.java','android/content/pm/PackageManager.java','android/content/Context.java',
  'androidx/core/content/ContextCompat.java','android/os/SystemClock.java','android/app/KeyguardManager.java',
  'androidx/lifecycle/Lifecycle.java','android/app/Activity.java','android/content/OperationApplicationException.java'];
const columns={CALENDAR_ID:'calendar_id',TITLE:'title',DESCRIPTION:'description',EVENT_LOCATION:'eventLocation',
  EVENT_TIMEZONE:'eventTimezone',ALL_DAY:'allDay',DTEND:'dtend',RRULE:'rrule',DURATION:'duration'};
const ports={
  ...Object.fromEntries(inherited.map(name=>[name,calendarReviewPorts[name]])),
  'com/getcapacitor/PluginCall.java':calendarReviewPorts['com/getcapacitor/PluginCall.java']
    .replace(' public String getString(String key){', ' public org.json.JSONObject getObject(String key,JSObject fallback){org.json.JSONObject value=getObject(key);return value==null?fallback:value;}\n public String getString(String key){'),
  'android/provider/CalendarContract.java':calendarReviewPorts['android/provider/CalendarContract.java']
    .replace('ACCOUNT_TYPE_LOCAL="LOCAL";','ACCOUNT_TYPE_LOCAL="LOCAL",CALLER_IS_SYNCADAPTER="caller_is_syncadapter";')
    .replace('CAL_ACCESS_CONTRIBUTOR=500;','CAL_ACCESS_CONTRIBUTOR=500; public static final String ACCOUNT_NAME="account_name",ACCOUNT_TYPE="account_type";')
    .replace('STATUS_CANCELED=2;','STATUS_CANCELED=2;'+Object.entries(columns).map(([key,value])=>` public static final String ${key}="${value}";`).join(''))
    .replace('public static final class Reminders', 'public static final class ExtendedProperties {public static final Uri CONTENT_URI=new Uri("properties");}\n public static final class Reminders'),
  'android/os/Looper.java':`package android.os;
public final class Looper {public static Looper getMainLooper(){return new Looper();}}`,
  'android/os/Handler.java':`package android.os;
public final class Handler {public Handler(Looper looper){}}`,
  'android/database/ContentObserver.java':`package android.database;
public class ContentObserver {
 public ContentObserver(android.os.Handler handler){}
 public void onChange(boolean self){}
}`,
  'android/content/DialogInterface.java':`package android.content;
public interface DialogInterface {
 int BUTTON_POSITIVE=-1,BUTTON_NEGATIVE=-2;
 interface OnClickListener {void onClick(DialogInterface dialog,int button);}
 interface OnDismissListener {void onDismiss(DialogInterface dialog);}
}`,
  'android/app/AlertDialog.java':`package android.app;
import android.content.DialogInterface;
public final class AlertDialog implements DialogInterface {
 private final Activity activity;
 private final Button positive=new Button(),negative=new Button();
 private OnDismissListener dismissed;
 private boolean showing;
 public String message;
 private AlertDialog(Activity activity){this.activity=activity;}
 public boolean isShowing(){return showing;}
 public void show(){showing=true;activity.shown=this;}
 public void dismiss(){if(showing){showing=false;dismissed.onDismiss(this);}}
 public void setOnDismissListener(OnDismissListener callback){dismissed=callback;}
 public void setCancelable(boolean value){}
 public Window getWindow(){return new Window();}
 public final class Window {public Window getDecorView(){return this;}public boolean hasWindowFocus(){return activity.dialogFocused;}}
 public Button getButton(int id){return id==BUTTON_POSITIVE?positive:negative;}
 public static final class Button {
  private java.util.function.Consumer<Button> click;
  private boolean enabled=true;
  public void setOnClickListener(java.util.function.Consumer<Button> listener){click=listener;}
  public void setEnabled(boolean enabled){this.enabled=enabled;}
  public boolean isEnabled(){return enabled;}
  public void click(){if(enabled&&click!=null)click.accept(this);}
 }
 public static final class Builder {
  private final AlertDialog dialog;
  public Builder(Activity activity){dialog=new AlertDialog(activity);}
  public Builder setTitle(String title){return this;}
  public Builder setMessage(String message){dialog.message=message;return this;}
  public Builder setNegativeButton(String label,OnClickListener listener){return this;}
  public Builder setPositiveButton(String label,OnClickListener listener){return this;}
  public AlertDialog create(){return dialog;}
 }
}`,
  'com/getcapacitor/JSObject.java':`package com.getcapacitor;
public final class JSObject extends org.json.JSONObject {
 public JSObject(){}
 private JSObject(String source){super(source);}
 public static JSObject fromJSONObject(org.json.JSONObject value){return new JSObject(value.toString());}
}`,
  'ai/alphacompute/alphaphone/AlphaCalendarPlugin.java':`package ai.alphacompute.alphaphone;
public final class AlphaCalendarPlugin {
 public static final class CalendarConfiguration {
  public final String accountName="Alpha Phone",localCalendarName="alpha-phone-local",displayName="Alpha Phone";
 }
 public static final CalendarConfiguration CONFIGURATION=new CalendarConfiguration();
 public final android.app.Activity activity=new android.app.Activity();
 public final android.content.Context context;
 public AlphaCalendarPlugin(android.content.ContentResolver provider){context=new android.content.Context(provider);}
 public android.content.Context getContext(){return context;}
 public android.app.Activity getActivity(){return activity;}
 void calendarSyncChanged(){}
}`,
  'ai/alphacompute/alphaphone/AlphaConnectionPlugin.java':`package ai.alphacompute.alphaphone;
import org.json.JSONObject;
final class AlphaConnectionPlugin {
 static JSONObject readCloudIdentity(String token){
  if(!AlphaCredentialStore.TOKEN.equals(token))throw new AssertionError("Unexpected synthetic token");
  return new JSONObject().put("userId","fixture-owner").put("organizationId","fixture-org");
 }
 static JSONObject readCalendarSyncCapabilities(String token,String connection,String calendar){
  if(!AlphaCredentialStore.TOKEN.equals(token)||!connection.equals("fixture-grant")||!calendar.equals("fixture-calendar"))
   throw new AssertionError("Unexpected synthetic Cloud selection");
  return new JSONObject().put("version",1).put("calendarId",calendar).put("read",true).put("write",true)
   .put("conditionalWrites",true).put("idempotentCreate",true).put("providerExactlyOnce",false)
   .put("accountEmail","calendar@example.invalid").put("calendarLabel","Synthetic Calendar").put("accountId","fixture-destination");
 }
}`,
  'ai/alphacompute/alphaphone/NativeDeletionCoordinator.java':`package ai.alphacompute.alphaphone;
import org.json.JSONArray;
import org.json.JSONObject;
final class NativeDeletionCoordinator {
 static NativeDeletionCoordinator get(android.content.Context context){return new NativeDeletionCoordinator();}
 JSONObject agentOwner(){return new JSONObject().put("kind","agent").put("identity",new JSONObject()
   .put("accountRef",new JSONArray().put("cloud").put("production").put("fixture-owner").put("fixture-org").toString())
   .put("subjectUserId","fixture-owner").put("agentId","fixture-agent").put("installationId","fixture-install")
   .put("enrollmentId","fixture-enrollment").put("environment","production"));}
 boolean stageAdmissible(JSONObject owner)throws Exception{
  return ai.eliza.plugins.actionjournal.deletion.DeferredDeletionJournal.same(owner,agentOwner());
 }
 boolean calendarPending(long calendar,long event){return false;}
 JSONObject receipt(String type,String operation){throw new AssertionError("No deletion receipt requested");}
 JSONObject stageCalendar(JSONObject target,JSONObject owner,String operation){throw new AssertionError("No deletion stage allowed");}
}`,
  'ai/alphacompute/alphaphone/AlphaCredentialStore.java':`package ai.alphacompute.alphaphone;
import java.util.ArrayList;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;
final class AlphaCredentialStore {
 static final String TOKEN="fixture-synthetic-calendar-token",ID="00000000-0000-4000-8000-000000000001";
 static final String CLOUD=new JSONObject().put("credentialId",ID).put("token",TOKEN)
   .put("userId","fixture-owner").put("organizationId","fixture-org").toString();
 static final String DISABLED=new JSONObject().put("version",1).put("enabled",false).put("operations",new JSONObject()).toString();
 static volatile String raw;
 static final ArrayList<Boolean> writes=new ArrayList<>();
 static CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);
 static volatile String hold="none",heldSnapshot;
 static int pauseRefusals,compareAttempts;
 AlphaCredentialStore(android.content.Context context){}
 static void arm(String position){
  entered=new CountDownLatch(1);release=new CountDownLatch(1);hold=position;
 }
 String readCredentialSlot(String slot)throws Exception{
  if(slot.equals("cloud:production"))return CLOUD;
  if(!slot.equals(CalendarSyncBridge.SLOT))throw new AssertionError("Unexpected storage read");
  String selected=hold;hold="none";
  String snapshot=selected.equals("after")?raw:null;
  if(selected.equals("after"))heldSnapshot=snapshot;
  if(!selected.equals("none")){
   entered.countDown();
   if(!release.await(5,TimeUnit.SECONDS))throw new AssertionError("Journal read did not resume");
  }
  return selected.equals("after")?snapshot:raw;
 }
 boolean compareExchangeCredentialSlot(String slot,String expected,String value){
  if(!slot.equals(CalendarSyncBridge.SLOT))throw new AssertionError("Unexpected storage write");
  synchronized(AlphaCredentialStore.class) {
   compareAttempts++;
   boolean enabled=new JSONObject(value).getBoolean("enabled");
   if(!enabled&&pauseRefusals>0){pauseRefusals--;return false;}
   if(!Objects.equals(raw,expected))return false;
   raw=value;writes.add(enabled);return true;
  }
 }
}`,
};

export function calendarSyncEnablePlatform(){
  const temporary=mkdtempSync(join(tmpdir(),'alpha-calendar-sync-enable-'));
  const close=()=>rmSync(temporary,{recursive:true,force:true});
  try {
    const staged=join(temporary,'staged');
    mkdirSync(staged);
    const catalog=JSON.parse(readFileSync(join(root,manifest),'utf8'));
    const modules=[calendar,deletion],patches=catalog.patches.filter(row=>modules.includes(row.module));
    const source=upstreamNativeSource(root);
    const verified=materializeNativePatches({source,manifest:{...catalog,baseCommit:source.pin,modules,patches},
      patchRoot:join(root,'patches/eliza'),temporary:staged});
    const expected=Object.fromEntries(stagedPaths.map(name=>[join(staged,name),verified.files[name]]));
    for(const name of pinnedPaths){
      assert.ok(catalog.patches.every(row=>row.targets.every(target=>target.path!==name)));
      expected[join(root,'vendor/eliza',name)]=source.read(name).get(name).sha256;
    }
    const put=(name,bytes)=>{
      const path=join(temporary,'ports',name);
      mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);return path;
    };
    const values=shared+'content/ContentValues.java',uri=shared+'net/Uri.java',resolver=testFixture+'ContentResolver.java';
    const read=name=>readFileSync(join(root,name),'utf8');
    const generated=[...Object.entries(ports).map(([name,bytes])=>put(name,bytes)),
      put('android/content/ContentValues.java',read(values).replace('public void put(String key,Long value)',
        'public int size(){return values.size();}public void put(String key,Integer value){values.put(key,value);}public void put(String key,Long value)')),
      put('android/net/Uri.java',read(uri).replace('public Uri build(){','public Builder appendQueryParameter(String key,String value){throw new AssertionError("No provider write URI");}public Uri build(){')),
      put('android/content/ContentResolver.java',read(resolver).replace('public abstract class ContentResolver {',
        'public abstract class ContentResolver {public void registerContentObserver(android.net.Uri uri,boolean descendants,android.database.ContentObserver observer){}public void unregisterContentObserver(android.database.ContentObserver observer){}')),
      ...stagedPaths.map(name=>join(staged,name))];
    const compiled=[...generated,...pinnedPaths.map(name=>'vendor/eliza/'+name),shared+'content/ContentUris.java',
      shared+'database/Cursor.java',testFixture+'ContentProviderOperation.java',
      'test/fixtures/SqliteCalendarProvider.java','test/fixtures/CalendarSyncSnapshotTest.java'];
    return {compiled,generated,expected,sources:[manifest,'upstream.lock.json','scripts/prepare-patched-native.ts',
      'scripts/upstream-native-source.ts',...patches.map(row=>'patches/eliza/'+row.file),values,uri,resolver,
      ...stagedPaths.map(name=>'vendor/eliza/'+name)],close};
  } catch(error){close();throw error;}
}
