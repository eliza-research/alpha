// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

// SignInReadinessProbe traces replayed against the shipped connection controller: beginSignIn and
// its readiness probe (inAppSignInMethods, the late answer), Back (cancelSignIn, cancel, close),
// configureLocal over a probe, the step slot, the predicates that decide the sign-in entry and the
// body of the automatic entry's effect, all sliced from connection-ui.tsx. The sign-in host and
// the key save are held ports; React does not run, so the trace decides when the effect runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {modelTraces, replayTraces, repositoryRoot, settle} from '../specs/quint/refinement/services/identity-comms-traces.mjs';
import {signInController} from './fixtures/connection-sign-in-slice.mjs';

const MODEL = {path: 'specs/quint/application/SignInReadinessProbe.qnt', module: 'SignInReadinessProbe'};
const model = readFileSync(`${repositoryRoot}${MODEL.path}`, 'utf8');
const SCENARIOS = [...model.matchAll(/^\s*run (\w+Test)\s*=/gm)].map(match => match[1]);
const WITNESSES = [...model.matchAll(/^\s*val (\w+Witness)\s*=/gm)].map(match => match[1]);

const entryOf = s => s.ownKeys === 'saved' ? 'none' : s.host === 'android' && (s.startupResolved || s.ownKeys === 'refused' || s.pageLatched) ? 'required'
  : s.account ? 'opened' : s.host === 'preview' && s.startupResolved ? 'first-run' : 'none';
// Whether the probe in the slot is the automatic one is the caller's knowledge, not controller state.
const project = s => ({host: s.host, operation: s.operation, readinessOwner: s.readinessOwner, entry: entryOf(s), chooser: s.chooser, startupResolved: s.startupResolved, pageLatched: s.pageLatched,
  latch: s.latch, probes: s.probes, late: s.late, lateAdopted: s.lateAdopted, lateDropped: s.lateDropped, ownKeys: s.ownKeys, residentStarts: s.residentStarts});

function create() {
  const {box, port, controller} = signInController();
  let host = 'browser', late = null, lateAdopted = 0, lateDropped = 0;
  // An ended probe leaves its readiness read unanswered; a new probe abandons an answer still owed.
  const ended = async () => { await settle(); if (port.held === 'probe' && !box.operation) port.detach(); };
  // Android's retained page can outlive the raw initial-admission predicate. It remains the
  // required Android page; only the browser preview's automatic page is a first-run entry.
  const entry = () => { const view = box.renderSignInEntry(); return !view.signInEntryRequired ? 'none' : view.productionSignInRequired || box.isAndroid && view.signInPage ? 'required' : view.signInPage ? 'first-run' : 'opened'; };
  return {
    host(kind) { host = kind; box.isAndroid = kind === 'android'; box.browserCloudResidentEnabled = kind === 'preview'; },
    // The preview's first run shows the connection sheet.
    startupSettles() { box.update({startupResolved: true, automaticRestore: false, ...(host === 'preview' ? {open: true} : {})}); },
    async automaticProbe() { const before = port.probes; box.automaticEntryEffect(); await settle(); if (port.probes > before) late = null; },
    latchReleases() { box.automaticEntryEffect(); },
    async ownerProbe() {
      if (box.operation) { await controller.beginSignIn(); return; }
      // With no entry showing, the owner opens the account sign-in; otherwise this is a retry on the page.
      if (entry() === 'none') box.update({purpose: 'cloud-account'});
      late = null; void controller.beginSignIn(); await settle();
    },
    async probeSettles(lateFollows) {
      if (lateFollows) { port.readinessTimesOut(); late = port.detach(); } else port.release({google: false, phone: false, email: true});
      await settle();
      assert.equal(box.offered().google, false);
    },
    async lateReadiness() {
      const answer = late; late = null; answer.resolve({google: true, phone: false, email: true}); await settle();
      if (box.offered().google) lateAdopted++; else lateDropped++;
    },
    async stepStarts() { void box.work('Working…', signal => port.hold('step', signal)); await settle(); },
    async stepEnds() { port.release(); await settle(); },
    async saveOwnKeys() { if (port.held === 'probe') late = null; void port.asWaiter('save', () => controller.configureLocal('key', 'model', undefined, {onboarding: true})); await ended(); },
    async ownKeysTakeSlot() { assert.ok(port.tick('save')); await settle(); },
    async ownKeysWaitEnds() { assert.ok(port.tick('save')); await settle(); },
    async ownKeysEnd(saved) { if (saved) port.release(); else controller.cancel(); await settle(); },
    async back() { if (port.held === 'probe') late = null; await controller.cancelSignIn(); await ended(); },
    observe() {
      assert.equal(!!box.operation, port.held !== 'none', 'the slot is held exactly while a step is in flight');
      assert.equal(box.readinessOwned(), port.held === 'probe', 'the probe in the slot is the readiness owner');
      const saved = box.state.providerStatus?.selected === true;
      const view = box.renderSignInEntry();
      return {host, operation: port.held, readinessOwner: box.readinessOwner() !== null, entry: entry(), chooser: box.state.signIn?.step === 'choose',
        startupResolved: box.state.startupResolved, pageLatched: view.signInPage, latch: box.automaticLatch(), probes: port.probes, late: late !== null, lateAdopted, lateDropped,
        ownKeys: port.held === 'own-keys' ? 'saving' : port.waiting('save') ? 'waiting' : saved ? 'saved' : box.state.error === 'busy' ? 'refused' : 'none',
        residentStarts: port.residentStarts};
    },
  };
}

test("partial source contract: the readiness probe follows SignInReadinessProbe scenarios, witnesses and random walks", {timeout: 240000}, async () => {
  assert.ok(SCENARIOS.length >= 10 && WITNESSES.length >= 7);
  const traces = modelTraces({...MODEL, scenarios: SCENARIOS, witnesses: WITNESSES, random: 80, steps: 30});
  const receipt = await replayTraces(traces, create, {project});
  assert.equal(receipt.traces, SCENARIOS.length + WITNESSES.length + 80);
  // The comparison is live: a model in which a probe ended for an own-keys save still started the agent is refused.
  const started = state => state.ownKeys === 'waiting' ? {...project(state), residentStarts: state.residentStarts + 1} : project(state);
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'ownKeysOverProbeTest'), create, {project: started}), /ownKeysOverProbeTest step/);
  const disappeared = state => state.operation === 'probe' && !state.startupResolved && state.pageLatched
    ? {...project(state), entry: 'none', pageLatched: false} : project(state);
  await assert.rejects(replayTraces(traces.filter(trace => trace.name === 'refusalRetryBeforeStartupTest'), create, {project: disappeared}), /refusalRetryBeforeStartupTest step/);
  for (const action of ['host', 'startupSettles', 'automaticProbe', 'latchReleases', 'ownerProbe', 'probeSettles', 'lateReadiness', 'stepStarts', 'stepEnds',
    'saveOwnKeys', 'ownKeysTakeSlot', 'ownKeysWaitEnds', 'ownKeysEnd', 'back']) assert.ok(receipt.actions[action] > 0, action);
});
