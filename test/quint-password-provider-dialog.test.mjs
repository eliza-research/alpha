import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTraces, replayTraces, loadBundled, installDocument, settle} from '../specs/quint/refinement/application/browser-model-traces.mjs';

/** Replays PasswordProviderDialog traces against the real `openPasswordProvider` in a jsdom document.
 *
 * Controlled ports: the development-profile flag and the provider settings document (its reads and
 * edits settle when the model says so; a read or edit whose abort signal fired is rejected, as the
 * stored document does). The lock screen is the visible Wake control plus the device-state event the
 * device chrome dispatches when the lock state changes. A settings change made elsewhere arrives as
 * the document-changed event or a storage event.
 *
 * Abstraction: `opening` is the latest request whose settings read is unsettled and not aborted;
 * `dialog` is the open dialog's heading; `busy` is an unsettled edit; `unlocked` and `sample` are
 * what the vault dialog shows; `revision` counts the stored revisions. `captured`,
 * `capturedInstalled`, `editKind` and `staleEdit` are private to the dialog or model-only. */

const model = {path: 'specs/quint/application/PasswordProviderDialog.qnt', module: 'PasswordProviderDialog'};
const scenarios = ['productionBuildRefusesTest', 'installSelectFillTest', 'changedSettingsCloseDialogTest', 'hiddenAbortsOpeningTest',
  'failedSaveNeedsReopenTest', 'unlockAbortsOpeningTest', 'clearSelectionTest', 'openNeedsInstalledProviderTest', 'fillNeedsSelectionTest'];
const witnesses = ['VaultUnlockedWitness', 'ProviderSelectedWitness', 'EditInFlightWitness', 'OpeningWhileHiddenWitness', 'SaveFailedWitness'];
const headings = {'Choose password provider': 'settings', 'Add development provider': 'install', 'Development vault': 'open'};
const storageKey = 'alpha.browser.password-provider.v1';

