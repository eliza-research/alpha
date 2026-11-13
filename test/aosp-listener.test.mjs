import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {loadListenerSystemuiTests} from '../scripts/aosp-listener-systemui.ts';
import {stageListener} from '../scripts/aosp-listener.ts';
import {verifyListenerBoot} from '../scripts/verify-aosp-listener.ts';
import {assertSenseLauncher, assertSenseQualification, readSenseQualification, senseLauncherDigest, writeSenseImageActivation} from '../scripts/aosp-sense-image.ts';
import {stageAlphaSensePolicy} from '../scripts/aosp-sense-policy.ts';

await loadListenerSystemuiTests();

const appId = 'ai.alphacompute.alphaphone';
const listener = `${appId}.sense`;

test('Alpha stages the same reviewed listener bytes its tools inspected', t => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-listener-copy-'));
 t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
 const apk = path.join(temp, 'input.apk');
 execFileSync('python3', ['vendor/eliza/packages/app/test/android/sense-fixtures/write-listener-apk.py', apk]);
 const original = fs.readFileSync(apk);
 const signer = JSON.parse(fs.readFileSync('android/release-signer.json', 'utf8')).signerSha256;
 const descriptorFile = path.join(temp, 'listener.json');
 fs.writeFileSync(descriptorFile, JSON.stringify({packageName:listener, apkSha256:createHash('sha256').update(original).digest('hex'), certificateSha256:signer}));
 fs.writeFileSync(path.join(temp, 'product.mk'), '');
 const apksigner = path.join(temp, 'apksigner'), aapt = path.join(temp, 'aapt');
 fs.writeFileSync(apksigner, `#!/bin/sh\n[ "$1 $2" = 'verify --print-certs' ] && [ "$3" != "$ALPHA_TEST_APK" ] || exit 2\nprintf 'substituted source' > "$ALPHA_TEST_APK"\nprintf 'Signer #1 certificate SHA-256 digest: %s\\n' '${signer}'\n`, {mode:0o700});
 fs.writeFileSync(aapt, `#!/bin/sh\n[ "$3" != "$ALPHA_TEST_APK" ] || exit 2\ncase "$2" in\n xmltree) printf 'manifest\\n';;\n permissions) cat <<'EOF'\npackage: ${listener}\nuses-permission: name='android.permission.CAPTURE_AUDIO_HOTWORD'\nuses-permission: name='android.permission.START_ACTIVITIES_FROM_BACKGROUND'\nuses-permission: name='android.permission.RECORD_AUDIO'\nuses-permission: name='android.permission.FOREGROUND_SERVICE_MICROPHONE'\nEOF\n ;;\n *) exit 2;;\nesac\n`, {mode:0o700});
 const result = stageListener({root:process.cwd(), output:temp, apk, appId, launcherSigner:signer,
  descriptorFile, production:false, aapt, apksigner, env:{...process.env, ALPHA_TEST_APK:apk}});
 assert.equal(fs.readFileSync(apk, 'utf8'), 'substituted source');
 assert.deepEqual(fs.readFileSync(path.join(temp, 'listener/AlphaSense.apk')), original);
 assert.equal(result.speechIncluded, false);
 assert.equal(result.releaseQualified, false);
 const policy = stageAlphaSensePolicy({root:process.cwd(), output:temp, appId, certificateSha256:signer});
 assert.match(policy, /^[a-f0-9]{64}$/);
 assert.ok(fs.existsSync(path.join(temp, 'listener/sepolicy/mac_permissions.xml')));
});

function bootReads({processes = '', uidList = `package:${listener} uid:10145`, enforcement = '', selinux = ''} = {}) {
 const outputs = new Map([
  [`pm list packages -s --user 0 ${listener}`, `package:${listener}`],
  [`dumpsys package ${listener}`, 'privateFlags=[ PRIVILEGED ]\nflags=[ PERSISTENT ]\nandroid.permission.CAPTURE_AUDIO_HOTWORD: granted=true'],
  [`dumpsys package ${appId}`, 'privateFlags=[ ]'],
  ['getprop ro.hotword.detection_service_required', 'true'],
  ['device_config get privacy camera_mic_icons_enabled', 'null'],
  [`dumpsys activity services ${listener}`, ''],
  [`pm list packages -s -U --user 0 ${listener}`, uidList],
  ['toybox ps -u 10145 -n -w -o LABEL,UID,PID,NAME', processes],
  ['getprop ro.control_privapp_permissions', enforcement],
  ['getenforce', selinux],
 ]);
 return (shell, ...args) => {
  assert.equal(shell, 'shell');
  const key = args.join(' ');
  if (key.startsWith('cmd role get-role-holders --user 0 android.app.role.')) return '';
  assert.ok(outputs.has(key), `Unexpected device command ${key}`);
  const output = outputs.get(key);
  if (output instanceof Error) throw output;
  return output;
 };
}

