import {serviceInputs} from './source-inputs.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {inboxDriverSources, rebuildInboxDriver} from './inbox-coordinator-ports.mjs';
import {action, observe, step, setup, compose, review, startSend} from './inbox-coordinator.mjs';

const stages = ['retained', 'shelf', 'saved'];
const actions = {retained: 'clearRetained', shelf: 'clearShelf', saved: 'clearSaved'};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}

async function until(ready, description) {
  const deadline = Date.now() + 10000;
  while (!ready()) {
    assert.ok(Date.now() < deadline, description);
    await new Promise(done => setTimeout(done, 0));
  }
}

function writeStage({key, value}) {
  if (key.includes(':unsaved:') && value?.text === '') return 'retained';
  if (key.includes(':shelf:') && value?.items?.length === 0) return 'shelf';
  if (key.startsWith('inbox-drafts:v1:[') && value === null) return 'saved';
  return null;
}

async function prepareCopies(fixture, coordinator, trace) {
  await compose(fixture, coordinator, trace, {save: true});
  fixture.gates({store: async event => {
    if (writeStage(event) === 'saved') throw Error('Controlled set-aside write refusal');
  }});
  assert.equal(await coordinator.drafts.newEmail(), false);
  fixture.gates({});
  step(trace, 'a failed set-aside keeps its shelf snapshot and prior saved copy', action('shelveSnapshot'), observe(fixture, coordinator));
  coordinator.drafts.render().c.onBody({target: {value: 'original'}});
  await fixture.settle();
  step(trace, 'same-content typing creates the real retained recovery record', action('retainDraft'), observe(fixture, coordinator));
  await review(fixture, coordinator, trace);
}

async function interruptedCleanup(faultStage, faultMode, traces) {
  const name = faultStage ? `${faultStage}-${faultMode}` : 'complete';
  const {fixture, coordinator, trace} = await setup(`cleanup-${name}`, traces);
  await prepareCopies(fixture, coordinator, trace);
  const dispatch = await startSend(fixture, coordinator, trace);
  const pending = new Map();
  fixture.gates({
    store: async event => {
      const stage = writeStage(event);
      if (!stage) return;
      const gate = deferred();
      pending.set(stage, gate);
      await gate.promise;
      if (stage === faultStage && faultMode === 'before') throw Error('Controlled cleanup write refusal');
    },
    storeResult: async event => {
      if (writeStage(event) === faultStage && faultMode === 'after') throw Error('Controlled cleanup reply loss');
    },
  });
  dispatch.resolve();
  await until(() => pending.has('retained'), 'retained cleanup reaches storage');
  step(trace, 'confirmed send clears its matching current composer before persisted cleanup', [action('result', 'succeeded'), action('startCleanup')], observe(fixture, coordinator));
  for (const stage of stages) {
    pending.get(stage).resolve();
    const failed = stage === faultStage;
    if (failed || stage === 'saved') await fixture.settle();
    else await until(() => pending.has(stages[stages.indexOf(stage) + 1]), 'next cleanup write reaches storage');
    const committed = !failed || faultMode === 'after';
    step(trace, `${stage} cleanup ${failed ? faultMode === 'after' ? 'commits but loses its reply' : 'is refused before commit' : 'commits'}`,
      action(actions[stage], committed, !failed), observe(fixture, coordinator));
    if (failed) break;
  }
  assert.equal(fixture.state.dispatches, 1);
  const kept = observe(fixture, coordinator);
  coordinator.dispose();
  fixture.gates({});
  const reopened = fixture.createPair();
  await reopened.bind();
  step(trace, 'restart checks the same provider receipt and finishes remaining cleanup', [
    action('restart'), action('checkReceipt', true), action('startCleanup'),
    action('clearRetained', kept['copy.retained'] !== 0, true),
    action('clearShelf', kept['copy.shelf'] !== 0, true),
    action('clearSaved', kept['copy.saved'] !== 0, true),
  ], observe(fixture, reopened));
  assert.equal(fixture.state.dispatches, 1);
  assert.equal(observe(fixture, reopened)['copy.saved'], 0);
  reopened.dispose();
}

async function retiredDuringKnownClear(traces) {
  const {fixture, coordinator, trace} = await setup('retired-during-known-retained-clear', traces);
  await prepareCopies(fixture, coordinator, trace);
  const dispatch = await startSend(fixture, coordinator, trace);
  const reply = deferred();
  let committed = false;
  fixture.gates({storeResult: async event => {
    if (writeStage(event) === 'retained') {
      committed = true;
      await reply.promise;
    }
  }});
  dispatch.resolve();
  await until(() => committed, 'retained clear commits before its reply');
  step(trace, 'retained clear becomes durable while its acknowledgement is held', [
    action('result', 'succeeded'), action('startCleanup'), action('publishRetainedClear'),
  ], observe(fixture, coordinator));
  const rebound = coordinator.bind('grant-2');
  await until(() => coordinator.provider.capabilities()?.from === 'owner-2@example.test' && coordinator.drafts.ready, 'replacement account binds');
  step(trace, 'account binding changes before the old clear acknowledgement', [action('bind', 2), action('regrant')], observe(fixture, coordinator, 2));
  assert.equal(coordinator.drafts.begin(undefined, undefined, '', {to: ['next@example.test'], subject: 'Next', body: 'original'}), true);
  await until(() => [...fixture.slots.values()].some(value => value?.binding?.includes('grant-2') && value.text), 'replacement retained draft persists');
  step(trace, 'replacement account retains its independent draft', action('newDraft'), observe(fixture, coordinator, 2));
  reply.resolve();
  await rebound;
  await fixture.settle();
  const oldRetained = observe(fixture, coordinator)['copy.retained'];
  assert.equal(oldRetained, 1);
  step(trace, 'late acknowledgement compensates only its own known clear', [action('clearRetained', false, true), action('restoreRetained', true)], {
    ...observe(fixture, coordinator, 2), 'firstCopy.retained': oldRetained,
  });
  fixture.gates({});
  await coordinator.bind('grant-1');
  step(trace, 'returning to the original account rechecks its receipt and clears restored copies', [
    action('bind', 1), action('regrant'), action('checkReceipt', true), action('startCleanup'),
    action('clearRetained', true, true), action('clearShelf', true, true), action('clearSaved', true, true),
  ], observe(fixture, coordinator));
  assert.equal(fixture.state.dispatches, 1);
  coordinator.dispose();
}

