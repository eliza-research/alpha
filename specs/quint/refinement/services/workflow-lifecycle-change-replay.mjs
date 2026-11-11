/** Existing source-executing MBT harness, shared by its original owning tests and the strict services receipt. */
import assert from 'node:assert/strict';
import {recordComparedObservation} from '../observed-replay.mjs';
let observedTraces=0,observedCheckpoints=0;
const {actionCounter, modelScenario} = await import('./inbox-workflows-model-traces.mjs');
const {workflowAdapter, intentSlot, wait} = await import('./workflow-adapter-fixture.mjs');
const {WorkflowLifecycleRejected} = await import('../../../../apps/app/src/runtime/workflow-protocol.ts');

const model = 'specs/quint/services/WorkflowLifecycleChange.qnt', main = 'WorkflowLifecycleChange';
const scenarios = ['reviewedRemovalTest', 'lostReplyStaysRetainedTest', 'neverSentIsResentTest', 'delayedCopyAndResendApplyOnceTest', 'refusedResendStaysRetainedTest',
  'resendAfterEditReleasesTest', 'abandonedResendKeepsEntryTest', 'changedVersionReleasesTest', 'refusedChangeReleasesTest', 'interruptedRunsAreCancelledFirstTest',
  'unreadRetainedCannotResendTest', 'retainedBlocksAnotherChangeTest', 'appliedCopyCannotApplyAgainTest', 'ongoingRunBlocksRemovalTest', 'abortBeforeDispatchReleasesTest'];
const slot = intentSlot('flow', ':lifecycle');
const edits = versionId => Number(/^e(\d+)/.exec(versionId)[1]);
const gate = () => { let open, refuse; const reached = new Promise((resolve, reject) => { open = resolve; refuse = reject; }); return {reached, open, refuse, waiting: false}; };

/**
 * The real adapter over an agent that applies one request at most once, for the version it names,
 * and refuses a change while a run is unfinished. Every request stops where the model has a step:
 * before its journal write lands (only when the scenario leaves at that point), before it is sent,
 * and on its way to and from the agent.
 */
