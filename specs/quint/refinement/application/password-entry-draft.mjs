/** Replays PasswordEntryDraft traces against the real Settings → Password manager module
 * (`passwordManagerGroups`, `passwordEntryPage`, `passwordManagerLifecycle`, `leavePasswordManager`)
 * over the shared passwords client in a jsdom document.
 *
 * Controlled ports: the vault bridge behind the shared client (status, list, unlock and lock answer
 * at once; a save or remove answers when the model says, accepted, refused or as locked), the
 * unlock-window timer (it fires when the model says, and the vault locks with it) and Settings,
 * a stand-in that renders the password pages on every change notice while it is on one.
 *
 * Abstraction: `details` is a name with a website; `typed` is a non-empty password field;
 * `listed` and `stored` count entries. The form's fields are read from the rendered rows, so they
 * are compared only while the form is shown; a locked page must show none of them. `onPages`,
 * `active`, `foreground`, `stale` and `behind` are the driver's own position or model-only. */
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, loadBundled, installDocument, settle} from './browser-model-traces.mjs';

const model = {path: 'specs/quint/application/PasswordEntryDraft.qnt', module: 'PasswordEntryDraft'};
const scenarios = ['expiryDropsTypedPasswordTest', 'newEntryNeedsDetailsAndPasswordTest', 'refusedSaveKeepsTypedPasswordTest', 'leavingFormDuringSaveStillListsItTest',
  'deleteNeedsSecondTapTest', 'answerAfterReturnIsNotReadBackTest', 'hidingForgetsFormTest', 'lockedSaveAnswerDropsPasswordTest'];
const witnesses = ['KeptFormAfterExpiryWitness', 'SavedAfterLeavingFormWitness', 'RefusedSaveKeepsSecretWitness', 'SaveInFlightWhileHiddenWitness'];
const stubs = {
  '@capacitor/core': 'export const Capacitor={isNativePlatform:()=>false,isPluginAvailable:()=>false};',
  '../platform-plugins': 'export function registerPlugin(){return {};}',
  '../build-flags': 'export const devSurfacesEnabled=true,testMocksEnabled=false;',
  '../browser/dev-profile': 'export const browserDevProfile=true;',
  './dev-vault': 'export function createDevelopmentVault(){return globalThis.__passwordEntryVault;}',
};
const typedSecret = 'typed-secret-value', refusal = 'Use an HTTPS website address';
const errors = {'Enter a name.': 'details', 'Add a website': 'details', 'Type the new password again.': 'retype', 'Password needed': 'password', [refusal]: 'refused'};

