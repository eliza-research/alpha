// Files on Android 10 (API 29, minSdk): legacy storage instead of all-files access, which API 29
// does not have. design/view-refresh-2026-11/PLAN.md section 4 (decision F1).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {distributionProblems, legacyStorageProblems} from '../scripts/apk.mjs';
import {startupFilesAccess} from '../apps/app/src/startup-permission-flow.ts';

const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
const catalog = readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/StorageCatalog.java', 'utf8');
const plugin = readFileSync('android/app/src/main/java/ai/elizaresearch/alphaphone/AlphaFilesPlugin.java', 'utf8');

test('the manifest asks for legacy storage on API 29 only and keeps all-files access for API 30+', () => {
  assert.match(manifest, /<application [^>]*android:requestLegacyExternalStorage="true"/);
  assert.match(manifest, /<uses-permission android:name="android\.permission\.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29" tools:replace="android:maxSdkVersion" \/>/);
  assert.match(manifest, /<uses-permission android:name="android\.permission\.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" \/>/);
  assert.match(manifest, /<uses-permission android:name="android\.permission\.MANAGE_EXTERNAL_STORAGE"/);
  assert.doesNotMatch(manifest, /WRITE_EXTERNAL_STORAGE" tools:node="remove"/);
  // The camera plugin's own declaration and its below-29 request stay as they are upstream.
  const camera = readFileSync('vendor/eliza/plugins/plugin-native-camera/android/src/main/AndroidManifest.xml', 'utf8');
  assert.match(camera, /WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28"/);
});

test('native reports API 29 access from both storage permissions and asks for them, never the all-files page', () => {
  assert.match(catalog, /if\(Build\.VERSION\.SDK_INT>=Build\.VERSION_CODES\.R\)return Environment\.isExternalStorageManager\(\)\?"granted":"denied";/);
  assert.match(catalog, /if\(Build\.VERSION\.SDK_INT<Build\.VERSION_CODES\.Q\)return "unsupported";/);
  assert.match(catalog, /LEGACY_PERMISSIONS=\{android\.Manifest\.permission\.READ_EXTERNAL_STORAGE,android\.Manifest\.permission\.WRITE_EXTERNAL_STORAGE\}/);
  assert.match(catalog, /static boolean legacy\(\)\{return Build\.VERSION\.SDK_INT==Build\.VERSION_CODES\.Q;\}/);
  assert.match(plugin, /@Permission\(alias="legacyStorage",strings=\{android\.Manifest\.permission\.READ_EXTERNAL_STORAGE,android\.Manifest\.permission\.WRITE_EXTERNAL_STORAGE\}\)/);
  const request = plugin.slice(plugin.indexOf('public void storageRequestAccess('), plugin.indexOf('private void storageAccessReturned('));
  const legacy = request.slice(request.indexOf('if(StorageCatalog.legacy())'), request.indexOf('ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION'));
  assert.match(legacy, /requestPermissionForAlias\("legacyStorage",call,"legacyStorageReturned"\)/);
  assert.match(legacy, /ACTION_APPLICATION_DETAILS_SETTINGS/);
  assert.match(legacy, /return;\s*\}\s*Intent intent=new Intent\(android\.provider\.Settings\.$/, 'the legacy branch returns before the all-files page');
  assert.doesNotMatch(plugin, /StorageCatalog\.access\(\)/, 'every access read is the context-aware one');
});

test('the walkthrough treats API 29 access like all-files access', () => {
  assert.deepEqual(startupFilesAccess({access: 'granted'}), {granted: true, enabled: true, requestable: true});
  assert.deepEqual(startupFilesAccess({access: 'denied'}), {granted: false, enabled: false, requestable: true});
});

const tree = permissions => `E: manifest
  A: package="ai.elizaresearch.alphaphone"
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
  const assess = permissions => distributionProblems({xml: tree(permissions), badging: "package: name='ai.elizaresearch.alphaphone' versionCode='15' versionName='15'", names: ['assets/public/licenses/third-party-notices.json']}, {mode: 'release'}).problems;
  assert.deepEqual(assess([[W, 29]]), []);
  assert.ok(assess([[W]]).includes('WRITE_EXTERNAL_STORAGE is requested above API 29'));
});
