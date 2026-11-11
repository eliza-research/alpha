import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, replay, tick} from '../specs/quint/refinement/application/shell-model-traces.mjs';

// SettingsCapabilityReads traces from the simulator, replayed on the Settings adapter's own
// refreshCapabilities, licence loader and unmount reset, taken from the source. The Cloud client,
// its session, the ten-second limit and the notice file are the environment: each answers when
// the model says so. Mounting, opening Settings and a binding change call refreshCapabilities the
// way the adapter's mount, openView and connection subscription do.
const source = readFileSync('apps/app/src/prototype/settings-adapter.ts', 'utf8');
const slice = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return source.slice(a, b); };
assert.match(source, /initializeDevicePreferences\(\); void refresh\(\); void refreshCapabilities\(\);/);
assert.match(source, /if \(key === 'settings'\) \{ void refresh\(\); void refreshCapabilities\(true\); \}/);
assert.match(source, /if \(next !== lastBinding\) \{ lastBinding = next; void refreshCapabilities\(\); \}/);
const code = stripTypeScriptTypes(`
let owner = null, facts = {}, controls = {}, delivery = {}, generation = 0, cross = {}, choices = null, history = null, roles = null, crashLog = null;
let capabilityAbort = null, inferenceAbort = null, scaleGeneration = 0, scaleVersion = 0, scalePending = false, scaleResults = null, updateBusy = '', updateResult = '', gmail = 'Not checked', gmailAccounts = [], inferenceProvider = 'Not reported', listener = null;
const textScaleSettlement = () => null, changed = () => { changes++; };
let changes = 0;
${slice('let licenses: {', '/** Native reset results that only echo')}
${slice('  async function refreshCapabilities(enteringSettings=false) {', '  /** Android shows its own role dialog')}
globalThis.page = {
  mount(instance) { owner = instance; void refreshCapabilities(); }, unmount(instance) { (function () { ${slice('if (owner === this) { capabilityAbort?.abort();', '\n')} }).call(instance); },
  refreshCapabilities, loadLicenses: () => loadLicenses(changed), shown: () => ({gmail, licenses: licenses.status}),
};`);
const LABELS = {'Not checked': 'unchecked', 'Cloud sign-in required': 'signin', 'Checking authorization…': 'checking',
  verified: 'verified', 'Authorization not verified': 'unverified'};

function fixture() {
  const reads = [], limits = new Map(), fetches = [];
  let session = 1, armed = 0, fetched = 0, instance;
  const context = vm.createContext({AbortController, Promise, Error, Array,
    imageSenseAvailable: () => false, browserLocalAgentEnabled: false, listenerReads: {}, gmailGrantLabel: () => 'verified',
    connectionController: {getCloudClient: () => session === 0 ? null : {sessionId: session, client: {
      gmailAccounts: signal => new Promise((settle, fail) => reads.push({session, settle, fail, signal}))}}},
    setTimeout(run, delay) { assert.equal(delay, 10000); limits.set(++armed, run); return armed; },
    clearTimeout(id) { limits.delete(id); },
    fetch(url) { assert.equal(url, 'licenses/third-party-notices.json'); fetched++; return new Promise((settle, fail) => fetches.push({settle, fail})); },
  });
  vm.runInContext(code, context);
  const {page} = context;
  // Reads are named by the order in which the page started them, which is the model's token.
  let started = 0;
  const name = () => { for (const read of reads) if (read.token === undefined) read.token = started; };
  return {
    async apply({action, picks, state}) {
      started = state.issued;
      if (action === 'mount') { instance = {view: null, S() { return {view: this.view}; }, vset() {}}; page.mount(instance); }
      else if (action === 'unmount') page.unmount(instance);
      else if (action === 'openSettings') { instance.view = 'settings'; void page.refreshCapabilities(true); }
      else if (action === 'leaveSettings') instance.view = null;
      else if (action === 'refresh') void page.refreshCapabilities();
      else if (action === 'sessionChanges') { session = picks.session; void page.refreshCapabilities(); }
      else if (action === 'accountsSettle') {
        const read = reads.splice(reads.findIndex(entry => entry.token === picks.read.token), 1)[0];
        if (picks.flag) read.fail(Error('unavailable')); else read.settle([{email: 'owner@example.com'}]);
      } else if (action === 'limit') {
        const read = reads.splice(reads.findIndex(entry => entry.token === picks.token), 1)[0], run = limits.get(picks.token);
        limits.delete(picks.token);
        run();
        // The client ends an abandoned request with the abort it was given.
        assert.equal(read.signal.aborted, true);
        read.fail(new DOMException('aborted', 'AbortError'));
      } else if (action === 'openLicenses') void page.loadLicenses();
      else if (action === 'licensesSettle') {
        const request = fetches.shift();
        if (picks.flag) request.settle({ok: true, json: async () => [{name: 'library', version: '1.0.0', license: 'MIT'}]});
        else request.fail(Error('offline'));
      } else assert.fail(`unmapped action ${action}`);
      name();
      await tick();
      // Every started read arms one limit, so limit ids are the model's tokens.
      assert.equal(armed, state.issued);
    },
    observe() {
      const shown = page.shown();
      return {gmail: LABELS[shown.gmail], reads: reads.map(read => read.token).sort(), limits: [...limits.keys()].sort(),
        licenses: shown.licenses, fetching: fetches.length > 0, fetches: fetched};
    },
  };
}

test('simulated SettingsCapabilityReads traces agree with the capability read and licence loader after every step', {timeout: 170000}, async () => {
  const traces = modelTraces({module: 'SettingsCapabilityReads', traces: 200, steps: 40});
  const result = await replay(traces, {
    start: fixture,
    project: s => ({gmail: s.gmail, reads: s.reads.map(read => read.token).sort(), limits: [...s.limits].sort(), licenses: s.licenses,
      fetching: s.fetching, fetches: s.fetches}),
  });
  assert.deepEqual([...result.exercised].sort(), ['accountsSettle', 'leaveSettings', 'licensesSettle', 'limit', 'mount', 'openLicenses',
    'openSettings', 'refresh', 'sessionChanges', 'unmount']);
});
