// Controlled ELF/overlay fixtures exercise the trusted descriptor bridge, not APK execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {alphaNativeOptions} from '../scripts/aosp-native-admission.ts';
import {stageAndroidNative, finalizeAndroidNative} from '../vendor/eliza/packages/os/scripts/android/android-native-admission.mjs';
import {renderOverlay} from '../vendor/eliza/packages/os/scripts/android/stage-launcher-overlay.ts';
import {LAUNCHER_DEFAULT_PERMISSIONS, LAUNCHER_PRIVILEGED_PERMISSIONS} from '../scripts/stage-aosp.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const identity = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.config.json'), 'utf8'));
function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-native-overlay-'));
 t.after(() => fs.rmSync(root, {recursive:true, force:true}));
 const apk = path.join(root, 'input.apk'), output = path.join(root, 'overlay');
 execFileSync('python3', ['-c', `import sys,zipfile
elf=b'\\x7fELF\\x02\\x01'+bytes(12)+b'\\xb7\\x00'+bytes(44)
with zipfile.ZipFile(sys.argv[1],'w',compression=zipfile.ZIP_STORED) as z:z.writestr('lib/arm64-v8a/libfixture.so',elf)
`, apk]);
 const launcher = {schemaVersion:1, brand:'alphaphone', moduleName:identity.moduleName, packageName:identity.appId,
  apkSha256:createHash('sha256').update(fs.readFileSync(apk)).digest('hex'), certificateSha256:'1'.repeat(64),
  defaultPermissions:LAUNCHER_DEFAULT_PERMISSIONS, privilegedPermissions:LAUNCHER_PRIVILEGED_PERMISSIONS};
 const overlay = renderOverlay(launcher);
 fs.mkdirSync(output);
 fs.copyFileSync(apk, path.join(output, 'Launcher.apk'));
 fs.writeFileSync(path.join(output, 'Android.bp'), overlay.blueprint);
 fs.writeFileSync(path.join(output, 'default-permissions.xml'), overlay.permissions);
 fs.writeFileSync(path.join(output, 'privapp-permissions.xml'), overlay.privilegedPermissions);
 const options = alphaNativeOptions({root:ROOT, output, apk, moduleName:identity.moduleName, launcher});
 return {output, launcher, overlay, options};
}

test('native admission retains the admitted launcher grants and priv-app library placement through Soong conversion', t => {
 const f = fixture(t);
 const report = stageAndroidNative(f.options);
 assert.equal(report.libraries[0].installPath, `/product/priv-app/${identity.moduleName}/lib/arm64/libfixture.so`);
 assert.equal(report.runtimeVerified, false);
 assert.equal(report.deployReady, false);
 finalizeAndroidNative(f.options);
 const blueprint = fs.readFileSync(path.join(f.output, 'Android.bp'), 'utf8');
 assert.ok(blueprint.endsWith(f.overlay.blueprint.slice(f.overlay.launcher.length)));
 assert.match(blueprint, /privileged: true/);
 assert.match(blueprint, /^prebuilt_priv_app_native\s*\{/m);
 assert.doesNotMatch(blueprint, /^prebuilt_priv_app\s*\{/m);
 assert.equal(fs.readFileSync(path.join(f.output, 'default-permissions.xml'), 'utf8'), f.overlay.permissions);
 assert.equal(fs.readFileSync(path.join(f.output, 'privapp-permissions.xml'), 'utf8'), f.overlay.privilegedPermissions);
 assert.equal(fs.existsSync(path.join(f.output, 'Android.mk')), false);
});

test('native admission refuses a mutated output blueprint without accepting it as its expected policy', t => {
 const f = fixture(t), changed = f.overlay.blueprint + '\nandroid_app_import { name: "Unreviewed" }\n';
 fs.writeFileSync(path.join(f.output, 'Android.bp'), changed);
 assert.throws(() => stageAndroidNative(f.options), /fresh, exact upstream launcher overlay/);
 assert.equal(fs.readFileSync(path.join(f.output, 'Android.bp'), 'utf8'), changed);
 assert.equal(fs.existsSync(path.join(f.output, 'native-arm64')), false);
});

test('native admission refuses descriptor identity or privilege changes and requires the admitted descriptor', t => {
 const f = fixture(t);
 assert.throws(() => stageAndroidNative({...f.options, launcher:{...f.launcher, moduleName:'AnotherLauncher'}}), /differs from the admitted launcher/);
 assert.throws(() => stageAndroidNative({...f.options, launcher:{...f.launcher, privilegedPermissions:undefined}}), /fresh, exact upstream launcher overlay/);
 assert.throws(() => stageAndroidNative({...f.options, launcher:{...f.launcher, privilegedPermissions:['android.permission.WRITE_SECURE_SETTINGS']}}), /Invalid privileged permissions/);
 assert.throws(() => alphaNativeOptions({...f.options, root:ROOT, launcher:undefined}), /admitted launcher descriptor is required/);
 assert.equal(fs.readFileSync(path.join(f.output, 'Android.bp'), 'utf8'), f.overlay.blueprint);
 assert.equal(fs.existsSync(path.join(f.output, 'native-arm64')), false);
});
