// Source-level product identity and storage namespace (AP-01). This reads committed source only;
// built-APK identity is checked by scripts/apk.mjs and is separate evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const identity = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
const gradle = fs.readFileSync('android/app/build.gradle', 'utf8');
const manifest = fs.readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(file, out);
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name) && !/\.test\.[^.]+$/.test(entry.name)) out.push(file);
  }
  return out;
}

const STORAGE_CALL = /\.(?:getItem|setItem|removeItem)\(\s*(?:(['"`])((?:(?!\1)[^\\$])*)|([A-Za-z_$][\w$]*)\s*[,)])/g;
const PREFIXES = ['alpha.', 'alphaphone:'];
const FOREIGN = /milady|eliza:|senior/i;

/** Literal localStorage keys under a source tree: direct string arguments and the string constants passed by name. */
function literalStorageKeys(root) {
  const files = sources(root).map(file => ({file, text: fs.readFileSync(file, 'utf8')}));
  const names = new Set(), keys = [];
  for (const {file, text} of files) {
    for (const match of text.matchAll(STORAGE_CALL)) {
      if (match[3]) names.add(match[3]);
      // A template or concatenated key is checked by its literal prefix.
      else if (match[2]) keys.push({file, key: match[2]});
    }
  }
  for (const {file, text} of files) {
    for (const name of names) {
      const declared = new RegExp(`(?:^|[\\s,;{(])${name.replace(/\$/g, '\\$')}\\s*=\\s*(['"])([^'"]+)\\1`, 'g');
      for (const match of text.matchAll(declared)) keys.push({file, key: match[2]});
    }
  }
  return keys;
}

test('app.config.json carries the Alpha Phone identity', () => {
  assert.equal(identity.appId, 'ai.elizaresearch.alphaphone');
  assert.equal(identity.appName, 'Alpha Phone');
});

test('the Android build derives namespace, applicationId and app_name from app.config.json', () => {
  assert.match(gradle, /def identity = new groovy\.json\.JsonSlurper\(\)\.parse\(file\('\.\.\/\.\.\/app\.config\.json'\)\)/);
  assert.match(gradle, /^\s*namespace identity\.appId\s*$/m);
  assert.match(gradle, /^\s*applicationId identity\.appId\s*$/m);
  assert.match(gradle, /resValue 'string', 'app_name', identity\.appName/);
  assert.doesNotMatch(gradle, /applicationId\s+['"]/, 'no hard-coded applicationId');
  assert.doesNotMatch(gradle, /applicationIdSuffix/);
});

test('the manifest keeps backup off and every authority and task affinity scoped to ${applicationId}', () => {
  assert.match(manifest, /<application [^>]*android:allowBackup="false"/);
  assert.doesNotMatch(manifest, /android:allowBackup="true"/);
  const authorities = [...manifest.matchAll(/android:authorities="([^"]+)"/g)].map(match => match[1]);
  assert.ok(authorities.length > 0);
  for (const value of authorities) for (const authority of value.split(';')) assert.match(authority, /^\$\{applicationId\}\./, authority);
  for (const [, affinity] of manifest.matchAll(/android:taskAffinity="([^"]+)"/g)) assert.match(affinity, /^\$\{applicationId\}\./, affinity);
  assert.match(manifest, /android:label="@string\/app_name"/);
});

test('every literal localStorage key under apps/app/src uses an Alpha prefix', () => {
  const keys = literalStorageKeys('apps/app/src');
  assert.ok(keys.length >= 20, `found only ${keys.length} keys; the scan no longer sees the storage calls`);
  for (const {file, key} of keys) {
    // Preserve the original durable Alpha onboarding key; renaming would lose completed installs.
    const historicalSetup = file === 'apps/app/src/startup-permission-progress.ts' && key === 'alpha:startup-permission-walkthrough:v1'
      || file === 'apps/app/src/startup-permissions.tsx' && ['alpha:startup-permission-progress:v1','alpha:startup-permissions-dismissed:v1'].includes(key);
    assert.ok(historicalSetup || PREFIXES.some(prefix => key.startsWith(prefix)), `${file}: ${JSON.stringify(key)} lacks an alpha. or alphaphone: prefix`);
    assert.doesNotMatch(key, FOREIGN, `${file}: ${JSON.stringify(key)} uses another product's prefix`);
  }
});

test('the key scan would catch an unprefixed or foreign key', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-identity-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, 'a.ts'), "const k='milady.theme';localStorage.getItem(k);localStorage.setItem('eliza:x','1');localStorage.getItem(`alpha.dev.${n}`);");
  assert.deepEqual(literalStorageKeys(dir).map(row => row.key).sort(), ['alpha.dev.', 'eliza:x', 'milady.theme']);
});

// The launcher is portrait only; the standalone app is an ordinary app and rotates. Android's
// handling of the lock is emulator and device evidence (RotationInstrumentedTest).
test('every launcher surface is locked to portrait', () => {
  const launcher = fs.readFileSync('android/app/src/launcher/AndroidManifest.xml', 'utf8');
  for (const activity of ['MainActivity', 'AlphaAssistActivity'])
    assert.match(launcher, new RegExp(`<activity android:name="\\.${activity}"[^>]*android:screenOrientation="portrait" tools:replace="android:screenOrientation"`));
});

test('the standalone app keeps the shared orientation', () => {
  assert.equal(identity.orientation, 'unspecified');
  assert.doesNotMatch(fs.readFileSync('android/app/src/standalone/AndroidManifest.xml', 'utf8'), /screenOrientation/);
});
