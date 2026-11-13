// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

// DelegationReceiver traces replayed against the shipped Cloud delegation panel. Every trace is
// run against the mounted CloudDelegationPanel (React in jsdom): Start, the native return and its
// one-step gate, Check status and Cancel, with Cloud, the native return slot, the secure store and
// the browser hand-off as held ports. The Cancel decision (`delegationCancelStep`) is also checked
// on its own against every Cancel step and its full table.
import {after, test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import React, {act} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot} from '../specs/quint/refinement/services/identity-comms-traces.mjs';

const MODEL = {path: 'specs/quint/application/DelegationReceiver.qnt', module: 'DelegationReceiver'};
const model = readFileSync(`${repositoryRoot}${MODEL.path}`, 'utf8');
const SCENARIOS = [...model.matchAll(/^\s*run (\w+Test)\s*=/gm)].map(match => match[1]);
const WITNESSES = [...model.matchAll(/^\s*val (\w+Witness)\s*=/gm)].map(match => match[1]);
const source = readFileSync(`${repositoryRoot}apps/app/src/runtime/cloud-delegation-ui.tsx`, 'utf8');
const from = source.indexOf('export function delegationCancelStep('), to = source.indexOf('export function CloudDelegationPanel(');
assert.ok(from > 0 && to > from);
const {delegationCancelStep} = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source.slice(from, to))).toString('base64'));
// The panel's Cancel uses the decision twice: before and after reading Cloud's state.
assert.match(source, /if \(delegationCancelStep\(record\.phase, null\) === "read-status"\) \{\s*status = await recover\(record, false\);/);
assert.match(source, /if \(delegationCancelStep\(record\.phase, status\) !== "cancel"\) return;/);

/** What reading Cloud's state reports for an authorization, as the panel's recover() names it. */
const reported = cloud => cloud === 'complete' || cloud === 'failed' ? 'settled' : cloud;
/** The stored record, Cloud's state and the grant after a Cancel that reached Cloud. */
function cancelled(before) {
  let status = null, state = {record: before.record, cloud: before.cloud, grant: before.grant};
  if (delegationCancelStep(before.record, null) === 'read-status') {
    status = reported(before.cloud);
    // A settled authorization is applied by the read itself: a grant is adopted, an ended one cleared.
    if (status === 'settled') state = {record: 'none', cloud: before.cloud, grant: before.grant || before.cloud === 'complete'};
  }
  return delegationCancelStep(before.record, status) === 'cancel' ? {record: 'none', cloud: 'failed', grant: before.grant} : state;
}

test("partial source contract: the Cancel decision follows DelegationReceiver on every Cancel step of its traces", {timeout: scaledTimeout(240000)}, () => {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 300, steps: 40});
  let cancels = 0;
  const seen = new Set();
  for (const trace of traces) {
    let before = trace.init;
    for (const step of trace.steps) {
      if (step.action === 'cancelEnds' && step.args[0] === false) {
        assert.deepEqual(cancelled(before), {record: step.state.record, cloud: step.state.cloud, grant: step.state.grant}, `${trace.name}: cancel of ${before.record} with Cloud ${before.cloud}`);
        assert.equal(step.state.completes, before.completes, 'Cancel never sends completion');
        seen.add(`${before.record}/${before.cloud}`);
        cancels++;
      }
      before = step.state;
    }
  }
  assert.ok(cancels >= 20, `cancel steps replayed: ${cancels}`);
  // Every reachable combination of the stored phase and Cloud's state was decided.
  for (const pair of ['waiting/waiting', 'finishing/waiting', 'finishing/finishing', 'finishing/complete', 'finishing/failed']) assert.ok(seen.has(pair), pair);
  // The whole decision table, including the combinations the panel never asks about.
  assert.deepEqual(['waiting', 'finishing'].flatMap(phase => [null, 'settled', 'finishing', 'waiting'].map(status => delegationCancelStep(phase, status))),
    ['cancel', 'cancel', 'cancel', 'cancel', 'read-status', 'done', 'done', 'cancel']);
});

