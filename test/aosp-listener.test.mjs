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

await loadListenerSystemuiTests();

const appId = 'ai.alphacompute.alphaphone';
const listener = `${appId}.sense`;

test('Alpha stages the same reviewed listener bytes its tools inspected', t => {
 const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-listener-copy-'));
 t.after(() => fs.rmSync(temp, {recursive:true, force:true}));
 const apk = path.join(temp, 'input.apk');
 execFileSync('python3', ['vendor/eliza/packages/app/test/android/sense-fixtures/write-listener-apk.py', apk]);
 const original = fs.readFileSync(apk), signer = 'a'.repeat(64);
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
  return outputs.get(key);
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
});
