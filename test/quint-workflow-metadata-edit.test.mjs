import test from 'node:test';
import assert from 'node:assert/strict';
const {actionCounter, modelScenario, modelWalks} = await import('../specs/quint/refinement/services/inbox-workflows-model-traces.mjs');
const {workflowAdapter, intentSlot, wait} = await import('../specs/quint/refinement/services/workflow-adapter-fixture.mjs');
const {WorkflowMetadataRejected} = await import('../apps/app/src/runtime/workflow-protocol.ts');

const model = 'specs/quint/services/WorkflowMetadataEdit.qnt', main = 'WorkflowMetadataEdit';
const scenarios = ['savedNameTest', 'lostReplyReconciledTest', 'changedVersionReleasesTest', 'refusedEditReleasesTest', 'neverSentStaysLockedTest',
  'retainedBlocksSaveTest', 'leaveBeforeDispatchReleasesTest', 'leaveAfterDispatchRetainsTest'];
const slot = intentSlot('flow', ':metadata');
const aborted = () => Object.assign(Error('aborted'), {name: 'AbortError'});

/**
 * The real adapter over an agent that applies one metadata change at most once, for the version it
 * names. A change stops where the model has a step: before its journal write lands (only when the
 * walk leaves the editor at that point), before it is sent, and on its way to and from the agent.
 */