async function subject(walk) {
  const agent = {edits: 0, removed: false, run: 'none', receipts: new Map(), applications: 0};
  const version = () => `e${agent.edits}a${agent.applications}`;
  const workflow = () => ({id: 'flow', name: 'Digest', description: 'Reads notes', versionId: version(), active: false, removed: agent.removed, triggerCleanup: agent.removed ? 'complete' : undefined, steps: [{label: 'Read', description: 'Read notes'}]});
  const runs = () => agent.run === 'none' ? [] : [{id: 'run', workflowId: 'flow', versionId: 'e0a0', status: 'running', finished: agent.run === 'finished', startedAt: '2026-01-01T00:00:00.000Z', events: [],
    ...(agent.run === 'interrupted' ? {reconciliation: {state: 'outcome-unknown'}} : {})}];
  const posts = [], admitted = [];
  let wire = [], call = null, held = null, cancelling = null, opened = true, index = 0, serial = 0;
  const leavesBeforeDispatch = () => walk.slice(index + 1).find(step => ['dispatch', 'abortBeforeDispatch', 'restart'].includes(step.action))?.action === 'abortBeforeDispatch';
  const send = (mutationId, versionId, operation, resend) => new Promise((resolve, reject) => {
    posts.push({mutationId, versionId, operation, resend}); wire = [...wire.filter(copy => copy.mutationId === mutationId), {mutationId, versionId, operation}].slice(-2);
    call = {resolve, reject, reply: null};
  });
  const client = {lifecycleSupported: async () => true, supportsSubmissionReconciliation: async () => true, list: async () => agent.removed ? [] : [workflow()], removedWorkflows: async () => agent.removed ? [workflow()] : [],
    detail: async () => workflow(), executions: async () => runs(), approvals: async () => null, phoneReview: async () => ({steps: []}), reconcile: async () => null,
    reconcileLifecycle: async (_id, _version, mutationId) => agent.receipts.get(mutationId) ?? null,
    lifecycle: async (_id, versionId, operation, _signal, admit) => {
      const mutationId = `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`, stop = held = {...gate(), stage: leavesBeforeDispatch() ? 'journal' : 'admitted', mutationId, versionId, operation};
      admitted.push(mutationId);
      if (stop.stage === 'journal') { stop.waiting = true; await stop.reached; await admit(mutationId); throw Error('The adapter went on to send a change its owner had left'); }
      await admit(mutationId); stop.waiting = true; await stop.reached;
      return send(mutationId, versionId, operation, false);
    },
    resendLifecycle: async (_id, versionId, mutationId, operation) => {
      const stop = held = {...gate(), stage: 'resending', mutationId}; stop.waiting = true; await stop.reached;
      // The route client reads the receipt first and sends only without one.
      return agent.receipts.get(mutationId) ?? send(mutationId, versionId, operation, true);
    },
    cancel: async () => { const stop = cancelling = {...gate(), waiting: true}; await stop.reached; }};
  const storage = {};
  const app = await workflowAdapter({client, storage});
  const fd = () => app.render().fd;
  const idle = () => wait(() => app.render().detail && !fd().busy, 'the workflow did not settle');
  const open = async () => { app.render().openWorkflow('flow'); await idle(); opened = true; };
  await open();
  const reviewing = () => opened && (fd().lifecycleReview || fd().deleteLabel === 'Confirm resend');
  const answer = async settle => { const pending = call; call = null; settle(pending); await idle(); };
  const serve = (action) => {
    const copy = wire[wire.length - 1], receipt = agent.receipts.get(copy.mutationId);
    const verdict = receipt ? 'serverReplay' : copy.versionId !== version() || ['ongoing', 'interrupted'].includes(agent.run) ? 'serverReject' : 'serverApply';
    assert.equal(verdict, action, 'the agent and the model disagree on what becomes of this request');
    wire = wire.slice(0, -1);
    if (verdict === 'serverApply') {
      const applied = {mutationId: copy.mutationId, workflowId: 'flow', previousVersionId: copy.versionId, operation: copy.operation, appliedAt: '2026-01-01T00:00:00.000Z'};
      agent.removed = copy.operation === 'remove'; agent.applications++; applied.versionId = version(); agent.receipts.set(copy.mutationId, applied);
    }
    if (call) call.reply = verdict === 'serverReject' ? 'rejected' : agent.receipts.get(copy.mutationId);
  };
  const apply = async (action, after, args = []) => {
    if (action === 'lifecycleTap') {
      fd().del();
      if (after.stage === 'admitted') await wait(() => held?.waiting && held.stage !== 'resending', 'the change was not recorded');
      if (after.stage === 'cancelling') await wait(() => cancelling?.waiting, 'the interrupted run was not cancelled');
    } else if (action === 'cancelReply') {
      const stopped = args[0] === 'true', pending = cancelling; cancelling = null;
      if (stopped) { agent.run = 'finished'; pending.open(); } else pending.refuse(Error('The run could not be cancelled'));
      await idle();
    } else if (action === 'dispatch') { const sent = posts.length; held.open(); held = null; await wait(() => posts.length === sent + 1, 'the change was not sent'); }
    else if (action === 'abortBeforeDispatch') {
      // The owner leaves before the journal write: the write is refused or released, and nothing is sent.
      const stop = held; app.leave(); opened = false; held = null; stop.open();
      await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(slot in storage, false, 'the unsent change was not released'); assert.equal(posts.length, 0);
    } else if (['serverApply', 'serverReplay', 'serverReject'].includes(action)) serve(action);
    else if (action === 'requestLost') wire = wire.slice(0, -1);
    else if (action === 'successReply') await answer(pending => pending.resolve(pending.reply));
    else if (action === 'rejectedReply') await answer(pending => { assert.equal(pending.reply, 'rejected'); pending.reject(new WorkflowLifecycleRejected()); });
    else if (action === 'unknownReply') await answer(pending => pending.reject(Error('offline')));
    else if (action === 'refresh') await open();
    else if (action === 'resendTap') { fd().del(); if (after.stage === 'resending') await wait(() => held?.waiting && held.stage === 'resending', 'the resend did not start'); }
    else if (action === 'resendDispatch') {
      const sent = posts.length, applied = agent.receipts.has(held.mutationId); held.open(); held = null;
      if (applied) await idle(); else await wait(() => posts.length === sent + 1, 'the change was not sent again');
    } else if (action === 'abortResend') { app.leave(); opened = false; held.refuse(Object.assign(Error('aborted'), {name: 'AbortError'})); held = null; await new Promise(resolve => setTimeout(resolve, 10)); }
    else if (action === 'remoteEdit') agent.edits++;
    // The model's tap guards read the run state itself. The phone reads it with the workflow, so each run event is followed by that read.
    else if (['runStarts', 'runFinishes', 'runInterrupted'].includes(action)) { agent.run = action === 'runStarts' ? 'ongoing' : action === 'runFinishes' ? 'finished' : 'interrupted'; if (opened && !fd().busy) await open(); }
    else if (action === 'back') { if (reviewing()) app.back(); }
    // The app stops: a new adapter is mounted over the same journal, and the earlier one is never answered.
    else if (action === 'restart') { app.restart(); call = null; held = null; cancelling = null; opened = false; }
    else assert.equal(action, '', `unmapped model action ${action}`);
  };
  const observe = () => {
    const stored = slot in storage ? JSON.parse(storage[slot]) : null, current = admitted.at(-1), copies = posts.filter(post => post.mutationId === current), last = posts.at(-1);
    const busy = opened ? fd().busy : false;
    return {agent: {removed: agent.removed, edits: agent.edits, applications: agent.applications, receipts: agent.receipts.size}, admissions: admitted.length,
      wire: wire.length, sent: Math.min(2, copies.length), resends: Math.min(2, copies.filter(post => post.resend).length),
      lastSent: last ? {edits: edits(last.versionId), remove: last.operation === 'remove', newest: last.mutationId === current} : null,
      intent: stored ? {edits: edits(stored.versionId), remove: stored.operation === 'remove', newest: stored.mutationId === current} : held?.stage === 'journal' ? {edits:edits(held.versionId),remove:held.operation==='remove',newest:held.mutationId===current} : null,
      busy, review: opened ? fd().lifecycleReview : false, unknownReview: opened ? fd().lifecycleLabel === 'Cancel runs' : false,
      offer: opened && ['Resend', 'Confirm resend'].includes(fd().deleteLabel), resendReview: opened && fd().deleteLabel === 'Confirm resend',
      knownRemoved: opened ? fd().deleteLabel === 'Restore workflow' : null};
  };
  return {apply, observe, close: () => app.close(), at: i => { index = i; }, opened: () => opened};
}

