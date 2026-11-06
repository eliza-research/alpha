// Always-on listener (issue #424): plain-JVM policy checks and source/manifest invariants.
// This compiles no APK, runs nothing on Android and boots no image. Device, image and
// long-running acceptance are separate gates (docs/adr/0001-privileged-listener.md).
import test from 'node:test';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const root=resolve(import.meta.dirname,'..');
const sense=join(root,'android/sense');
const source=join(sense,'src/main/java/ai/elizaresearch/alphaphone/sense');
const read=path=>readFileSync(join(root,path),'utf8');
const java=process.env.JAVA_HOME||(process.platform==='darwin'?'/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home':'');
const binary=name=>java?join(java,'bin',name):name;

test('listener policy, crash-loop breaker, speech gate and wake phrase run on the JVM',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'listener-policy-'));
 try{
  const pure=['ListenerPolicy','CrashLoopBreaker','SpeechGate','WakePhrase'].map(name=>join(source,`${name}.java`));
  execFileSync(binary('javac'),['--release','11','-d',temporary,...pure,join(root,'test/fixtures/ListenerPolicyTest.java')],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.sense.ListenerPolicyTest'],{encoding:'utf8',timeout:60000}),/^PASS listener policy/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('SystemUI indicator lease: renewal, expiry, binder death, hidden view, reboot before unlock and crash loop run on the JVM',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'listener-lease-'));
 try{
  execFileSync(binary('javac'),['--release','11','-d',temporary,...['ListenerPolicy','IndicatorLease','CrashLoopBreaker'].map(name=>join(source,`${name}.java`)),join(root,'test/fixtures/ListenerLeaseTest.java')],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.sense.ListenerLeaseTest'],{encoding:'utf8',timeout:60000}),/^PASS listener indicator lease/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

// Type-checks every listener source against the real Android 36 platform jar (stubs only for the
// paradee-voice API and R). Host compilation only: not a Gradle/AGP build, APK, install or device run.
const sdk=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,process.platform==='darwin'?join(homedir(),'Library/Android/sdk'):join(homedir(),'Android/Sdk')].filter(Boolean).map(dir=>join(dir,'platforms/android-36/android.jar')).find(file=>existsSync(file));
test('every listener source compiles against the Android 36 platform jar',{skip:sdk?false:'Android SDK platform 36 not installed'},()=>{
 const temporary=mkdtempSync(join(tmpdir(),'listener-android-jar-'));
 try{
  const stubs={'ai/eliza/voice/NativeAsr.java':'package ai.eliza.voice; public interface NativeAsr extends AutoCloseable { String transcribe(float[] pcm); void cancel(); @Override void close(); }',
   'ai/eliza/voice/VoiceAssets.java':'package ai.eliza.voice; public final class VoiceAssets { public static VoiceAssets install(android.content.Context context){return new VoiceAssets();} public NativeAsr openAsr(){return null;} }',
   'ai/elizaresearch/alphaphone/sense/R.java':'package ai.elizaresearch.alphaphone.sense; public final class R { public static final class drawable { public static final int ic_listening=1; } }'};
  const files=Object.entries(stubs).map(([name,text])=>{const file=join(temporary,'stubs',name);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text);return file;});
  execFileSync(binary('javac'),['-source','21','-target','21','-Xlint:-options','-cp',sdk,'-d',join(temporary,'out'),...files,...readdirSync(source).filter(name=>name.endsWith('.java')).map(name=>join(source,name))],{timeout:120000});
 }finally{rmSync(temporary,{recursive:true,force:true});}
});

test('the pure policy classes stay free of Android APIs so the JVM test exercises the shipped code',()=>{
 for(const name of ['ListenerPolicy','CrashLoopBreaker','SpeechGate','WakePhrase','IndicatorLease'])
  assert.doesNotMatch(readFileSync(join(source,`${name}.java`),'utf8'),/import android\./,name);
});

test('the listener manifest has no network access and only the reviewed privileged permissions',()=>{
 const manifest=read('android/sense/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g,'');
 const requested=[...manifest.matchAll(/<uses-permission android:name="([^"]+)"(?![^>]*tools:node="remove")/g)].map(match=>match[1]).sort();
 assert.deepEqual(requested,[
  'android.permission.CAPTURE_AUDIO_HOTWORD','android.permission.FOREGROUND_SERVICE','android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.HIDE_OVERLAY_WINDOWS','android.permission.POST_NOTIFICATIONS','android.permission.RECORD_AUDIO',
  'android.permission.START_ACTIVITIES_FROM_BACKGROUND'].sort());
 assert.match(manifest,/android\.permission\.INTERNET" tools:node="remove"/,'merged INTERNET is stripped');
 assert.match(manifest,/android\.permission\.ACCESS_NETWORK_STATE" tools:node="remove"/,'merged network state is stripped');
 for(const forbidden of ['CAPTURE_AUDIO_OUTPUT','CAPTURE_MEDIA_OUTPUT','CAPTURE_VOICE_COMMUNICATION_OUTPUT','BYPASS_CONCURRENT_RECORD_AUDIO_RESTRICTION','RECORD_BACKGROUND_AUDIO','READ_PHONE_STATE','MODIFY_AUDIO_ROUTING'])
  assert.doesNotMatch(manifest,new RegExp(forbidden),forbidden);
 assert.match(manifest,/android:persistent="true"/);
 assert.match(manifest,/android:directBootAware="true"/);
 assert.match(manifest,/android:allowBackup="false"/);
 assert.match(manifest,/\.ListeningService" android:exported="false"\s+android:foregroundServiceType="microphone"/);
 assert.match(manifest,/\.ListenerActionReceiver" android:exported="false"/);
 assert.match(manifest,/\.ListenerControlProvider" android:exported="true"[\s\S]*?android:permission="ai\.elizaresearch\.alphaphone\.sense\.permission\.LISTENER_CONTROL"/);
 assert.match(manifest,/LISTENER_CONTROL"\s+android:protectionLevel="signature"/);
 assert.match(manifest,/BIND_QUICK_SETTINGS_TILE/);
 // SystemUI's indicator lease: platform signature permission only, a separate authority from Alpha's control provider.
 assert.match(manifest,/\.IndicatorLeaseProvider" android:exported="true" android:directBootAware="true"\s+android:authorities="ai\.elizaresearch\.alphaphone\.sense\.indicator"\s+android:permission="android\.permission\.STATUS_BAR_SERVICE"/);
});

test('capture fails closed on the SystemUI indicator lease and a lost lease never resumes silently',()=>{
 const provider=readFileSync(join(source,'IndicatorLeaseProvider.java'),'utf8');
 assert.match(provider,/checkCallingPermission\(STATUS_BAR_SERVICE\)/);
 assert.match(provider,/IndicatorLease\.admitsController\(holds,caller,owners,platform\)/);
 assert.match(provider,/checkSignatures\("android",owners\[0\]\)/,'platform-signed caller');
 assert.match(provider,/IBinder\.DeathRecipient recipient=\(\)->\{Listener\.lease\.binderDied\(generation\);Listener\.refresh\(context\);\};/,'SystemUI death stops capture at once');
 assert.match(provider,/token\.linkToDeath\(recipient,0\)/);
 assert.doesNotMatch(provider,/grantConsent|setEnabled|resume\(|store\.|startForegroundService/,'the lease can only withhold capture');
 const listener=readFileSync(join(source,'Listener.java'),'utf8');
 assert.match(listener,/in\.indicatorLeaseValid=observeIndicatorLease\(context,SystemClock\.elapsedRealtime\(\)\)/);
 assert.match(listener,/if\(!asleep&&ListenerPolicy\.latchesIndicatorLoss\(held\|\|paused,valid,loss\.pause\(\)\)\)indicatorLost=true;/,'only unexplained losses latch');
 assert.match(listener,/boolean asleep=IndicatorLease\.sleepLapse\(held,indicatorPause,loss\);/,'only a lapse during a display-off pause with the microphone released is excused');
 assert.match(listener,/in\.indicatorPause=indicatorPause;/,'explained hidden states pause rather than stop');
 assert.match(provider,/extras\.getString\(IndicatorLease\.KEY_DISPLAY\),extras\.getString\(IndicatorLease\.KEY_REASON\)/,'display state and reason come from SystemUI');
 const app=readFileSync(join(source,'SenseApplication.java'),'utf8');
 assert.match(app,/ACTION_SCREEN_OFF/,'the listener tracks the screen itself to resolve an unknown display state');
 const consentScreen=readFileSync(join(source,'ConsentActivity.java'),'utf8');
 assert.match(consentScreen,/Always-on display shows the Listening indicator/,'consent explains screen-off listening');
 assert.match(consentScreen,/button\("Always-on display settings",view->openAlwaysOnDisplaySettings\(\)\)/,'consent links the AOD setting');
 const service=readFileSync(join(source,'ListeningService.java'),'utf8');
 assert.match(service,/main\.postDelayed\(leaseCheck,Listener\.lease\.nextCheckDelay/,'lease watchdog while the microphone is held');
 assert.match(service,/if\(!Listener\.observeIndicatorLease\(ListeningService\.this,now\)\)apply\(\);/);
 assert.match(service,/if\(filled==frame\.length&&leased&&analyse/,'no frame is analysed without a fresh lease');
 assert.match(service,/if\(!Listener\.observeIndicatorLease\(this,SystemClock\.elapsedRealtime\(\)\)\)\{main\.post\(reapply\);return;\}\s*text=local\.transcribe/,'no recognition without a fresh lease');
 assert.match(service,/Listener\.microphoneHeld=true;/);assert.match(service,/Listener\.microphoneHeld=false;/);
 const store=readFileSync(join(source,'ListenerStore.java'),'utf8');
 assert.match(store,/void resume\(\)\{[^\n]*Listener\.indicatorLost=false;\}/,'only an explicit resume or turn-on clears the latch');
 assert.doesNotMatch(store.slice(store.indexOf('void pause('),store.indexOf('void resume(')),/indicatorLost/,'pausing never clears it');
});

test('audio and transcripts stay in RAM and invocation carries no content',()=>{
 const files=readdirSync(source).filter(name=>name.endsWith('.java'));
 const all=files.map(name=>readFileSync(join(source,name),'utf8')).join('\n');
 assert.doesNotMatch(all,/java\.net\.|HttpURLConnection|Socket\b|okhttp|FileOutputStream|openFileOutput|MediaRecorder\.setOutputFile|getExternal/,'no network or file writes in the listener');
 const service=readFileSync(join(source,'ListeningService.java'),'utf8');
 assert.match(service,/Arrays\.fill\(frame,\(short\)0\)/,'capture frames are zeroed');
 assert.match(service,/finally\{Arrays\.fill\(samples,0f\);recognizing\.set\(false\);\}/,'utterances are zeroed after recognition');
 assert.match(service,/text=null;/,'transcript reference dropped after classification');
 assert.match(service,/FOREGROUND_SERVICE_TYPE_MICROPHONE/);
 assert.match(service,/registerAudioRecordingCallback/,'observes other recordings and silencing');
 assert.match(service,/addOnModeChangedListener/,'observes calls through the audio mode');
 const invocation=readFileSync(join(source,'AssistantInvocation.java'),'utf8');
 assert.doesNotMatch(invocation,/putExtra|setData|ClipData/,'the assistant intent carries no content');
 assert.match(invocation,/checkSignatures/,'only a same-signer Alpha is invoked');
 assert.match(invocation,/setShareIdentityEnabled\(true\)/);
 const provider=readFileSync(join(source,'ListenerControlProvider.java'),'utf8');
 assert.match(provider,/checkCallingPermission\(Listener\.CONTROL_PERMISSION\)/,'call() enforces the permission itself');
 assert.doesNotMatch(provider,/grantConsent|setEnabled\(true\)|resume\(\)/,'Alpha can only reduce capability');
 const notifications=readFileSync(join(source,'ListenerNotifications.java'),'utf8');
 assert.match(notifications,/VISIBILITY_PUBLIC/);
 assert.match(notifications,/"Pause",ListenerActionReceiver\.PAUSE,1,false/,'pause works on the lock screen');
 assert.match(notifications,/"Resume",ListenerActionReceiver\.RESUME,3,ListenerPolicy\.resumeRequiresUnlock\(\)/,'resume needs unlock');
 assert.match(notifications,/setDeleteIntent\(action\(context,ListenerActionReceiver\.DISMISSED/,'dismissing the indicator is handled');
 assert.match(notifications,/IMPORTANCE_DEFAULT\);/,'the indicator channel is not a silent (LOW) channel the lock screen can hide');
 assert.match(readFileSync(join(source,'ListenerActionReceiver.java'),'utf8'),/PAUSE\.equals\(action\)\|\|DISMISSED\.equals\(action\)/,'dismissal pauses');
 const listener=readFileSync(join(source,'Listener.java'),'utf8');
 assert.match(listener,/in\.notificationsVisible=ListenerNotifications\.indicatorVisible\(context\)/);
 assert.match(listener,/in\.userForeground=/);
 assert.match(listener,/SystemClock\.elapsedRealtime\(\)/,'pauses use the monotonic clock');
 const consent=readFileSync(join(source,'ConsentActivity.java'),'utf8');
 assert.match(consent,/consentPermissionsGranted\(/,'consent needs microphone and notifications');
 assert.doesNotMatch(consent,/System\.currentTimeMillis\(\),(15|60)/,'no wall-clock pauses');
 assert.match(consent,/state\.getLong\(PENDING_PROCESS,0\)==processIdentity\(\)/,'a pending consent request survives recreation only within the same process');
 const app=readFileSync(join(source,'SenseApplication.java'),'utf8');
 for(const action of ['ACTION_USER_FOREGROUND','ACTION_USER_BACKGROUND','ACTION_SHUTDOWN','ACTION_APP_BLOCK_STATE_CHANGED','ACTION_NOTIFICATION_CHANNEL_BLOCK_STATE_CHANGED'])assert.match(app,new RegExp(action),action);
 assert.match(service,/ListenerPolicy\.callMode\(mode\)/,'ringing pauses');
 assert.match(service,/ListenerPolicy\.playbackSuppressesWake\(/,'speech-capable playback suppresses wake');
 assert.match(service,/ListenerPolicy\.mayInvokeAssistant\(keyguard==null\|\|keyguard\.isKeyguardLocked\(\)\)/,'never invokes behind the keyguard');
 // A channel lowered to silent/hidden sends no broadcast: the held microphone re-checks the indicator.
 assert.match(service,/holdsMicrophone\(state\)\)\{startCapture\(\);main\.postDelayed\(indicatorCheck,ListenerPolicy\.INDICATOR_RECHECK_MS\);main\.postDelayed\(leaseCheck,/,'indicator re-checked while the microphone is held');
 assert.match(service,/if\(!ListenerNotifications\.indicatorVisible\(ListeningService\.this\)\)apply\(\);/,'a hidden indicator converges the service');
 assert.match(service,/if\(!ListenerNotifications\.indicatorVisible\(this\)\)\{main\.post\(reapply\);return;\}\s*if\(!Listener\.observeIndicatorLease\(this,SystemClock\.elapsedRealtime\(\)\)\)\{main\.post\(reapply\);return;\}\s*text=local\.transcribe/,'no recognition while the indicator is hidden');
 assert.match(service,/registerContentObserver\(Settings\.Secure\.getUriFor\(ListenerNotifications\.LOCK_SCREEN_SHOW_NOTIFICATIONS\)/,'observes the device-wide lock-screen notification setting');
 assert.match(notifications,/lockScreenShowsNotifications\(context\)\);/,'the lock-screen notification setting is a visibility input');
});

test('the listener is an image-only APK, never part of the standalone or launcher APK',()=>{
 assert.match(read('android/settings.gradle'),/^include ':sense'$/m);
 assert.doesNotMatch(read('android/app/build.gradle'),/:sense/,':app never depends on the listener');
 const build=read('android/sense/build.gradle');
 assert.match(build,/applicationId "\$\{identity\.appId\}\.sense"/);
 assert.doesNotMatch(build,/sherpa|on{2}x|kokoro/i,'no other speech runtime');
 assert.match(build,/implementation project\(':local-speech'\)/,'the same shared paradee-voice library on libelizainference as Alpha');
 assert.match(build,/\.eliza\/paradee-voice\/native\/jniLibs/,'it packages its own copy of the staged engine');
 assert.match(read('android/sense/src/main/java/ai/elizaresearch/alphaphone/sense/ListeningService.java'),/ai\.eliza\.voice\.VoiceAssets\.install\(this\)\.openAsr\(\)/);
 assert.doesNotMatch(build,/ALPHA_[A-Z_]+/,'no invented ALPHA_ variables');
 assert.doesNotMatch(build,/okhttp|retrofit|firebase|play-services/i);
 const app=read('android/app/src/main/AndroidManifest.xml');
 for(const privileged of ['CAPTURE_AUDIO_HOTWORD','START_ACTIVITIES_FROM_BACKGROUND','RECORD_BACKGROUND_AUDIO'])
  assert.doesNotMatch(app,new RegExp(privileged),`Alpha stays nonprivileged: ${privileged}`);
});

test('Alpha reports the invocation origin only from Android caller identity and stays a nonprivileged client',()=>{
 const temporary=mkdtempSync(join(tmpdir(),'assist-invocation-'));
 try{
  execFileSync(binary('javac'),['--release','11','-d',temporary,join(root,'android/app/src/main/java/ai/elizaresearch/alphaphone/AssistInvocation.java'),join(root,'test/fixtures/AssistInvocationTest.java')],{timeout:60000});
  assert.match(execFileSync(binary('java'),['-cp',temporary,'ai.elizaresearch.alphaphone.AssistInvocationTest'],{encoding:'utf8',timeout:60000}),/^PASS assist invocation/);
 }finally{rmSync(temporary,{recursive:true,force:true});}
 const activity=read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaAssistActivity.java');
 assert.match(activity,/getLaunchedFromPackage\(\)/);
 assert.match(activity,/caller\.getPackage\(\)/);
 assert.match(activity,/checkSignatures\(getPackageName\(\), caller\)/);
 assert.match(activity,/state == null && Build\.VERSION\.SDK_INT/,'a recreated activity is not a new invocation');
 assert.match(activity,/invocation = AssistInvocation\.ASSIST;\s*return origin;/,'the listener origin is consumed on read');
 const agentPlugin=read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java');
 assert.match(agentPlugin,/@PluginMethod public void takeInvocation/);
 assert.doesNotMatch(agentPlugin.slice(agentPlugin.indexOf('void launchSurface'),agentPlugin.indexOf('/** How this assistant surface')),/takeInvocation\(\)/,'launchSurface does not consume the origin');
 assert.doesNotMatch(activity,/getStringExtra|getExtras|getData\(\)|getClipData/,'caller content is never read');
 const plugin=read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaListenerPlugin.java');
 assert.match(plugin,/@CapacitorPlugin\(name="AlphaListener"\)/);
 assert.deepEqual([...plugin.matchAll(/control\(call,"([a-zA-Z]+)"\)/g)].map(match=>match[1]),['status','pause','turnOff'],'no enable or resume method');
 assert.match(plugin,/checkSignatures\(context\.getPackageName\(\),LISTENER_PACKAGE\)==PackageManager\.SIGNATURE_MATCH/);
 assert.match(read('android/app/src/main/java/ai/elizaresearch/alphaphone/MainActivity.java'),/registerPlugin\(AlphaListenerPlugin\.class\);/);
 const manifest=read('android/app/src/main/AndroidManifest.xml');
 assert.match(manifest,/<package android:name="ai\.elizaresearch\.alphaphone\.sense"\/>/);
 assert.match(manifest,/<uses-permission android:name="ai\.elizaresearch\.alphaphone\.sense\.permission\.LISTENER_CONTROL" \/>/);
});

test('the renderer contract never reports listening from a malformed or non-listening reply',async()=>{
 const {parseListenerStatus,parseAssistantInvocation,LISTENER_STATES}=await import('../apps/app/src/runtime/always-on-listener-status.ts');
 const policy=readFileSync(join(source,'ListenerPolicy.java'),'utf8');
 const javaStates=[...policy.slice(policy.indexOf('public enum State'),policy.indexOf('/** Observed inputs')).matchAll(/^\s{2}([A-Z_]+),?\s*$/gm)].map(match=>match[1]);
 assert.deepEqual([...LISTENER_STATES].sort(),[...javaStates].sort(),'renderer and native state names agree');
 assert.deepEqual(parseListenerStatus(null),{available:false});
 assert.deepEqual(parseListenerStatus({available:true,state:'SOMETHING'}),{available:false});
 assert.deepEqual(parseListenerStatus({available:true,state:'LISTENING',label:'Listening',consented:true,listening:true,microphoneOpen:true}),
  {available:true,state:'LISTENING',label:'Listening',consented:true,listening:true,microphoneOpen:true});
 assert.equal(parseListenerStatus({available:true,state:'PAUSED_USER',listening:true}).listening,false,'only LISTENING is listening');
 assert.equal(parseListenerStatus({available:true,state:'OFF',label:'x'.repeat(200)}).label,'Listening off');
 assert.equal(parseAssistantInvocation({assistant:true,invocation:'listener'}),'listener');
 assert.equal(parseAssistantInvocation({assistant:true,invocation:'other'}),'assist');
 assert.equal(parseAssistantInvocation({assistant:true}),'assist');
 assert.equal(parseAssistantInvocation({assistant:false,invocation:'listener'}),null);
 assert.equal(parseAssistantInvocation(undefined),null);
 const adapter=read('apps/app/src/runtime/always-on-listener.ts');
 assert.doesNotMatch(adapter.replace(/\/\*\*[\s\S]*?\*\//g,''),/resume|enable|grant/i,'the renderer cannot turn listening on');
});

test('a wake-phrase invocation starts the on-device voice assistant only when unlocked, visible and free',async()=>{
 const {listenerStartsVoice,parseInvocationUnlocked}=await import('../apps/app/src/runtime/always-on-listener-status.ts');
 const base={invocation:'listener',unlocked:true,hidden:false,dialogOpen:false,connectionOpen:false,voiceActive:false};
 assert.equal(listenerStartsVoice(base),true);
 for(const change of [{invocation:'assist'},{invocation:null},{unlocked:false},{hidden:true},{dialogOpen:true},{connectionOpen:true},{voiceActive:true}])
  assert.equal(listenerStartsVoice({...base,...change}),false,JSON.stringify(change));
 assert.equal(parseInvocationUnlocked({locked:false}),true);
 for(const raw of [{locked:true},{},null,{locked:'false'}])assert.equal(parseInvocationUnlocked(raw),false,'missing or malformed keyguard state counts as locked');
 const plugin=read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaLocalAgentPlugin.java');
 assert.match(plugin,/boolean locked=keyguard==null\|\|keyguard\.isKeyguardLocked\(\);/);
 const main=read('apps/app/src/main.tsx');
 assert.match(main,/if \(isAndroid && assistantSurface\) installListenerInvocation\(/,'only the assistant surface consumes the invocation');
 const runtime=read('apps/app/src/runtime/always-on-listener.ts');
 assert.match(runtime,/if \(start\) void current\.startVoice\(\);/,'the turn runs in the voice assistant (local VAD, ASR and TTS), not in the listener');
 assert.match(runtime,/state\.connectionOpen\(\) \|\| !state\.connected\(\)\) return;\s*checking = true;/,'the one-shot origin is read only once the connection has settled');
 assert.match(runtime,/\[role="dialog"\]\[aria-modal="true"\]/,'ARIA modal dialogs block the microphone too');
 const activity=read('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaAssistActivity.java');
 assert.match(activity,/AssistInvocation\.take\(invocation, invocationAt, android\.os\.SystemClock\.elapsedRealtime\(\), invocationLocked\)/,'unread listener origins expire and remember the keyguard at arrival');
 assert.match(activity,/triggerWindowJSEvent\(INVOCATION_EVENT\)/);
});

test('Settings shows the listener status and offers only Pause, Turn off and the listener settings',()=>{
 const settings=read('apps/app/src/prototype/settings-adapter.ts');
 // One Listening row, present only where the AOSP listener exists; its page holds the controls.
 assert.match(settings,/listener\.available \? row\('Listening', go\('listening'\)/);
 assert.match(settings,/status\.listening \|\| status\.microphoneOpen \? row\('Pause'/);
 assert.match(settings,/status\.consented && status\.state !== 'OFF' \? row\('Turn off'/);
 assert.match(settings,/row\('Listener settings'/);
 assert.doesNotMatch(settings,/Resume listening|Turn on listening|resumeListener/,'Alpha cannot turn listening on or resume it');
});
