// Files on Android 10 (API 29, minSdk): legacy storage instead of all-files access, which API 29
// does not have.  section 4 (decision F1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {distributionProblems, legacyStorageProblems} from '../scripts/apk.ts';
import {startupFilesAccess} from '../apps/app/src/startup-permission-flow.ts';

test('the walkthrough treats API 29 access like all-files access', () => {
  assert.deepEqual(startupFilesAccess({access: 'granted'}), {granted: true, enabled: true, requestable: true});
  assert.deepEqual(startupFilesAccess({access: 'denied'}), {granted: false, enabled: false, requestable: true});
});

const tree = permissions => `E: manifest
  A: package="ai.alphacompute.alphaphone"
${permissions.map(([name, max]) => `  E: uses-permission
    A: android:name(0x01010003)="${name}" (Raw: "${name}")
${max === undefined ? '' : `    A: android:maxSdkVersion(0x0101020c)=(type 0x10)0x${max.toString(16)}\n`}`).join('')}  E: application
    A: android:allowBackup=(type 0x12)0x0
    A: android:usesCleartextTraffic=(type 0x12)0x0
    A: android:networkSecurityConfig=@0x7f010001
`;
test('the APK policy admits WRITE_EXTERNAL_STORAGE only up to API 29', () => {
  const W = 'android.permission.WRITE_EXTERNAL_STORAGE', R = 'android.permission.READ_EXTERNAL_STORAGE';
  assert.deepEqual(legacyStorageProblems(tree([[W, 29], [R, 32]])), []);
  assert.deepEqual(legacyStorageProblems(tree([[W, 28]])), []);
  assert.deepEqual(legacyStorageProblems(tree([[W, 30]])), ['WRITE_EXTERNAL_STORAGE is requested above API 29']);
  assert.deepEqual(legacyStorageProblems(tree([[W]])), ['WRITE_EXTERNAL_STORAGE is requested above API 29']);
  assert.deepEqual(legacyStorageProblems(tree([[R]])), ['READ_EXTERNAL_STORAGE is requested above API 32']);
  const assess = permissions => distributionProblems({xml: tree(permissions), badging: "package: name='ai.alphacompute.alphaphone' versionCode='15' versionName='15'", names: ['assets/public/licenses/third-party-notices.json']}, {mode: 'release'}).problems;
  assert.deepEqual(assess([[W, 29]]), []);
  assert.ok(assess([[W]]).includes('WRITE_EXTERNAL_STORAGE is requested above API 29'));
});