test('listener boot evidence binds the dedicated SELinux label to its package and user UID', () => {
 const result = verifyListenerBoot(bootReads({enforcement:'enforce\n', selinux:'Enforcing\n', processes:
  `LABEL UID PID NAME\nu:r:alpha_sense_app:s0:c12,c256 10145 501 ${listener}\n` +
  `u:r:priv_app:s0 110145 502 ${listener}\n` +
  `u:r:priv_app:s0 10145 503 ${listener}.other\n` +
  'u:r:shell:s0 2000 504 toybox'}), '0', appId);
 assert.deepEqual(result.listenerProcesses, [{pid:501, name:listener, domain:'alpha_sense_app'}]);
 assert.equal(result.privappPermissionsEnforced, true);
 assert.equal(result.selinuxEnforcing, true);
 assert.equal(result.dedicatedDomainObserved, true);
 assert.equal(result.indicatorVerified, false);
 assert.equal(result.invocationVerified, false);
});

test('listener boot readback gives no domain evidence for a missing or mixed process label', () => {
 for (const processes of [
  '',
  Object.assign(new Error('toybox ps exited 1'), {status:1, stdout:'LABEL   UID   PID NAME   \r\n', stderr:''}),
  `u:r:alpha_sense_app:s0 110145 501 ${listener}`,
  `u:r:priv_app:s0 10145 501 ${listener}`,
  `u:r:alpha_sense_app:s0 10145 501 ${listener}\nu:r:priv_app:s0 10145 502 ${listener}:child`,
 ]) {
  const result = verifyListenerBoot(bootReads({processes, enforcement:'log', selinux:'Permissive'}), '0', appId);
  assert.equal(result.privappPermissionsEnforced, false);
  assert.equal(result.selinuxEnforcing, false);
  assert.equal(result.dedicatedDomainObserved, false);
 }
 assert.throws(() => verifyListenerBoot(bootReads({uidList:`package:${listener} uid:10145,110145`}), '0', appId), /exact UID/);
 const failedRead = Object.assign(new Error('device disconnected'), {status:1, stdout:'', stderr:'adb: device offline'});
 assert.throws(() => verifyListenerBoot(bootReads({processes:failedRead}), '0', appId), /device disconnected/);
});

test('the Pixel product enrolls exact listener qualification and rejects candidate-only or drifting inputs', t => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-sense-qualification-'));
 t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
 const file = path.join(temp, 'qualified-listener.json');
 const {patches, ...exact} = {
  appId, launcherSha256:'1'.repeat(64), listenerSha256:'2'.repeat(64), certificateSha256:'3'.repeat(64),
  launcherDescriptorSha256:'a'.repeat(64), listenerDescriptorSha256:'b'.repeat(64),
  sourceLockSha256:'4'.repeat(64), sdkCommit:'5'.repeat(40), sepolicySha256:'6'.repeat(64),
  patches:[{name:'alpha-protected-power', manifest:{}, manifestSha256:'7'.repeat(64)}],
 };
 const {appId: ignored, ...inputs} = exact;
 const record = {schemaVersion:1, target:'pixel10a', qualified:true, packageName:listener, ...inputs,
  patchManifests:{'alpha-protected-power':'7'.repeat(64)},
  gates:Object.fromEntries(Array.from({length:7}, (_, i) => [`G${i + 1}`, {status:'passed', evidenceSha256:'8'.repeat(64)}])),
 };
 const enroll = value => {
  const bytes = JSON.stringify(value);
  fs.writeFileSync(file, bytes);
  return createHash('sha256').update(bytes).digest('hex');
 };
 const reviewed = enroll(record);
 assert.throws(() => readSenseQualification(file, undefined, true), /no reviewed/);
 assert.throws(() => readSenseQualification(file, '9'.repeat(64), true), /bytes differ/);
 const accepted = readSenseQualification(file, reviewed, true);
 assert.doesNotThrow(() => assertSenseQualification(accepted, {...exact, patches}));
 for (const field of Object.keys(inputs)) {
  assert.throws(() => assertSenseQualification(accepted, {...exact, patches, [field]:'0'.repeat(inputs[field].length)}), new RegExp(field));
 }
 assert.throws(() => assertSenseQualification(accepted, {...exact, patches:[]}), /patch manifests differ/);
 const g7Open = enroll({...record, gates:{...record.gates, G7:{status:'open'}}});
 assert.throws(() => readSenseQualification(file, g7Open, true), /G7/);
 const candidate = enroll({...record, qualified:false, gates:{}});
 assert.throws(() => readSenseQualification(file, candidate, true), /passing Pixel 10a qualification/);
 assert.doesNotThrow(() => assertSenseQualification(readSenseQualification(file, candidate, false), {...exact, patches}));
});

