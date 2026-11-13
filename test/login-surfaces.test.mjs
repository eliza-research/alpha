import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loginSurfaceInventory as inventory} from './support/login-surfaces.mjs';

// Signals that a field holds a reusable credential. A field that only says autocomplete="off"
// is not detected; pairing codes are registered for documentation, not discovered.
const RENDERER_DETECTORS = [
  /\btype\s*[=:]\s*\{?\s*["']password["']/gi,
  /\btype\s*=\s*password\b/gi, // unquoted HTML attribute
  /\btype\s*=\s*\{[^}\n]*password[^}\n]*\}/gi, // dynamic type={show ? 'text' : 'password'}
  /\bauto[cC]omplete\s*[=:]\s*\{?\s*["'][^"']*\b(?:username|current-password|new-password|one-time-code|webauthn)\b[^"']*["']/gi,
  /\binput\([^\n]*?,\s*'password',/g,
  /(?:-webkit-)?text-security\s*:|[wW]ebkitTextSecurity|textSecurity\s*:/g, // masked text that is not type=password
];
const NATIVE_DETECTORS = [
  /textPassword|textWebPassword|numberPassword|textVisiblePassword/g,
  /TYPE_TEXT_VARIATION_(?:WEB_|VISIBLE_)?PASSWORD|TYPE_NUMBER_VARIATION_PASSWORD/g,
  /autofillHints|setAutofillHints|AUTOFILL_HINT_(?:PASSWORD|USERNAME)/g,
  /PasswordTransformationMethod|PasswordVisualTransformation|KeyboardType\.Password/g,
  /setInputType\(\s*(?:0x[0-9a-fA-F]+|\d+)\s*\)|android:inputType\s*=\s*"(?:0x[0-9a-fA-F]+|\d+)"/g, // numeric input types hide a password variation
];
const registered = inventory.surfaces.filter(surface => surface.file);

test('the inventory covers websites, other apps and every Alpha-owned secret field', () => {
  const ids = new Set(inventory.surfaces.map(surface => surface.id));
  assert.equal(ids.size, inventory.surfaces.length, 'unique surface ids');
  for (const id of ['browser-website-login', 'third-party-app-login', 'eliza-cloud-sign-in-google', 'eliza-cloud-sign-in-code']) assert.ok(ids.has(id), id);
  for (const surface of inventory.surfaces) {
    assert.equal(typeof surface.eligible, 'boolean', surface.id);
    if (surface.eligible) {
      assert.ok(inventory.rules[surface.binding], `${surface.id} names a binding rule`);
      assert.ok(surface.providers?.integrated && (surface.providers.proton || surface.providers.other), `${surface.id} states both the integrated vault and an optional provider`);
      assert.ok(Array.isArray(surface.remainingGates) && surface.remainingGates.length, `${surface.id} lists its remaining acceptance gates`);
    } else {
      assert.ok(surface.reason?.length > 20, `${surface.id} explains why it is not a fill target`);
    }
  }
  assert.equal(inventory.surfaces.find(s => s.id === 'browser-website-login').binding, 'websiteBinding');
  assert.equal(inventory.surfaces.find(s => s.id === 'third-party-app-login').binding, 'appBinding');
});

test('the detectors catch the field shapes they claim to', () => {
  const samples = {
    renderer: ['<input type=password>', '<input type={reveal ? "text" : "password"}>', "style={{WebkitTextSecurity:'disc'}}", '.pin{-webkit-text-security:disc}', '<input autoComplete="current-password">'],
    native: ['android:inputType="textVisiblePassword"', 'InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD', 'new PasswordTransformationMethod()', 'field.setInputType(0x81)', 'android:inputType="129"'],
  };
  for (const sample of samples.renderer) assert.ok(RENDERER_DETECTORS.some(detector => new RegExp(detector.source, detector.flags).test(sample)), sample);
  for (const sample of samples.native) assert.ok(NATIVE_DETECTORS.some(detector => new RegExp(detector.source, detector.flags).test(sample)), sample);
});

test('membership inventory retains exact code semantics across controlled JSX props',()=>{
  const surface=registered.find(entry=>entry.id==='eliza-cloud-subscription-code');
  const pattern=new RegExp(surface.pattern);
  assert.ok(pattern.test('name="membership-code" value={codeValue} onChange={event=>setCodeValue(event.target.value)} autoComplete="one-time-code"'));
  for(const source of ['name="other-code" autoComplete="one-time-code"','name="membership-code" autoComplete="current-password"','name="membership-code"><input autoComplete="one-time-code"'])assert.equal(pattern.test(source),false,source);
});

// Plain-JVM run, at the pin, of the shared field-origin and HTTP-auth binding rules against the
// pinned PasswordFormPolicy (plugin-native-browser-surface's own tests: redirects, frames, wrong
// origin, stale and hidden tabs, revoke, the anchor and prompt field shapes). No APK, device,
// provider or vault.
test('the pinned binding rules and password policy pass their JVM tests', () => {
  const java = process.env.JAVA_HOME || (process.platform === 'darwin' ? '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home' : '');
  const env = java ? {...process.env, JAVA_HOME: java} : {...process.env};
  delete env.NODE_TEST_CONTEXT;
  // A nested Bun test run. Bun has no TAP reporter and folds subtests into their parent, so each
  // JVM consumer is read from the line the upstream subtest prints only after its assertion passed.
  const result = spawnSync(process.execPath, ['test', './vendor/eliza/plugins/plugin-native-browser-surface/test/native-host/policies.node.mjs'], {encoding: 'utf8', timeout: 180000, env});
  const detail = result.stdout + result.stderr;
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, detail);
  for (const name of ['BrowserFieldOriginTest', 'BrowserHttpAuthOriginTest', 'BrowserLinkAutofillPolicyTest']) assert.match(result.stdout, new RegExp(`^${name}: \\d+ assertions passed$`, 'm'), name);
  assert.match(result.stderr, /^ 0 fail$/m, detail);
});

test('External authorization and Google sign-in are inventoried as external-browser surfaces', () => {
  for (const id of ['eliza-cloud-sign-in', 'google-account-authorization']) {
    const surface = inventory.surfaces.find(s => s.id === id);
    assert.equal(surface?.kind, 'external-browser', id);
    assert.equal(surface.eligible, false, id);
  }
  assert.equal(inventory.surfaces.find(s=>s.id==='eliza-cloud-sign-in-google').kind,'external-browser');
});