async function subject(walk, rewrite) {
  const agent = {version: 0, name: 0, receipts: new Map(), applications: 0};
  const workflow = () => ({id: 'flow', name: 'name ' + agent.name, description: 'Reads notes', versionId: 'v' + agent.version, active: false, removed: false, steps: [{label: 'Read', description: 'Read notes'}]});
  const posts = [], admitted = [];
  let wire = null, call = null, held = null, opened = true, index = 0, serial = 0;
  const leavesBeforeDispatch = () => walk.slice(index + 1).find(step => ['dispatch', 'back', 'restart'].includes(step.action))?.action === 'back';
  const client = {lifecycleSupported: async () => true, supportsSubmissionReconciliation: async () => true, metadataSupported: async () => true,
    list: async () => [workflow()], removedWorkflows: async () => [], detail: async () => workflow(), executions: async () => [], approvals: async () => null,
    phoneReview: async () => ({steps: []}), reconcile: async () => null, reconcileLifecycle: async () => null,
    reconcileMetadata: async (_id, _version, mutationId) => agent.receipts.get(mutationId) ?? null,
    changeMetadata: async (_id, versionId, name, _description, signal, admit) => {
      const mutationId = `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
      const stop = held = {stage: leavesBeforeDispatch() ? 'journal' : 'admitted', waiting: false};
      stop.reached = new Promise(resolve => { stop.open = resolve; });
      admitted.push(mutationId);
      if (stop.stage === 'journal') { stop.waiting = true; await stop.reached; await admit(mutationId); throw Error('The adapter went on to send a change its owner had left'); }
      await admit(mutationId); stop.waiting = true; await stop.reached;
      return new Promise((resolve, reject) => {
        posts.push({mutationId, versionId, name}); wire = {mutationId, versionId, name: admitted.length};
        call = {resolve, reject, reply: null};
        signal.addEventListener('abort', () => reject(aborted()), {once: true});
      });
    }};
  const storage = {};
  const app = await workflowAdapter({client, storage, rewrite});
  const fd = () => app.render().fd;
  const idle = () => wait(() => app.render().detail && !fd().busy, 'the workflow did not settle');
  const open = async () => { app.render().openWorkflow('flow'); await idle(); opened = true; };
  await open();
  const editor = () => opened && app.render().builder ? app.render().b : null;
  const answer = async settle => { const pending = call; call = null; settle(pending); await idle(); };
  const apply = async (action, after) => {
    if (action === 'editTap') { fd().edit(); await wait(() => editor(), 'the editor did not open'); }
    else if (action === 'saveTap') {
      const form = editor();
      assert.equal(form.saveOff, false, 'the phone does not offer Save');
      form.onName({target: {value: 'name ' + after.admissions}});
      editor().save();
      await wait(() => held?.waiting, 'the change was not recorded');
    } else if (action === 'dispatch') { const sent = posts.length; held.open(); held = null; await wait(() => posts.length === sent + 1, 'the change was not sent'); }
    else if (action === 'serverApply' || action === 'serverReject') {
      const verdict = agent.receipts.has(wire.mutationId) ? 'serverReplay' : wire.versionId !== 'v' + agent.version ? 'serverReject' : 'serverApply';
      assert.equal(verdict, action, 'the agent and the model disagree on what becomes of this request');
      if (verdict === 'serverApply') { agent.version++; agent.name = wire.name; agent.applications++; agent.receipts.set(wire.mutationId, {mutationId: wire.mutationId, versionId: 'v' + agent.version}); }
      if (call) call.reply = verdict === 'serverReject' ? 'rejected' : agent.receipts.get(wire.mutationId);
      wire = null;
    } else if (action === 'requestLost') wire = null;
    else if (action === 'successReply') await answer(pending => pending.resolve(pending.reply));
    else if (action === 'rejectedReply') await answer(pending => { assert.equal(pending.reply, 'rejected'); pending.reject(new WorkflowMetadataRejected()); });
    else if (action === 'unknownReply') await answer(pending => pending.reject(Error('offline')));
    else if (action === 'refresh') await open();
    else if (action === 'back') {
      const stop = held; held = null; call = null;
      assert.equal(app.back(), true, 'the editor did not take the back step');
      stop?.open();
      await new Promise(resolve => setTimeout(resolve, 20));
      await idle();
    } else if (action === 'remoteEdit') agent.version++;
    // The app stops: a new adapter is mounted over the same journal, and the earlier one is never answered.
    else if (action === 'restart') { app.restart(); call = null; held = null; opened = false; }
    else assert.equal(action, '', `unmapped model action ${action}`);
  };
  const observe = () => {
    const stored = slot in storage ? JSON.parse(storage[slot]) : null, current = admitted.at(-1), last = posts.at(-1);
    const busy = opened ? fd().busy : false, form = editor();
    return {agent: {version: agent.version, name: agent.name, applications: agent.applications, receipts: agent.receipts.size}, admissions: admitted.length,
      wire: wire ? 1 : 0, sent: posts.filter(post => post.mutationId === current).length,
      lastSent: last ? {version: last.versionId, name: last.name, newest: last.mutationId === current} : null,
      intent: stored ? {version: stored.versionId, newest: stored.mutationId === current} : held?.stage === 'journal' ? 'recording' : null,
      opened, busy, editor: !!form, locked: form ? form.unknown : null,
      known: opened && !busy ? {name: app.render().detail ? fd().name : null} : null};
  };
  return {apply, observe, close: () => app.close(), at: i => { index = i; }};
}

const project = s => ({agent: {version: s.version, name: s.name, applications: s.applications, receipts: s.receipts.length}, admissions: s.admissions,
  wire: s.wire, sent: s.sent,
  lastSent: s.wireId === 0 ? null : {version: 'v' + s.wireVersion, name: 'name ' + s.wireId, newest: s.wireId === s.admissions},
  intent: s.intent ? {version: 'v' + s.intentVersion, newest: true} : null,
  opened: s.opened, busy: s.opened ? s.busy : false, editor: s.editor, locked: s.editor ? s.intent : null,
  known: s.opened && !s.busy ? {name: 'name ' + s.knownName} : null});

async function replay(walk, label, seen, rewrite) {
  const code = await subject(walk, rewrite);
  try {
    assert.deepEqual(code.observe(), project(walk[0].state), `${label} initial state`);
    for (let i = 1; i < walk.length; i++) {
      const {action, state, rejected} = walk[i];
      code.at(i);
      if (rejected) {
        // A retained change keeps the editor shut and Save disabled.
        const before = code.observe();
        assert.ok(['editTap', 'saveTap'].includes(action), label);
        assert.notEqual(before.intent, null, label);
        if (action === 'saveTap') assert.equal(before.locked, true, label);
        continue;
      }
      seen.note(action);
      await code.apply(action, state);
      const observed = code.observe(), expected = project(state);
      // While the journal write of a change the owner is about to leave is in flight, the entry is being recorded.
      if (observed.intent === 'recording') { observed.intent = expected.intent; observed.locked = expected.locked; }
      assert.deepEqual(observed, expected, `${label} step ${i} ${action || 'stutter'}`);
    }
  } finally { code.close(); }
}
const actions = ['editTap', 'saveTap', 'dispatch', 'serverApply', 'serverReject', 'requestLost', 'successReply', 'rejectedReply', 'unknownReply', 'refresh', 'back', 'remoteEdit', 'restart'];

test('the real workflow adapter follows every step of the metadata edit model scenarios', {timeout: 240000}, async () => {
  const seen = actionCounter();
  for (const scenario of scenarios) await replay(modelScenario(model, scenario, {main}), scenario, seen);
  for (const action of actions) assert.ok(seen.count(action) > 0, action);
});

test('the real workflow adapter follows random metadata edit model walks step by step', {timeout: 280000}, async () => {
  const seen = actionCounter(), walks = modelWalks(model, {main, traces: 200, steps: 40});
  assert.equal(walks.length, 200);
  for (const [index, walk] of walks.entries()) await replay(walk.map(step => ({...step, rejected: false})), `walk ${index}`, seen);
  // Restart and refresh are always enabled, so a random walk seldom carries one change to its reply; the scenarios above replay those steps.
  for (const action of ['editTap', 'saveTap', 'dispatch', 'requestLost', 'unknownReply', 'refresh', 'back', 'remoteEdit', 'restart']) assert.ok(seen.count(action) > 0, `${action} ${JSON.stringify(seen.all())}`);
});

test('the metadata edit replay rejects an adapter that keeps a change the agent can no longer apply', {timeout: 120000}, async () => {
  const kept = source => source.replace("if(before.versionId!==intent.versionId){await intents.acknowledge(metaKey,pendingMetadata,signal);", "if(before.versionId!==intent.versionId){");
  await assert.rejects(replay(modelScenario(model, 'changedVersionReleasesTest', {main}), 'changedVersionReleasesTest', actionCounter(), kept), /changedVersionReleasesTest step \d+ refresh/);
});
