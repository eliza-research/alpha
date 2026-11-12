import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {build} from 'esbuild';

// The real module over a fake vault: every import outside the module is a small port.
const ports = {
  '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>true,isPluginAvailable:()=>false};',
  'platform-plugins': 'export const registerPlugin=name=>globalThis.__passwordFixture[name];',
  'build-flags': 'export const devSurfacesEnabled=false,testMocksEnabled=false;',
  'dev-profile': 'export const browserDevProfile=false;',
  'dev-vault': 'export const createDevelopmentVault=()=>null;',
  'client.ts': 'export const createPasswordsClient=plugin=>plugin;export const passwordsError=error=>({code:error?.code||"unavailable",message:error?.message||"Saved passwords are unavailable."});',
  'transfer.ts': 'export const createTransferClient=()=>null;',
  'bindings.ts': 'export const filterEntries=entries=>entries;export const normalizeWebsite=value=>value;',
  'definitions.ts': 'export {};',
};
const directory = mkdtempSync(join(tmpdir(), 'password-manager-'));
const bundle = await build({entryPoints: [resolve('apps/app/src/passwords/password-manager.ts')], bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{name: 'ports', setup(b) {
    b.onResolve({filter: /^@capacitor\/core$|platform-plugins$|build-flags$|dev-profile$|dev-vault$|plugin-native-passwords\/src\/(client|transfer|bindings|definitions)\.ts$/}, args => ({path: args.path, namespace: 'fixture'}));
    b.onLoad({filter: /.*/, namespace: 'fixture'}, args => ({contents: ports[Object.keys(ports).find(key => args.path.endsWith(key))]}));
  }}]});
const file = join(directory, 'password-manager.mjs');
writeFileSync(file, bundle.outputFiles[0].text);
test.after(() => rmSync(directory, {recursive: true, force: true}));

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(next => setImmediate(next)); };
const deferred = () => { let resolveIt, rejectIt; const promise = new Promise((res, rej) => { resolveIt = res; rejectIt = rej; }); return {promise, resolve: resolveIt, reject: rejectIt}; };
const entry = {id: 'e1', label: 'Example', username: 'me', bindings: [{facet: 'web:example.com', display: 'example.com', kind: 'web'}]};
let copy = 0;

/** A fresh module instance (its state is module-level) with the pages opened once. */
async function open(overrides = {}) {
  const calls = {status: 0, list: 0, lock: 0, unlock: 0, reset: 0, remove: 0};
  const vault = {
    locked: false,
    status: async () => { calls.status++; return {available: true, locked: vault.locked, unlockRemainingMs: 60000, unlockSeconds: 60, biometric: true, autofill: {selected: 'none', supported: true}}; },
    list: async () => { calls.list++; return [entry]; },
    lock: async () => { calls.lock++; vault.locked = true; },
    unlock: async () => { calls.unlock++; vault.locked = false; return {unlockRemainingMs: 60000}; },
    reset: async () => { calls.reset++; },
    remove: async () => { calls.remove++; },
    ...overrides,
  };
  globalThis.__passwordFixture = {ElizaPasswords: vault, AlphaBrowser: {loginFillStatus: async () => ({available: true})}};
  globalThis.document = {hidden: false, addEventListener() {}, removeEventListener() {}};
  globalThis.window = {addEventListener() {}, removeEventListener() {}};
  // A path specifier: Bun returns the cached module for a file: URL that differs only in its query.
  const manager = await import(file + '?instance=' + copy++);
  const sets = [], toasts = [];
  const helpers = {info: (label, val) => ({label, val}), group: rows => ({rows}), toast: message => toasts.push(message), set: patch => sets.push(patch), ic: {}};
  const stop = manager.passwordManagerLifecycle(() => {});
  const rows = () => manager.passwordManagerGroups(helpers).flatMap(group => group.rows);
  const row = label => { const found = rows().find(item => item.label === label || item.lbl === label); assert.ok(found, `row "${label}" in ${rows().map(item => item.label).join(' | ')}`); return found; };
  rows(); await settle();
  return {manager, vault, calls, helpers, sets, toasts, rows, row, stop};
}

test('locking retires a listing that is still being read', async () => {
  const h = await open();
  try {
    assert.equal(h.manager.passwordManagerHoldsEntries(), true);
    const pending = deferred();
    h.vault.list = () => { h.calls.list++; return pending.promise; };
    h.manager.refreshPasswordManager(); await settle();
    h.row('Lock passwords').go(); await settle();
    assert.equal(h.calls.lock, 1);
    assert.equal(h.manager.passwordManagerHoldsEntries(), false);
    pending.resolve([entry]); await settle();
    assert.equal(h.manager.passwordManagerHoldsEntries(), false, 'the late listing is dropped');
    assert.equal(h.row('Unlock passwords').label, 'Unlock');
  } finally { h.stop(); }
});