async function passwordProviderDialogDriver() {
  const load = await loadBundled('apps/app/src/browser/password-provider.ts', {
    './dev-profile': 'export const browserDevProfile=globalThis.__providerPorts.dev;',
    './preference-documents': 'export const passwordProviderDocument={read:(initial,signal)=>globalThis.__providerPorts.read(initial,signal),edit:(initial,edit,signal)=>globalThis.__providerPorts.edit(initial,edit,signal)};'});
  return async trace => {
    const dom = await installDocument('<!doctype html><body><div class="os"><button id="origin">Settings</button></div></body>');
    const {window, document} = dom;
    const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
    const store = {installed: false, selection: 'none', revision: 'initial'};
    let revisions = 0, locked = false, closes = 0, changes = 0, reads = [], edits = [], opening;
    globalThis.__providerPorts = {dev: trace.init.devProfile,
      read(_initial, signal) { const read = {...deferred(), signal, settled: false}; reads.push(read); return read.promise; },
      edit(_initial, edit, signal) { const pending = {...deferred(), signal, edit, settled: false}; edits.push(pending); return pending.promise; }};
    const {openPasswordProvider} = await load();
    const wake = document.createElement('button');
    wake.setAttribute('aria-label', 'Wake');
    wake.getClientRects = () => [{}];
    const dialog = () => document.querySelector('dialog[aria-label="Development password provider"]');
    const button = label => [...(dialog()?.querySelectorAll('button') || [])].find(item => item.textContent === label);
    const aborted = () => new window.DOMException('Aborted', 'AbortError');
    // The stored document rejects work whose signal has fired.
    const retire = async () => {
      for (const item of [...reads, ...edits]) if (!item.settled && item.signal?.aborted) { item.settled = true; item.reject(aborted()); }
      await settle();
    };
    const after = async () => { await settle(); await retire(); };
    return {
      async request(name) {
        if (!trace.init.devProfile) { await assert.rejects(openPasswordProvider(name), /Choose a password provider action/); return; }
        const call = {name, done: false};
        opening = call;
        void openPasswordProvider(name).then(result => { call.done = true; call.result = result; }, error => { call.done = true; call.error = error; });
        await after();
      },
      async openSettles(readOk) {
        const read = reads.findLast(item => !item.settled);
        read.settled = true;
        if (readOk) read.resolve({...store}); else read.reject(new Error('Password settings could not be read.'));
        await after();
        assert.equal(!!opening.result, !!dialog(), 'a request reports opened exactly when its dialog is shown');
      },
      async editStart(kind) { button({install: 'Add provider', clear: 'None', proton: 'Proton Pass · development'}[kind]).click(); await after(); },
      async editSettles(ok) {
        const pending = edits.findLast(item => !item.settled);
        pending.settled = true;
        if (!ok) pending.reject(new Error('storage'));
        else {
          const next = {...store};
          try { await pending.edit(next); Object.assign(store, next); revisions++; pending.resolve(); }
          catch (error) { pending.reject(error); }
        }
        await after();
      },
      async unlockVault() { button('Unlock development vault').click(); await after(); },
      async fillSample(readOk) {
        const fill = button('Fill sample sign-in');
        if (!fill) { assert.ok(document.querySelector('output[aria-label="Sample sign-in"]'), 'only a filled vault withdraws the fill button'); return; }
        fill.click(); await settle();
        const read = reads.findLast(item => !item.settled);
        read.settled = true;
        if (readOk) read.resolve({...store}); else read.reject(new Error('unreadable'));
        await after();
      },
      async close() {
        const way = closes++ % 6, lock = button('Lock vault');
        if (way === 0) button('Done').click();
        else if (way === 1 && lock) lock.click();
        else if (way === 2) window.dispatchEvent(new window.Event('alpha-back', {cancelable: true}));
        else if (way === 3) dialog().dispatchEvent(new window.Event('cancel', {cancelable: true}));
        else if (way === 4) window.dispatchEvent(new window.Event('launcher-home'));
        else window.dispatchEvent(new window.Event('pagehide'));
        await after();
      },
      async hide() { dom.setHidden(true); await after(); },
      async show() { dom.setHidden(false); await after(); },
      async lockScreen() { locked = true; document.body.append(wake); window.dispatchEvent(new window.Event('alpha:device-state')); await after(); },
      async unlockScreen() { locked = false; wake.remove(); window.dispatchEvent(new window.Event('alpha:device-state')); await after(); },
      async externalChange(installed, selection) {
        Object.assign(store, {installed, selection, revision: `external-${++revisions}`});
        if (changes++ % 2) window.dispatchEvent(new window.Event('alpha:password-provider-document-changed'));
        else { const event = new window.Event('storage'); event.key = changes % 4 === 1 ? storageKey : null; window.dispatchEvent(event); }
        await after();
      },
      observe() {
        const shown = dialog(), kind = shown ? headings[shown.querySelector('h2').textContent] : 'none';
        const choices = shown ? [...shown.querySelectorAll('.alpha-browser-dialog-content button')] : [];
        const live = opening && !opening.done && reads.some(item => !item.settled && !item.signal.aborted);
        return {devProfile: trace.init.devProfile, foreground: !document.hidden, screenLocked: locked,
          installed: store.installed, selection: store.selection, revision: revisions,
          opening: live ? opening.name : 'none', dialog: kind,
          busy: edits.some(item => !item.settled),
          choicesWithdrawn: ['settings', 'install'].includes(kind) && choices.length > 0 && choices.every(item => item.disabled),
          unlocked: kind === 'open' && !button('Unlock development vault'),
          sample: !!document.querySelector('output[aria-label="Sample sign-in"]')};
      },
      teardown() { delete globalThis.__providerPorts; dom.restore(); },
    };
  };
}

async function checkPasswordProviderDialog({random = 40, steps = 30} = {}) {
  const create = await passwordProviderDialogDriver();
  const traces = modelTraces({...model, scenarios, witnesses, random, steps});
  return replayTraces(traces, create, {project: s => ({devProfile: s.devProfile, foreground: s.foreground, screenLocked: s.screenLocked,
    installed: s.installed, selection: s.selection, revision: s.revision, opening: s.opening, dialog: s.dialog, busy: s.busy,
    choicesWithdrawn: s.busy || s.saveFailed, unlocked: s.unlocked, sample: s.sample})});
}

test('the development password provider dialog follows every PasswordProviderDialog trace', {timeout: 240000}, async () => {
  const receipt = await checkPasswordProviderDialog();
  assert.equal(receipt.traces, 54);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['request', 'openSettles', 'editStart', 'editSettles', 'unlockVault', 'fillSample', 'close', 'hide', 'show', 'lockScreen', 'unlockScreen', 'externalChange'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
