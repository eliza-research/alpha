import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {javaBinary} from './fixtures/jvm-tools.mjs';
import {rewriteResidentClass} from '../vendor/eliza/packages/app/scripts/mobile/android/resident-host-sources.mjs';

const root=resolve(import.meta.dirname,'..');
const read=path=>readFileSync(join(root,path),'utf8');
const tilePath='android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaQuickSettingsTile.java';
// Alpha's tile is a registration of the shared AssistantEntryTile in the pinned plugin-native-system.
const sharedTilePath='vendor/eliza/plugins/plugin-native-system/android/src/main/java/ai/eliza/plugins/system/AssistantEntryTile.java';
const strings=read('android/app/src/main/res/values/alpha-system-entry.xml');
const names=[...strings.matchAll(/<string name="([^"]+)"/g)].map(m=>m[1]);
const rClass='package ai.elizaresearch.alphaphone; public class R { public static class drawable { public static final int notification_icon=1; } public static class string {'+names.map((n,i)=>`public static final int ${n}=${i+10};`).join('')+'}}';
const stubs={
 'android/annotation/SuppressLint.java':'package android.annotation; public @interface SuppressLint { String[] value(); }',
 'android/annotation/TargetApi.java':'package android.annotation; public @interface TargetApi { int value(); }',
 'android/content/Context.java':'package android.content; public class Context { public String getString(int id){return String.valueOf(id);} }',
 'android/content/Intent.java':'package android.content; public class Intent { public static final String ACTION_ASSIST="android.intent.action.ASSIST"; public static final int FLAG_ACTIVITY_NEW_TASK=0x10000000, FLAG_ACTIVITY_CLEAR_TOP=0x04000000; public Class<?> target; public String action; public int flags; public Intent(Context context,Class<?> cls){target=cls;} public Intent setAction(String a){action=a;return this;} public Intent addFlags(int f){flags|=f;return this;} }',
 'android/app/PendingIntent.java':'package android.app; public class PendingIntent { public static final int FLAG_UPDATE_CURRENT=0x08000000, FLAG_IMMUTABLE=0x04000000; public android.content.Intent intent; public int flags; public int requestCode; public static PendingIntent getActivity(android.content.Context c,int request,android.content.Intent i,int f){PendingIntent p=new PendingIntent();p.intent=i;p.flags=f;p.requestCode=request;return p;} }',
 'android/graphics/drawable/Icon.java':'package android.graphics.drawable; public class Icon { public static Icon createWithResource(android.content.Context c,int id){return new Icon();} }',
 'android/os/Build.java':'package android.os; public class Build { public static class VERSION { public static int SDK_INT=36; } public static class VERSION_CODES { public static final int N=24, Q=29, UPSIDE_DOWN_CAKE=34; } }',
 'android/service/quicksettings/Tile.java':'package android.service.quicksettings; public class Tile { public static final int STATE_INACTIVE=1; public int state,updates; public String subtitle,label,description; public void setIcon(android.graphics.drawable.Icon i){} public void setLabel(CharSequence s){label=s.toString();} public void setSubtitle(CharSequence s){subtitle=s.toString();} public void setContentDescription(CharSequence s){description=s.toString();} public void setState(int s){state=s;} public void updateTile(){updates++;} }',
 'android/service/quicksettings/TileService.java':'package android.service.quicksettings; public class TileService extends android.content.Context { public boolean locked; public Runnable unlock; public Tile tile=new Tile(); public int launched; public android.content.Intent lastIntent; public android.app.PendingIntent lastPending; public void onStartListening(){} public void onClick(){} public Tile getQsTile(){return tile;} public boolean isLocked(){return locked;} public void unlockAndRun(Runnable r){unlock=r;} public void startActivityAndCollapse(android.content.Intent i){lastIntent=i;launched++;} public void startActivityAndCollapse(android.app.PendingIntent p){lastPending=p;lastIntent=p.intent;launched++;} }',
 'ai/elizaresearch/alphaphone/AlphaAssistActivity.java':'package ai.elizaresearch.alphaphone; public class AlphaAssistActivity {}',
 'ai/elizaresearch/alphaphone/R.java':rClass,
};

