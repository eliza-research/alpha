import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

// The real module over a fake vault: every import outside the module is a small port.
const ports = {
  '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>false};',
  'platform-plugins': 'export const registerPlugin=name=>globalThis.__passwordHiddenFixture[name];',
  'build-flags': 'export const devSurfacesEnabled=false,testMocksEnabled=false;',
  'dev-profile': 'export const browserDevProfile=false;',
  'dev-vault': 'export const createDevelopmentVault=()=>null;',
  'client.ts': 'export const createPasswordsClient=plugin=>plugin;export const passwordsError=error=>({code:error?.code||"unavailable",message:error?.message||"Saved passwords are unavailable."});',
  'transfer.ts': 'export const createTransferClient=()=>null;',
  'bindings.ts': 'export const filterEntries=entries=>entries;export const normalizeWebsite=value=>value;',
  'definitions.ts': 'export {};',
};
const directory = mkdtempSync(join(tmpdir(), 'password-manager-hidden-'));
const bundle = await build({entryPoints: [resolve('apps/app/src/passwords/password-manager.ts')], bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{name: 'ports', setup(b) {
    b.onResolve({filter: /^@capacitor\/core$|platform-plugins$|build-flags$|dev-profile$|dev-vault$|plugin-native-passwords\/src\/(client|transfer|bindings|definitions)\.ts$/}, args => ({path: args.path, namespace: 'fixture'}));
    b.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: ports[Object.keys(ports).find(key => args.path.endsWith(key))]}));
  }}]});
const file = join(directory, 'password-manager.mjs');
writeFileSync(file, bundle.outputFiles[0].text);
test.after(() => rmSync(directory, {recursive: true, force: true}));

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(next => setImmediate(next)); };
const entry = {id: 'e1', label: 'Example', username: 'me', bindings: [{facet: 'web:example.com', display: 'example.com', kind: 'web'}]};
let copy = 0;

/** The password pages open and unlocked, with Settings re-rendering them whenever the module asks. */
async function open(overrides = {}) {
  const calls = {status: 0, list: 0, lock: 0};
  const vault = {locked: false,
    status: async () => { calls.status++; return {available: true, locked: vault.locked, unlockRemainingMs: 60000, unlockSeconds: 60, biometric: true, autofill: {selected: 'none', supported: true}}; },
    list: async () => { calls.list++; return [entry]; },
    lock: async () => { calls.lock++; vault.locked = true; },
    ...overrides};
  const listeners = {};
  globalThis.__passwordHiddenFixture = {ElizaPasswords: vault, AlphaBrowser: {loginFillStatus: async () => ({available: true})}};
  globalThis.document = {hidden: false, addEventListener: (name, run) => { listeners[name] = run; }, removeEventListener() {}};
  globalThis.window = {addEventListener() {}, removeEventListener() {}};
  const manager = await import(pathToFileURL(file).href + '?instance=' + copy++);
  const helpers = {info: (label, val) => ({label, val}), group: rows => ({rows}), toast() {}, set() {}, ic: {}};
  const render = () => manager.passwordManagerGroups(helpers);
  // Settings stays on the password page, so every change notice renders it again.
  const stop = manager.passwordManagerLifecycle(render);
  render(); await settle();
  const visibility = async hidden => { globalThis.document.hidden = hidden; listeners.visibilitychange(); await settle(); };
  return {manager, vault, calls, render, stop, visibility};
}

test('a hidden password page reads nothing from the vault, even when the lock on leaving failed', async () => {
  const h = await open({lock: async () => { h.calls.lock++; throw new Error('The vault did not answer.'); }});
  try {
    assert.equal(h.manager.passwordManagerHoldsEntries(), true);
    const before = {...h.calls};
    await h.visibility(true);
    assert.equal(h.calls.lock, before.lock + 1, 'hiding asks the vault to lock');
    assert.equal(h.calls.status, before.status, 'no status read while hidden');
    assert.equal(h.calls.list, before.list, 'no listing read while hidden');
    assert.equal(h.manager.passwordManagerHoldsEntries(), false, 'nothing is held while hidden');
    // More renders and an explicit refresh while hidden change nothing.
    h.render(); h.manager.refreshPasswordManager(); await settle();
    assert.deepEqual({status: h.calls.status, list: h.calls.list}, {status: before.status, list: before.list});
    assert.equal(h.manager.passwordManagerHoldsEntries(), false);
  } finally { h.stop(); }
});

test('returning to the foreground reads the vault again', async () => {
  const h = await open();
  try {
    await h.visibility(true);
    const hidden = {...h.calls};
    assert.equal(h.manager.passwordManagerHoldsEntries(), false);
    await h.visibility(false);
    assert.equal(h.calls.status, hidden.status + 1, 'the page asks for the vault state once it is shown again');
    assert.equal(h.calls.list, hidden.list, 'a locked vault is not listed');
    assert.equal(h.manager.passwordManagerHoldsEntries(), false);
  } finally { h.stop(); }
});
