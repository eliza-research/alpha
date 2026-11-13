import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {delimiter, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {app, directory, root} from '../specs/quint/refinement/native/java.mjs';
import {javaBinary, jsonJar, jvmTimeout} from './fixtures/jvm-tools.mjs';
import {upstreamNativeSource} from '../scripts/upstream-native-source.ts';
import {reminderPlatform} from '../specs/quint/refinement/native/reminder-delivery-platform.mjs';

const model = 'NativeReminderDelivery';
const shared = 'plugins/plugin-native-reminders/android/src/main/java/ai/eliza/plugins/reminders/';
const harness = join(directory,'ReminderDeliveryTraces.java');
const scenarios = ['stale-and-early-alarm','permission-revoked-at-delivery','blocked-due-channel-is-not-delivered',
  'notification-before-refused-durable-post',
  'notification-posted-bytes-after-ambiguous-commit','route-and-platform-refusal-recovery','reboot-permission-and-once-per-boot',
  'boot-marker-memory-and-disk-disagree','snooze-exact-occurrence-and-repeat-decision','daily-completion-advances-and-fences-old-action',
  'legacy-null-occurrence-retires-on-reschedule','reviewed-unknown-after-platform-refusal','reviewed-effect-before-refused-receipt',
  'reviewed-terminal-receipt-survives-failure-report','reviewed-silent-row-has-no-alarm',
  'direct-arm-refusal-rolls-back-and-recovery','decision-write-fails-after-durable-snooze'];
const androidLibrary = 'android-all-instrumented/16-robolectric-13921718-i7/android-all-instrumented-16-robolectric-13921718-i7.jar';

function androidJsonLibrary() {
  const provided=process.env.ALPHA_REMINDER_ANDROID_JSON_JAR;
  const robo=provided ? resolve(provided) : join(homedir(),'.m2/repository/org/robolectric',androidLibrary);
  if (provided) assert.ok(existsSync(robo),'ALPHA_REMINDER_ANDROID_JSON_JAR does not exist');
  if (process.env.ALPHA_REMINDER_JSON_ABI !== 'sdk' && existsSync(robo)) return {library:robo, androidRuntime:true};
  const sdkRoots=[process.env.ANDROID_HOME,process.env.ANDROID_SDK_ROOT,join(homedir(),'Android/Sdk')].filter(Boolean);
  const sdk=sdkRoots.map(path=>resolve(path,'platforms/android-36/android.jar')).find(existsSync);
  assert.ok(sdk,'Set ALPHA_REMINDER_ANDROID_JSON_JAR to the Android 16 Robolectric runtime or install Android SDK platform 36');
  return {library:sdk, androidRuntime:false};
}

async function checkNativeReminderDelivery(extraSources = []) {
  const {library,androidRuntime} = androidJsonLibrary();
  assert.ok(jsonJar,'The pinned host org.json jar is required to compile the shared trace writer');
  const native = ['ReminderEngine','ReminderConfiguration','ReminderStore','ReminderEnvelope',
    'ReminderReceiver','ReminderTaps','SecureStringStore'].map(name=>shared+name+'.java');
  const product = [app+'AlphaReminders.java',app+'ReminderReceiver.java'];
  const sourcePaths = [...product,...native.map(path=>'vendor/eliza/'+path)];
  const traceWriter = join(directory,'Trace.java');
  const manifest='android/app/src/main/AndroidManifest.xml';
  const sources = [...sourcePaths, manifest, harness, traceWriter, library, jsonJar, fileURLToPath(import.meta.url),
    join(directory,'reminder-delivery-platform.mjs'),'scripts/upstream-native-source.ts','upstream.lock.json',
    'android/upstream-native-sources.json','test/fixtures/jvm-tools.mjs',...extraSources];
  const driverHashes = captureInputs(sources);
  assert.match(readFileSync(join(root,manifest),'utf8'), /<receiver\s+android:name="\.ReminderReceiver"\s+android:exported="false"/);
  const catalog=JSON.parse(readFileSync(join(root,'android/upstream-native-sources.json'),'utf8'));
  const targets=new Set(catalog.patches.flatMap(patch=>patch.targets.map(target=>target.path)));
  for (const path of native) assert.ok(!targets.has(path),`Reminder fixture requires effective patched source for ${path}`);
  const upstream = upstreamNativeSource(root).read(shared);
  for (const path of native) assert.equal(driverHashes[join(root,'vendor/eliza',path)],upstream.get(path).sha256);
  const temporary = mkdtempSync(join(tmpdir(),'quint-native-reminder-'));
  let traces;
  try {
    const classes = join(temporary,'classes'), runtime = join(temporary,'android-json');
    mkdirSync(classes);mkdirSync(runtime);
    // Extract only the plain Android JSON classes. All Android OS APIs resolve to controlled source ports.
    execFileSync(javaBinary('jar'),['xf',library,'org/json'],{cwd:runtime,timeout:jvmTimeout});
    const generated = Object.entries(reminderPlatform).map(([path,source])=>{
      const file=join(temporary,path);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,source);
      return file;
    });
    const options={cwd:root,timeout:jvmTimeout,encoding:'utf8'};
    execFileSync(javaBinary('javac'),['-cp',jsonJar,'-d',classes,traceWriter],options);
    const compileClasspath=[classes,runtime].join(delimiter);
    const runClasspath=[classes,androidRuntime ? runtime : jsonJar].join(delimiter);
    execFileSync(javaBinary('javac'),['-cp',compileClasspath,'-d',classes,...generated,...sourcePaths,harness],options);
    traces=scenarios.map(mode=>JSON.parse(execFileSync(javaBinary('java'),
      ['-cp',runClasspath,'ai.eliza.plugins.reminders.ReminderDeliveryTraces',mode],options)));
  } finally {
    rmSync(temporary,{recursive:true,force:true});
  }
  const receipt=await checkTraces({model,sources,driverHashes,traces,scope:'bounded-orchestration',assumptions:[
    'The exact pinned ReminderEngine, ReminderStore, ReminderEnvelope, ReminderTaps and product AlphaReminders/ReminderReceiver execute without source edits.',
    androidRuntime ? 'Compile and execution use the Android org.json classes from the bound Robolectric artifact.' : 'Compilation uses checked Android SDK 36 org.json signatures. Execution uses the bound Maven org.json library; these source schedules have also been tested with Android JSON.',
    'The JVM owns controlled alarm capability, exact and inexact scheduling, immutable PendingIntent, notification, secure-storage and SharedPreferences ports. The original schedules keep exact capability unavailable; separate boundary probes exercise exact admission and revocation fallback. It observes native alert/tap route content and actual durable bytes, with distinct memory and disk on failed commits.',
    'The source covers one tracked reminder, four occurrence classes, controlled wall seconds, UTC daily recurrence and a reviewed creation receipt. Simulated process and boot boundaries do not invoke Android.',
  ]});
  return {receipt,obligations:[
    {model,obligation:'Installed scheduling and delivery policy',
      reason:'Doze, notification permission/channel enforcement, actual PendingIntent provenance and Android process/reboot delivery are external to the controlled ports.'},
    {model,obligation:'Larger recurrence and tap/operation scopes',
      reason:'Weekday/weekly and timezone-specific recurrence, multi-row restore, persistent tap-queue ordering, operation update/cancel/review and arbitrary capacity are outside this bounded model.'},
  ]};
}

test('native reminder ownership, notification ordering and reviewed alarm receipts refine the source', async () => {
  const {receipt} = await checkNativeReminderDelivery();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 17);
  assert.equal(receipt.observedFields.length, 29);
});