test('the end of the unlock time retires a listing that is still being read', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const h = await open();
  try {
    const pending = deferred();
    h.vault.list = () => { h.calls.list++; return pending.promise; };
    h.manager.refreshPasswordManager(); await settle();
    t.mock.timers.tick(60000);
    assert.equal(h.manager.passwordManagerHoldsEntries(), false);
    pending.resolve([entry]); await settle();
    assert.equal(h.manager.passwordManagerHoldsEntries(), false, 'the late listing is dropped');
    assert.equal(h.row('Unlock passwords').label, 'Unlock');
  } finally { h.stop(); }
});

test('an unlock that completes after leaving reads nothing back', async () => {
  const pending = deferred();
  const h = await open({locked: true});
  try {
    h.vault.unlock = () => { h.calls.unlock++; return pending.promise.then(() => { h.vault.locked = false; }); };
    h.row('Unlock passwords').go(); await settle();
    assert.equal(h.calls.unlock, 1);
    h.manager.leavePasswordManager(); await settle();
    const before = {...h.calls};
    pending.resolve(); await settle();
    assert.equal(h.calls.status, before.status, 'no status read after leaving');
    assert.equal(h.calls.list, before.list, 'no listing read after leaving');
    assert.equal(h.manager.passwordManagerHoldsEntries(), false);
  } finally { h.stop(); }
});

test('a delete that completes after leaving does not move Settings or read the vault', async () => {
  const pending = deferred();
  const h = await open();
  try {
    h.vault.remove = () => { h.calls.remove++; return pending.promise; };
    h.row('Example').go();
    assert.deepEqual(h.sets, [{page: 'password-entry'}]);
    const button = label => h.manager.passwordEntryPage(h.helpers, () => {}).groups.flatMap(group => group.rows).find(item => item.label === label);
    button('Delete').go();
    button('Confirm delete').go(); await settle();
    assert.equal(h.calls.remove, 1);
    h.manager.leavePasswordManager(); await settle();
    const before = {...h.calls}, moved = h.sets.length;
    pending.resolve(); await settle();
    assert.equal(h.sets.length, moved, 'Settings is not navigated after leaving');
    assert.equal(h.calls.status, before.status);
    assert.equal(h.calls.list, before.list);
  } finally { h.stop(); }
});

const ARM = 'Reset vault', ARMED = 'Confirm reset';
const damagedVault = () => ({list: async () => { throw Object.assign(new Error('Saved passwords can no longer be decrypted on this device.'), {code: 'key-invalidated'}); }});

test('the delete-everything confirmation does not survive a refresh or a failed attempt', async () => {
  const h = await open(damagedVault());
  try {
    h.row(ARM).go();
    h.row(ARMED);
    h.manager.refreshPasswordManager(); await settle();
    h.row(ARM);
    assert.equal(h.calls.reset, 0);
    h.vault.unlock = async () => { h.calls.unlock++; throw Object.assign(new Error('Unlock was cancelled.'), {code: 'cancelled'}); };
    h.row(ARM).go();
    h.row(ARMED).go(); await settle();
    assert.equal(h.calls.unlock, 1);
    assert.equal(h.calls.reset, 0);
    h.row(ARM);
  } finally { h.stop(); }
});

test('delete-everything is not carried out after the page is left or hidden during unlock', async () => {
  for (const away of ['leave', 'hidden']) {
    const pending = deferred();
    const h = await open(damagedVault());
    try {
      h.vault.unlock = () => { h.calls.unlock++; return pending.promise; };
      h.row(ARM).go();
      h.row(ARMED).go(); await settle();
      assert.equal(h.calls.unlock, 1);
      if (away === 'leave') h.manager.leavePasswordManager(); else globalThis.document.hidden = true;
      await settle();
      const locks = h.calls.lock;
      pending.resolve({unlockRemainingMs: 60000}); await settle();
      assert.equal(h.calls.reset, 0, away);
      assert.equal(h.calls.lock, locks + 1, `${away}: the vault is locked again`);
      globalThis.document.hidden = false;
      assert.ok(!h.rows().some(item => item.label === ARMED), `${away}: the confirmation is not left armed`);
      await settle();
    } finally { h.stop(); }
  }
});

test('a confirmed delete-everything in the foreground still resets once', async () => {
  const h = await open(damagedVault());
  try {
    h.row(ARM).go();
    h.vault.list = async () => { h.calls.list++; return []; };
    h.row(ARMED).go(); await settle();
    assert.equal(h.calls.unlock, 1);
    assert.equal(h.calls.reset, 1);
    h.rows(); await settle();
    assert.equal(h.toasts.at(-1), 'Vault reset');
    assert.equal(h.manager.passwordManagerHoldsEntries(), true);
  } finally { h.stop(); }
});