test('actual tile defers to unlock, uses immutable explicit assist intent, and never exposes toggle state',()=>{
 const dir=mkdtempSync(join(tmpdir(),'alpha-qs-'));
 try{
  const files=[];
  for(const [path,text]of Object.entries(stubs)){const file=join(dir,path);mkdirSync(join(file,'..'),{recursive:true});writeFileSync(file,text);files.push(file);}
  const harness=join(dir,'ai/elizaresearch/alphaphone/TileTest.java');
  writeFileSync(harness,`package ai.elizaresearch.alphaphone;
public class TileTest {
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 public static void main(String[] args){
  AlphaQuickSettingsTile t=new AlphaQuickSettingsTile();t.locked=true;t.onStartListening();
  check(t.tile.updates==1&&t.tile.state==android.service.quicksettings.Tile.STATE_INACTIVE,"action tile must not imply active AI/capture");
  check(t.tile.subtitle.equals(String.valueOf(R.string.alpha_quick_settings_locked)),"locked subtitle");
  t.onClick();check(t.launched==0&&t.unlock!=null,"wait for owner unlock");
  t.locked=false;t.unlock.run();check(t.launched==1,"one assist launch after unlock");
  check(t.lastIntent.target==AlphaAssistActivity.class,"explicit existing assistant");
  check(android.content.Intent.ACTION_ASSIST.equals(t.lastIntent.action),"existing assist route");
  check((t.lastPending.flags&android.app.PendingIntent.FLAG_IMMUTABLE)!=0,"immutable pending intent");
  check(t.lastPending.requestCode==41,"Alpha request code");
  AlphaQuickSettingsTile legacy=new AlphaQuickSettingsTile();android.os.Build.VERSION.SDK_INT=33;
  legacy.onClick();check(legacy.launched==1&&legacy.lastPending==null,"supported older Android intent path");
  android.os.Build.VERSION.SDK_INT=36;
  try {
   java.lang.reflect.Method method=ai.eliza.plugins.system.AssistantEntryTile.class.getDeclaredMethod("openLegacy",android.content.Intent.class);method.setAccessible(true);
   method.invoke(legacy,legacy.lastIntent);throw new AssertionError("legacy path accepted modern Android");
  } catch(java.lang.reflect.InvocationTargetException expected){check(expected.getCause() instanceof IllegalStateException,"modern OS must fail closed");}
  catch(ReflectiveOperationException broken){throw new AssertionError(broken);}
  check(legacy.launched==1,"rejected modern legacy entry launches nothing");
  legacy.onStartListening();check(legacy.tile.subtitle.equals(String.valueOf(R.string.alpha_quick_settings_open)),"open subtitle");
  legacy.tile=null;legacy.onStartListening();
  System.out.println("PASS actual Alpha tile lock/unlock and Android entry contracts");
 }
}`);
  files.push(harness,join(root,sharedTilePath),join(root,tilePath));
  execFileSync(javaBinary('javac'),['--release','11','-d',dir,...files],{timeout:60000});
  assert.match(execFileSync(javaBinary('java'),['-cp',dir,'ai.elizaresearch.alphaphone.TileTest'],{encoding:'utf8',timeout:60000}),/^PASS actual Alpha tile/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('production tile compiles against the real Android API and existing identity resources',context=>{
 const sdk=process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME||join(homedir(),'Library/Android/sdk');
 const api=join(sdk,'platforms/android-36/android.jar');
 if(!existsSync(api)){assert.ok(!process.env.CI,'Android API36 is required on CI');context.skip('Android API36 not installed; the Android build separately compiles the tile');return;}
 const dir=mkdtempSync(join(tmpdir(),'alpha-qs-api-'));
 try{
  const stub=join(dir,'AlphaAssistActivity.java'),r=join(dir,'R.java');
  writeFileSync(stub,'package ai.elizaresearch.alphaphone; public class AlphaAssistActivity extends android.app.Activity {}');writeFileSync(r,rClass);
  execFileSync(javaBinary('javac'),['--release','17','-classpath',api,'-d',dir,stub,r,join(root,sharedTilePath),join(root,tilePath)],{timeout:60000,stdio:'pipe'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('tile service is protected by Android and introduces no permission, listener or capture shortcut',()=>{
 const manifest=read('android/app/src/main/AndroidManifest.xml');
 const entry=manifest.match(/<service android:name="\.AlphaQuickSettingsTile"[\s\S]*?<\/service>/)?.[0];assert.ok(entry);
 assert.match(entry,/android:permission="android.permission.BIND_QUICK_SETTINGS_TILE"/);
 assert.match(entry,/android.service.quicksettings.TOGGLEABLE_TILE" android:value="false"/);
 const source=read(tilePath)+read(sharedTilePath);
 assert.match(read(tilePath),/class AlphaQuickSettingsTile extends AssistantEntryTile/);
 for(const text of ['getUserMedia','requestPermissions','startForegroundService','setShowWhenLocked','setTurnScreenOn','requestDismissKeyguard','setData(','putExtra(','CloudProtocol','startGoogle'])assert.ok(!source.includes(text),text);
});

test('notification projection changes fixed product presentation while preserving lifecycle and provenance',()=>{
 // The pinned upstream rewrite owns the anchors; android/consumer-host.json supplies Alpha's
 // installed presentation names, exactly as scripts/stage-local-agent-sources.mjs passes them.
 const script=read('scripts/stage-local-agent-sources.mjs');
 const {residentHost}=JSON.parse(read('android/consumer-host.json'));
 const identity={packageName:JSON.parse(read('app.config.json')).appId,sockets:residentHost.sockets,notification:residentHost.notification,environmentHook:residentHost.environmentHook,lifecycleHooks:residentHost.lifecycleHooks};
 assert.ok(script.includes('lifecycleHooks:residentHost.lifecycleHooks')&&script.includes('classes:[...RESIDENT_HOST_CLASSES,...residentHost.classes]'));
 const project=value=>rewriteResidentClass('ElizaAgentService',value,identity);
 const original=read('vendor/eliza/packages/app/platforms/android/app/src/main/java/ai/elizaos/app/ElizaAgentService.java'),generated=project(original);
 assert.ok(generated.includes('getString(R.string.alpha_runtime_running_detail)'));
 assert.ok(generated.includes('.setSmallIcon(R.drawable.notification_icon)')&&!generated.includes('R.mipmap.ic_launcher'));
 assert.doesNotMatch(generated,/"Eliza agent|"Eliza Agent"|"Local Eliza agent runtime status"|"On-device agent ready"/,'no upstream product text reaches Alpha notifications');
 assert.ok(generated.includes('case "running":')&&generated.includes('case "stop-failed":'));
 assert.ok(generated.includes('.addAction(0, "Stop", stopPending)'));
 assert.equal((generated.match(/\.setColor\(0xff0000ff\)/g)||[]).length,2);
 // Suspend the previous transport atomically before exposing a rotated root, and resume
 // canonical notification recovery on all four running paths, after readiness only.
 assert.equal(generated.split('            AlphaLocalAgentPlugin.publishNotificationRoot(() -> { currentLocalAgentToken = token; });').length,2);
 assert.equal(generated.split('currentStatus = "running"; AlphaCanonicalNotifications.resumeExisting(getApplicationContext());').length,5);
 assert.equal(generated.split('currentStatus = "running";').length,5);
 const bootstrap=generated.slice(generated.indexOf('private Notification buildBootstrapNotification('),generated.indexOf('    private void pushNotification()'));
 assert.ok(!bootstrap.includes('PendingIntent'),'preserve startup binder-free notification path');
 const nativeTitles=['alpha_runtime_title','alpha_runtime_running','alpha_runtime_starting','alpha_runtime_stopped','alpha_runtime_asset_error','alpha_runtime_missing_files','alpha_runtime_spawn_failed','alpha_runtime_restart_blocked'];
 for(const name of nativeTitles)assert.ok(names.includes(name));
 // Every runtime notification string the descriptor names is an Alpha resource.
 for(const name of Object.values(residentHost.notification.strings))assert.ok(names.includes(name),name);
 assert.ok(!strings.includes('Cloud connected')&&!strings.includes('AI ready')&&!strings.includes('Listening'));
 assert.throws(()=>project(original.replace('"Eliza agent · Running"','"Changed upstream title"')),/Review changed runtime notification presentation/);
 // Provenance: the staged-source receipt records each file's source and generated digests.
 assert.ok(script.includes('sourceSha256:row.sourceSha256')&&script.includes('generatedSha256:row.generatedSha256'));
});