// The panel with its native plugin, secure store and browser hand-off replaced by the fixture on globalThis.
// The bundle sits inside the repository so that its React import resolves to the app's own copy.
mkdirSync(join(repositoryRoot, 'test-results'), {recursive: true});
const temp = mkdtempSync(join(repositoryRoot, 'test-results/quint-delegation-receiver-')), bundle = join(temp, 'panel.mjs');
after(() => rmSync(temp, {recursive: true, force: true}));
await build({entryPoints: [join(repositoryRoot, 'apps/app/src/runtime/cloud-delegation-ui.tsx')], bundle: true, platform: 'node', format: 'esm', outfile: bundle,
  external: ['react', 'react/jsx-runtime', '@capacitor/core'], logLevel: 'silent', plugins: [{name: 'delegation-ports', setup(builder) {
    builder.onResolve({filter: /platform-plugins$|native-connection$/}, args => ({path: args.path, namespace: 'ports'}));
    builder.onLoad({filter: /.*/, namespace: 'ports'}, args => ({contents: args.path.endsWith('platform-plugins')
      ? 'export const registerPlugin=()=>new Proxy({},{get:(_,key)=>globalThis.__delegationReplay.native[key]});'
      : 'export const secureConnectionStore=new Proxy({},{get:(_,key)=>globalThis.__delegationReplay.store[key]});export const openConnectionBrowser=(...args)=>globalThis.__delegationReplay.browser(...args);'}));
  }}]});

const SLOT = 'cloud-delegation:v1:email', OTHER = 'o'.repeat(43), MINUTE = 60000;
const flush = () => act(async () => { for (let turn = 0; turn < 12; turn++) await new Promise(resolve => setTimeout(resolve, 0)); });
// The gate's deferred-read flag and the announcement not yet read are refs inside the panel; they
// show only through the step that runs next. The deadline is compared while an authorization is stored.
const project = s => ({locked: s.locked, running: s.running, record: s.record, recordExpired: s.record !== 'none' && s.recordExpired, retained: s.retained,
  cloud: s.cloud, grant: s.grant, completes: s.completes, codeReturns: s.codeReturns, statusTaps: s.statusTaps, starts: s.starts});