export async function passwordEntryDraftDriver() {
  const load = await loadBundled('apps/app/src/passwords/password-manager.ts', stubs);
  return async () => {
    const page = await installDocument();
    const timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
    // The unlock window is the module's only long timer.
    let window = null;
    globalThis.setTimeout = (run, ms, ...rest) => ms >= 1000 ? (window = {run}) : timeout(run, ms, ...rest);
    globalThis.clearTimeout = handle => { if (handle && typeof handle === 'object' && 'run' in handle) { if (window === handle) window = null; } else clear(handle); };
    const entries = [{id: 'e1', label: 'Shop', username: 'sam@example.test', updatedAt: 1, bindings: [{kind: 'web', facet: 'https://shop.example.test', display: 'shop.example.test'}]}];
    const saves = [], waiting = [];
    let unlocked = true, ids = 1, visit = 0;
    const hold = (name, apply, value) => new Promise((resolve, reject) => waiting.push({name, apply, value, resolve, reject, visit}));
    globalThis.__passwordEntryVault = {
      async status() { return {available: true, locked: !unlocked, unlockRemainingMs: unlocked ? 58_000 : 0, unlockSeconds: 58, biometric: true, autofill: {supported: true, selected: 'none'}}; },
      async unlock() { unlocked = true; return {unlocked: true, unlockRemainingMs: 58_000}; },
      async lock() { unlocked = false; return {locked: true}; },
      async list() { return {entries: entries.map(entry => ({...entry}))}; },
      save(input) {
        saves.push(input);
        const id = input.id || `e${++ids}`;
        return hold('save', () => { if (!input.id) entries.push({id, label: input.label, username: input.username, updatedAt: ids, bindings: [{kind: 'web', facet: 'https://example.com', display: 'example.com'}]}); }, {id});
      },
      remove(input) { return hold('remove', () => { entries.splice(entries.findIndex(entry => entry.id === input.id), 1); }, {removed: true}); },
    };
    const manager = await load();
    let onPages = true;
    const helpers = {info: (label, val) => ({kInfo: true, label, val}), group: rows => ({rows}), toast() {}, set() {}, ic: {}};
    const rows = groups => (groups || []).flatMap(group => group.rows || []);
    // Settings renders the password pages while it is on one, and leaves them otherwise.
    const listRows = () => onPages ? rows(manager.passwordManagerGroups(helpers)) : [];
    const entryPage = () => onPages ? manager.passwordEntryPage(helpers, () => {}) : null;
    const formRows = () => rows(entryPage()?.groups);
    const find = (list, label) => { const row = list.find(item => item.label === label); assert.ok(row, `row ${label} among ${list.map(item => item.label).join(', ')}`); return row; };
    const press = async (list, label) => { const row = find(list, label); assert.ok(!row.dis && !row.busy, `${label} is offered`); row.go(); await settle(); };
    const type = (label, value) => { find(formRows(), label).change({target: {value}}); };
    const stop = manager.passwordManagerLifecycle(() => { listRows(); });
    listRows(); await settle();
    const answer = async (name, result) => {
      const index = waiting.findIndex(item => item.name === name);
      assert.ok(index >= 0, `a ${name} is waiting for the vault`);
      const [item] = waiting.splice(index, 1);
      if (result === 'ok') { item.apply(); item.resolve(item.value); }
      else if (result === 'locked') { if (item.visit === visit) unlocked = false; item.reject(Object.assign(new Error('locked'), {code: 'locked'})); }
      else item.reject(Object.assign(new Error(refusal), {code: 'invalid'}));
      await settle();
    };
    return {
      openNew: () => press(listRows(), 'Add password'),
      openEdit: () => press(listRows(), entries[0].label),
      async setDetails(complete) {
        type('Name', complete ? 'Mail' : '');
        if (!entryPage().title.startsWith('Edit')) type('Add website', complete ? 'example.com' : '');
        await settle();
      },
      async typePassword(text) { type('Password', text ? typedSecret : ''); await settle(); },
      chooseGenerated: () => press(formRows(), 'Generate'),
      chooseTyped: () => press(formRows(), 'Type instead'),
      tapSave: () => press(formRows(), 'Save'),
      saveSettles: result => answer('save', result),
      tapDelete: () => press(formRows(), formRows().some(row => row.label === 'Confirm delete') ? 'Confirm delete' : 'Delete'),
      removeSettles: result => answer('remove', result),
      async expire() { assert.ok(window, 'the unlock window is running'); const timer = window; window = null; unlocked = false; timer.run(); await settle(); },
      unlock: () => press(entryPage() ? formRows() : listRows(), 'Unlock'),
      async leaveEntry() { entryPage().back(); listRows(); await settle(); },
      lock: () => press(listRows(), 'Lock'),
      async leavePages() { onPages = false; visit++; manager.leavePasswordManager(); await settle(); },
      async openPages() { onPages = true; listRows(); await settle(); },
      async hide() { visit++; page.setHidden(true); await settle(); },
      async show() { page.setHidden(false); await settle(); },
      observe() {
        const list = listRows(), holds = manager.passwordManagerHoldsEntries(), entry = entryPage(), form = formRows();
        const shown = !!entry && holds, field = label => form.find(row => row.kInput && row.label === label);
        if (entry && !holds) {
          assert.deepEqual(form.map(row => row.label), ['Unlock'], 'a locked form offers only Unlock');
          assert.ok(!JSON.stringify(entry).includes(typedSecret), 'a locked form shows no typed password');
        }
        const generate = form.some(row => row.label === 'Type instead'), password = field('Password'), failure = form.find(row => row.kInfo && row.label === 'Not saved');
        const save = form.find(row => row.kBtn && (row.label === 'Save' || row.label === 'Saving…'));
        const last = saves.at(-1), kind = last ? (last.id ? 'edit' : 'new') + (last.generate ? '-generated' : last.password ? '-typed' : '-kept') : 'none';
        if (last?.password) assert.equal(last.password, typedSecret, 'the vault gets the typed password');
        if (failure) assert.ok(failure.val in errors, `unexpected error: ${failure.val}`);
        return {unlocked: holds, draft: !entry ? 'none' : entry.title === 'Edit password' ? 'edit' : 'new',
          details: shown ? !!field('Name').value.trim() && (!!field('Add website').value || form.some(row => String(row.lbl || '').startsWith('Remove '))) : null,
          typed: !!password?.value, dropped: shown && !generate ? password.ph === 'Retype' : null, generate: shown ? generate : null,
          confirmDelete: shown ? form.some(row => row.label === 'Confirm delete') : null, error: shown ? (failure ? errors[failure.val] : 'none') : null,
          busy: [...list, ...form].some(row => row.busy === true || (row.kBtn && row.dis)), saving: shown ? save.label === 'Saving…' : null,
          pending: waiting.find(item => item.visit === visit)?.name ?? waiting[0]?.name ?? 'none', sent: kind, stored: entries.length,
          listed: holds ? list.filter(row => String(row.lbl || '').startsWith('Open ')).length : null};
      },
      async teardown() { stop(); await settle(); globalThis.setTimeout = timeout; globalThis.clearTimeout = clear; delete globalThis.__passwordEntryVault; page.restore(); },
    };
  };
}

export async function checkPasswordEntryDraft({random = 40, steps = 30} = {}) {
  const create = await passwordEntryDraftDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create, {project: s => {
    const shown = s.draft !== 'none' && s.unlocked;
    return {unlocked: s.unlocked, draft: s.active ? s.draft : 'none', details: shown ? s.details : null, typed: s.typed, dropped: shown && !s.generate ? s.dropped : null,
      generate: shown ? s.generate : null, confirmDelete: shown ? s.confirmDelete : null, error: shown ? s.error : null, busy: s.busy !== 'none',
      saving: shown ? s.busy === 'save' : null, pending: s.pending, sent: s.sent, stored: s.stored, listed: s.unlocked ? s.listed : null};
  }});
}