const project = (s, opened) => ({agent: {removed: s.removed, edits: s.version, applications: s.applications, receipts: s.receipts.length}, admissions: s.admissions,
  wire: s.wire, sent: s.sent, resends: s.resends,
  lastSent: s.wireId === 0 ? null : {edits: s.wireVersion, remove: s.wireRemove, newest: s.wireId === s.admissions},
  intent: s.intent ? {edits: s.intentVersion, remove: s.intentRemove, newest: true} : null,
  busy: opened ? s.busy : false, review: opened ? s.review : false, unknownReview: opened ? s.unknownReview : false,
  offer: opened ? s.offer : false, resendReview: opened ? s.resendReview : false, knownRemoved: opened ? s.knownRemoved : null});

async function replay(walk, label, seen) {
  const code = await subject(walk);
  try {
    const initialObservation=code.observe(),initialProjection=project(walk[0].state, true);
  assert.deepEqual(initialObservation,initialProjection,`${label} initial state`);
  recordComparedObservation({trace:label,step:0,actual:initialObservation,expected:initialProjection});observedTraces++;observedCheckpoints++;
    for (let i = 1; i < walk.length; i++) {
      const {action, state, args, rejected} = walk[i];
      code.at(i);
      if (rejected) {
        // A refused tap has nothing to act on: the phone shows no offer to resend, or blocks the change.
        const before = code.observe();
        if (action === 'resendTap') assert.equal(before.offer, false, label);
        else if (action === 'lifecycleTap') assert.ok(before.intent !== null || walk[i - 1].state.ongoing, label);
        else assert.equal(action, 'serverApply', label);
        const actual=code.observe(),expected=project(state,code.opened());assert.deepEqual(actual,expected);recordComparedObservation({trace:label,step:i,action:null,actual,expected});observedCheckpoints++;
        continue;
      }
      seen.note(action);
      await code.apply(action, state, args);
      const observed = code.observe(), expected = project(state, code.opened());
      assert.deepEqual(observed, expected, `${label} step ${i} ${action || 'stutter'}`);
      recordComparedObservation({trace:label,step:i,action,args,actual:observed,expected});observedCheckpoints++;
    }
  } finally { code.close(); }
}


export async function runWorkflowLifecycleChangeCase1(t, {canaries=true}={}) {
  const seen = actionCounter();
  for (const scenario of scenarios) await replay(modelScenario(model, scenario, {main}), scenario, seen);
  for (const action of ['lifecycleTap', 'cancelReply', 'dispatch', 'abortBeforeDispatch', 'serverApply', 'serverReplay', 'serverReject', 'requestLost', 'successReply', 'rejectedReply',
    'unknownReply', 'refresh', 'resendTap', 'resendDispatch', 'abortResend', 'remoteEdit', 'runStarts', 'runFinishes', 'runInterrupted', 'back', 'restart']) assert.ok(seen.count(action) > 0, action);
}

export async function runWorkflowLifecycleChangeReplay(){const beforeTraces=observedTraces,beforeCheckpoints=observedCheckpoints;await runWorkflowLifecycleChangeCase1(undefined,{canaries:false});return{traces:observedTraces-beforeTraces,checkpoints:observedCheckpoints-beforeCheckpoints};}
