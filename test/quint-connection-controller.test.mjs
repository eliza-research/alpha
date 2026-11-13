// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

// ConnectionController traces replayed against the shipped connection step slot: work(),
// releaseOperation, the provider key manager, the sign-in return and notice queue, the rebind
// request and the shared rebind queue. The source is sliced from connection-ui.tsx and run with
// held ports in place of Cloud, the agent and the key store; no renderer or phone is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {modelTraces, replayTraces, repositoryRoot, settle} from '../specs/quint/refinement/services/identity-comms-traces.mjs';
import {ResidentRebindQueue} from '../.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts';

const MODEL = {path: 'specs/quint/application/ConnectionController.qnt', module: 'ConnectionController'};
const source = readFileSync(`${repositoryRoot}specs/quint/application/ConnectionController.qnt`, 'utf8');
const SCENARIOS = [...source.matchAll(/^\s*run (\w+Test)\s*=/gm)].map(match => match[1]);
const WITNESSES = [...source.matchAll(/^\s*val (\w+Witness)\s*=/gm)].map(match => match[1]);

const ui = readFileSync(`${repositoryRoot}apps/app/src/runtime/connection-ui.tsx`, 'utf8');
const between = (start, end) => { const from = ui.indexOf(start), to = ui.indexOf(end, from + start.length); assert.ok(from >= 0 && to > from, start); return ui.slice(from, to); };
// A rebind retires the connection, which starts a new connection epoch.
assert.match(between('function retire(name?: string) {', '\nfunction '), /\n  epoch\+\+;/);
const startup = /\.finally\(\(\)=>\{(update\(\{startupResolved:true,automaticRestore:false\}\);runQueuedSignInReturn\(\);)\}\)/.exec(ui);
assert.ok(startup, 'startup settles and then runs the sign-in queue');
const code = stripTypeScriptTypes([
  between('let residentRebindQueue: ResidentRebindQueue | null = null;', '/**'),
  between('async function work(message: string', '/** Only an explicitly failed native start'),
  between("async function manageProviderKey(action:'reveal'", '/** P-43: a startup path'),
  between('function queueResidentRebind(', '/** A native sign-in return that arrived while'),
  between('/** A native sign-in return that arrived while', 'async function remoteIdentity('),
  `const connectionController={async signInReturned(value){${between('    if (operation) { queuedSignInReturn = value; return; }', '    if (outcome.status ===')}
     returned.push(value);await work('Finishing sign-in…',()=>hold('return'));},
   ${between('  signInIncomplete(value: unknown) {', '  /**\n   * The Cloud sign-in hand-off')}};`,
  `Object.assign(globalThis,{work,manageProviderKey,queueResidentRebind,connectionController,startupSettles(){${startup[1]}},
     queued:()=>({returned:queuedSignInReturn!==null,notice:queuedSignInIncomplete,rebind:!!residentRebindQueue?.pending})});`,
].join('\n'), {mode: 'strip'});
const RESTARTED = 'Sign in again', UNVERIFIED = 'failure:app-link-unverified';

const project = s => ({operation: s.operation, startupResolved: s.startupResolved, rebindWanted: s.rebindWanted, rebinds: s.rebinds,
  queuedReturn: s.queuedReturn, returnsHandled: s.returnsHandled, incomplete: s.incomplete, incompleteFenced: s.incompleteFenced,
  stale: s.incompleteFenced && s.viewChanged, notices: s.notices});

function create() {
  let held = null, notices = 0, rebinds = 0, returns = 0;
  const box = {AbortController, DOMException, Error, Promise, setTimeout, ResidentRebindQueue, cancelStoppedVoiceRead(){},
    operation: null, sending: null, epoch: 1, active: null, planRecheck: null, signInReadinessOwner: null, providerStatusGeneration: 0,
    residentStartInBackground: false, residentStartFailure: 'The agent could not start.', testMocksEnabled: false, residentAlwaysPresent: true, returned: [],
    state: {open: false, signIn: null, message: '', error: '', busy: false, startupResolved: false},
    // A notice opens its recovery message even when no sign-in form is active.
    // A rebind preserving an earlier error writes the error alone.
    update(patch) { if (patch.open === true && patch.message === '' && (patch.error === RESTARTED || patch.error === UNVERIFIED)) notices++; Object.assign(box.state, patch); },
    // One held port: the step, sign-in return, rebind or key request that owns the slot waits on it.
    hold(kind) { assert.equal(held, null, 'one step holds the slot'); return new Promise(resolve => { held = {kind, resolve}; }); },
    signInFailureMessage: value => `failure:${value}`, errorMessage: error => String(error?.message ?? error), errorKindOf: () => undefined,
    residentRecoveryReason: () => null, expired: () => false, cloud: {environment: 'production'}, detachService() {},
    residentCloudFlow: () => true, residentEnvironment: () => 'production', scheduleResidentAutoRetry() {},
    retire() { box.epoch++; },
    connectResident() { rebinds++; return box.hold('rebind'); },
    anyAbortSignal: signals => AbortSignal.any(signals),
    revealLocalProviderKey: () => box.hold('key-manager').then(() => ({key: 'text', revision: 'fixture', shown: true, hidesAfterMs: 30000})),
  };
  vm.createContext(box);
  vm.runInContext(code, box);
  const release = async () => { const {resolve} = held; held = null; resolve(); await settle(); };
  return {
    async startupSettles() { box.startupSettles(); await settle(); },
    async stepStarts() { void box.work('Working…', () => box.hold('step')); await settle(); },
    stepEnds: release,
    async keyManagerStarts() { void box.manageProviderKey('reveal', 'text', 'fixture', new AbortController().signal); await settle(); },
    keyManagerEnds: release,
    async nativeReturn() { void box.connectionController.signInReturned({status: 'signed-in', sequence: ++returns}); await settle(); },
    async incompleteArrives() { box.connectionController.signInIncomplete({code: 'app-link-unverified'}); await settle(); },
    viewChanges() { box.epoch++; },
    async rebindRequested() { box.queueResidentRebind(); await settle(); },
    observe() {
      const queued = box.queued(), notice = queued.notice;
      assert.equal(!!box.operation, held !== null, 'the slot is held exactly while a step is in flight');
      assert.equal(box.state.busy, !!box.operation);
      return {operation: held?.kind ?? 'none', startupResolved: box.state.startupResolved, rebindWanted: queued.rebind, rebinds,
        queuedReturn: queued.returned, returnsHandled: box.returned.length,
        incomplete: !notice ? 'none' : notice.restarted ? 'restarted' : 'plain', incompleteFenced: !!notice && notice.epoch !== undefined,
        stale: !!notice && notice.epoch !== undefined && (notice.epoch !== box.epoch || notice.signIn !== box.state.signIn), notices};
    },
  };
}

test("partial source contract: the connection step slot follows ConnectionController scenarios, witnesses and random walks", {timeout: 240000}, async () => {
  assert.ok(SCENARIOS.length >= 8 && WITNESSES.length >= 6);
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 80, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 80);
  // The comparison is live: a model whose key-manager release left the queued return waiting is refused.
  const undrained = state => ({...project(state), returnsHandled: 0});
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'keyManagerReleaseRunsQueuedReturnTest'), create, {project: undrained}), /keyManagerReleaseRunsQueuedReturnTest step/);
  for (const action of ['startupSettles', 'stepStarts', 'stepEnds', 'keyManagerStarts', 'keyManagerEnds', 'nativeReturn', 'incompleteArrives', 'viewChanges', 'rebindRequested']) assert.ok(receipt.actions[action] > 0, action);
});