const launcherTree = [
 '    E: activity (line=1)',
 '      A: android:name(0x01010003)=".AlphaAssistActivity"',
 '      A: android:enabled(0x0101000e)=(type 0x12)0x0',
 '      A: android:exported(0x01010010)=(type 0x12)0xffffffff',
 '      E: intent-filter (line=2)',
 '        E: action (line=3)',
 '          A: android:name(0x01010003)="android.intent.action.ASSIST"',
 '        E: category (line=4)',
 '          A: android:name(0x01010003)="android.intent.category.DEFAULT"',
 '    E: activity (line=5)',
 '      A: android:name(0x01010003)=".AlphaPowerVoiceActivity"',
 '      A: android:enabled(0x0101000e)=(type 0x12)0x0',
 '      A: android:exported(0x01010010)=(type 0x12)0xffffffff',
 '      A: android:permission(0x01010006)="android.permission.STATUS_BAR_SERVICE"',
].join('\n');

test('the qualified image overrides only the two dormant presigned launcher activities', t => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-sense-activation-'));
 t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
 const dir = path.join(temp, 'listener');
 fs.mkdirSync(dir);
 fs.writeFileSync(path.join(dir, 'listener.mk'), 'sense_listener_dir := listener\n');
 assert.throws(() => assertSenseLauncher(launcherTree.replace('STATUS_BAR_SERVICE', 'RECORD_AUDIO'), appId), /protected explicit Power/);
 assert.throws(() => assertSenseLauncher(launcherTree.replace('E: activity (line=5)', 'E: activity-alias (line=5)'), appId), /disabled by default/);
 assert.throws(() => assertSenseLauncher(launcherTree.replace('enabled(0x0101000e)=(type 0x12)0x0', 'enabled(0x0101000e)=(type 0x12)0xffffffff'), appId), /disabled by default/);
 const {feature, assistant, power} = writeSenseImageActivation(temp, appId, launcherTree);
 assert.equal(feature, `${appId}.feature.SENSE`);
 const xml = fs.readFileSync(path.join(dir, 'alpha-sense-image.xml'), 'utf8');
 assert.match(xml, new RegExp(`<feature name="${feature}" version="1" />`));
 assert.deepEqual([...xml.matchAll(/<component class="([^"]+)" enabled="true"/g)].map(match => match[1]), [assistant, power]);
 assert.match(fs.readFileSync(path.join(dir, 'listener.mk'), 'utf8'), /TARGET_COPY_OUT_SYSTEM_EXT\)\/etc\/sysconfig/);
 assert.throws(() => writeSenseImageActivation(temp, appId, launcherTree), /EEXIST/);
});

test('the privately staged launcher cannot differ from the initial release admission', t => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-sense-launcher-'));
 t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
 const staged = path.join(temp, 'Launcher.apk');
 const admitted = createHash('sha256').update('approved release').digest('hex');
 fs.writeFileSync(staged, 'approved release');
 assert.equal(senseLauncherDigest(staged, admitted), admitted);
 fs.writeFileSync(staged, 'different reviewed image bytes');
 assert.throws(() => senseLauncherDigest(staged, admitted), /differs from the admitted release APK/);
});

test('the staging CLI refuses a production listener before reading unqualified inputs', () => {
 const target = ['--target', 'pixel10a', '--aosp-source', 'missing-source', '--factory-image', 'missing-factory'];
 const stage = (...args) => execFileSync(process.execPath, ['scripts/stage-aosp.ts', '--production', ...target, ...args],
  {stdio:'pipe', encoding:'utf8', timeout:30000});
 assert.throws(() => stage('--listener-apk', 'missing-listener.apk'), /requires Pixel 10a, --listener-apk, --listener-descriptor and --listener-qualification/);
 assert.throws(() => stage('--listener-apk', 'missing-listener.apk', '--listener-descriptor', 'missing.json',
  '--listener-qualification', 'missing-qualification.json'), /requires chip, ops, alpha-protected-power and alpha-sense-policy/);
 assert.throws(() => stage('--applied-build-patch', 'alpha-sense-policy'), /requires an activated Sense image/);
});