async function create() {
  const realNow = Date.now;
  let now = realNow(), cloud = 'none', cloudAfter = 'waiting', native = null, connected = 0, completes = 0, codeReturns = 0, statusTaps = 0, starts = 0;
  let held = null, gate = null, mounted = false;
  Date.now = () => now;
  const slots = new Map(), listeners = [];
  const hold = kind => new Promise((resolve, reject) => { assert.equal(held, null, 'one step holds the gate'); held = {kind, resolve, reject}; });
  const stateOf = index => String(index).padStart(43, 's');
  const ports = globalThis.__delegationReplay = {
    native: {
      addListener: async (name, listener) => { listeners.push(listener); return {remove() {}}; },
      // After the panel has mounted, every read of the retained return is one held step.
      async readDelegationCallback() { if (mounted) await hold('callback'); return {callback: native}; },
      async clearDelegationCallback({state}) { if (native?.state === state) native = null; },
    },
    store: {
      read: async slot => slots.get(slot) ?? null,
      async compareExchange(slot, expected, next) {
        if (JSON.stringify(slots.get(slot) ?? null) !== JSON.stringify(expected)) return {status: 'conflict'};
        if (next?.phase === 'finishing' && expected?.phase === 'waiting') codeReturns++;
        if (next) slots.set(slot, next); else slots.delete(slot);
        return {status: 'saved'};
      },
    },
    browser: () => hold('start'),
  };
  const client = {async delegation(kind, input) {
    if (kind === 'revocations') return {grants: []};
    // The first Cloud request of a Check status or Cancel step is the held one.
    if (gate) { const step = gate; gate = null; await hold(step); }
    if (kind === 'start') { starts++; cloud = 'waiting'; return {authUrl: `https://cloud.example/app-auth/authorize?state=${stateOf(starts)}`, expiresAt: new Date(now + 10 * MINUTE).toISOString()}; }
    if (kind === 'status') return {status: cloud, ...(cloud === 'complete' ? {grantId: 'grant'} : {})};
    if (kind === 'complete') { completes++; cloud = cloudAfter; return {}; }
    if (kind === 'cancel') { cloud = 'failed'; return {}; }
    throw Error(`unexpected ${kind}`);
  }};
  const dom = new JSDOM('<div id="root"></div>', {url: 'http://localhost/'}), saved = {};
  for (const key of ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, {configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]});
  }
  const {CloudDelegationPanel} = await import(pathToFileURL(bundle).href), {createRoot} = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(CloudDelegationPanel, {client, scope: 'email', signal: new AbortController().signal, current: () => true, onConnected() { connected++; }})));
  await flush();
  mounted = true;
  // A control by its accessible name: the label where it has one, else its text.
  const named = item => item.getAttribute('aria-label') ?? item.textContent.trim();
  const button = label => { const found = [...document.querySelectorAll('button')].find(item => named(item) === label); assert.ok(found, label); return found; };
  const click = async label => { await act(async () => button(label).click()); await flush(); };
  const record = () => slots.get(SLOT) ?? null;
  const ends = async (failed, after) => { const step = held; held = null; cloudAfter = after ?? cloudAfter; if (failed) step.reject(Error('unreachable')); else step.resolve(); await flush(); };
  return {
    startAuthorization: () => click('Continue'),
    startEnds: () => ends(false),
    async nativeReturn(kind) {
      const state = kind === 'other' ? OTHER : record().state;
      native = kind === 'code' || kind === 'other' ? {state, code: 'code'} : kind === 'error' ? {state, error: 'access_denied'} : {state};
      await act(async () => { for (const listener of listeners) listener(); });
      await flush();
    },
    callbackEnds: (failed, after) => ends(failed, after),
    async checkStatus() { gate = 'status'; statusTaps++; await click('Refresh authorization status'); },
    statusEnds: (failed, after) => ends(failed, after),
    async cancelTap() { gate = 'cancel'; await click('Cancel authorization'); },
    cancelEnds: failed => ends(failed),
    cloudFinishes(complete) { cloud = complete ? 'complete' : 'failed'; },
    deadlinePasses() { now += 20 * MINUTE; },
    observe() {
      const stored = record(), control = [...document.querySelectorAll('button')].find(item => ['Continue', 'Refresh authorization status'].includes(named(item)));
      assert.equal(!!stored, named(control) === 'Refresh authorization status', 'the panel shows the stored authorization');
      return {locked: control.disabled, running: held?.kind ?? 'none', record: stored?.phase ?? 'none', recordExpired: !!stored && Date.parse(stored.expiresAt) <= now,
        retained: !native ? 'none' : native.state === OTHER ? 'other' : native.error ? 'error' : native.code ? 'code' : 'empty',
        cloud, grant: connected > 0, completes, codeReturns, statusTaps, starts};
    },
    async close() {
      await act(async () => root.unmount());
      dom.window.close(); Date.now = realNow; delete globalThis.__delegationReplay;
      for (const [key, value] of Object.entries(saved)) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; }
    },
  };
}

test("partial source contract: the mounted delegation panel follows DelegationReceiver scenarios, witnesses and random walks", {timeout: scaledTimeout(480000)}, async () => {
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 60, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 60);
  // The comparison is live: a model in which a return deferred behind Start was dropped is refused.
  const dropped = state => state.running === 'callback' ? {...project(state), running: 'none', locked: false} : project(state);
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'returnDuringStartTest'), create, {project: dropped}), /returnDuringStartTest step/);
  for (const action of ['startAuthorization', 'startEnds', 'nativeReturn', 'callbackEnds', 'checkStatus', 'statusEnds', 'cancelTap', 'cancelEnds', 'cloudFinishes', 'deadlinePasses'])
    assert.ok(receipt.actions[action] > 0, action);
});