async function peerSavedDuringCleanup(traces) {
  const {fixture, coordinator, trace} = await setup('peer-saves-during-saved-copy-cleanup', traces);
  await prepareCopies(fixture, coordinator, trace);
  const peer = fixture.createPair();
  await peer.bind();
  const resume = peer.drafts.chips((label, pick) => ({label, pick})).find(row => row.label === 'Resume unsaved email');
  assert.ok(resume);
  resume.pick();
  const dispatch = await startSend(fixture, coordinator, trace);
  const pending = deferred();
  let entered = false;
  fixture.gates({store: async event => {
    if (writeStage(event) === 'saved') {
      entered = true;
      await pending.promise;
    }
  }});
  dispatch.resolve();
  await until(() => entered, 'saved-copy clear is pending');
  step(trace, 'cleanup reaches its final saved-copy CAS', [action('result', 'succeeded'), action('startCleanup'),
    action('clearRetained', true, true), action('clearShelf', true, true)], observe(fixture, coordinator));
  peer.drafts.render().c.onBody({target: {value: 'edited'}});
  peer.drafts.render().c.save();
  await until(() => [...fixture.slots.values()].some(value => value?.id && value.body === 'edited'), 'peer saves a newer revision');
  step(trace, 'another actual composer saves a newer version', action('peerSave'), observe(fixture, coordinator));
  pending.resolve();
  await fixture.settle();
  step(trace, 'the old cleanup CAS cannot remove the peer saved revision', action('clearSaved', false, false), observe(fixture, coordinator));
  assert.equal(observe(fixture, coordinator)['copy.saved'], 2);
  assert.equal(observe(fixture, coordinator)['copy.earlier'], false);
  peer.dispose();
  coordinator.dispose();
  fixture.gates({});
  const reopened = fixture.createPair();
  await reopened.bind();
  step(trace, 'restart retains the newer saved version without marking it as an older sent copy', [
    action('restart'), action('checkReceipt', true), action('startCleanup'),
    action('clearRetained', false, true), action('clearShelf', false, true), action('clearSaved', false, true),
  ], observe(fixture, reopened));
  assert.equal(fixture.state.dispatches, 1);
  reopened.dispose();
}

export async function runInboxCleanupRefinement(extraSources = []) {
  const discovered = await inboxDriverSources();
  const sources = [...discovered, ...extraSources, fileURLToPath(import.meta.url),
    'specs/quint/refinement/services/inbox-coordinator-ports.mjs',
    'specs/quint/refinement/services/inbox-coordinator.mjs', 'package-lock.json'];
  const inputs = serviceInputs(sources);
  const driverHashes = captureInputs(inputs);
  rebuildInboxDriver(discovered);
  const traces = [];
  await interruptedCleanup(null, null, traces);
  for (const stage of stages) {
    for (const mode of ['before', 'after']) await interruptedCleanup(stage, mode, traces);
  }
  await retiredDuringKnownClear(traces);
  await peerSavedDuringCleanup(traces);
  const receipt = await checkTraces({model: 'InboxCoordinator', id: 'InboxCleanup', sources: inputs, driverHashes,
    traces, scope: 'bounded-orchestration', assumptions: [
      'Actual composer, unsaved recovery, provider controls and InboxOperation execute. Faults occur before an atomic storage CAS or after its durable commit but before its reply.',
      'Four copies of one exact draft arise through real source entrypoints, including a set-aside whose shelf write succeeds before saved-copy removal is refused.',
      'Each restart rereads the existing provider receipt before retrying cleanup. The provider request is never dispatched again.',
      'One cleanup invocation is in flight in these schedules. Installed secure storage and actual Gmail outcomes remain external obligations.',
    ]});
  return {receipts: [receipt], obligations: [
    {model: 'InboxCoordinator', obligation: 'broader copy and provider orchestration', reason: 'These cleanup schedules cover exact content and individual persistence boundaries. Concurrent edited shelves, provider drafts, forwarding and installed storage remain additional schedules.'},
  ]};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const {receipts} = await runInboxCleanupRefinement();
  console.log(JSON.stringify({traces: receipts[0].traces, checkpoints: receipts[0].checkpoints}));
}
