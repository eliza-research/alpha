import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// npm test starts each .mjs without a TypeScript loader; mirror the workflow adapter's own tests.
if (!process.versions.bun && !process.execArgv.some(value => value === 'tsx' || value === '--import=tsx')) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', process.argv[1]], {stdio: 'inherit', timeout: 280000});
  if (child.error) throw child.error; process.exit(child.status ?? 1);
}
const {actionCounter, modelScenario, modelWalks} = await import('../specs/quint/refinement/services/inbox-workflows-model-traces.mjs');
const {workflowAdapter, intentSlot, wait} = await import('../specs/quint/refinement/services/workflow-adapter-fixture.mjs');

const model = 'specs/quint/services/ApprovalDecision.qnt', main = 'ApprovalDecision';
const scenarios = ['lostDecisionReplyReconciledTest', 'retainedDecisionBlocksAnotherTest', 'unrecordedDecisionReleasedAtFinishTest', 'changedRequestNeedsItsOwnDecisionTest',
  'staleDecisionRefusedTest', 'unreadChangeCannotBeDecidedTest', 'restartNeedsReceiptTest', 'closedReceiptCannotDecideTest', 'lateDecisionForReplacedRequestDroppedTest'];
const slot = intentSlot('flow', ':approval:run');

/** The real adapter over an engine that records a decision only for the request it lists as pending, on an open run. */
async function subject() {
  const engine = {digest: 1, status: 'pending', finished: false, cancelRequested: false, recorded: {1: 0, 2: 0}};
  const posts = [];
  let wire = null, call = null, opened = true;
  const workflow = {id: 'flow', name: 'Digest', description: 'Reads notes', versionId: 'v1', active: false, removed: false, steps: [{label: 'Read', description: 'Read notes'}]};
  const run = () => ({id: 'run', workflowId: 'flow', versionId: 'v1', status: 'waiting-approval', finished: engine.finished, startedAt: '2026-01-01T00:00:00.000Z', events: []});
  const receipt = () => ({runId: 'run', workflowId: 'flow', workflowVersionId: 'v1', finished: engine.finished, cancellationRequested: engine.cancelRequested,
    approvals: [{runId: 'run', workflowId: 'flow', workflowVersionId: 'v1', nodeId: 'node', iteration: 0, requestDigest: 'd' + engine.digest, status: engine.status, supported: true,
      title: 'request ' + engine.digest, summary: 'Send the digest', operation: 'send', target: 'owner', account: 'account'}]});
  const client = {lifecycleSupported: async () => true, supportsSubmissionReconciliation: async () => true, list: async () => [workflow], removedWorkflows: async () => [],
    detail: async () => workflow, executions: async () => [run()], receipt: async () => run(), approvals: async () => receipt(), phoneReview: async () => ({steps: []}),
    reconcile: async () => null, reconcileLifecycle: async () => null,
    decideApproval: (selected, approval, approved) => new Promise((resolve, reject) => {
      const post = {digest: Number(approval.requestDigest.slice(1)), approved, run: selected.id, node: approval.nodeId};
      posts.push(post); wire = post; call = {resolve, reject, reply: null};
    })};
  const app = await workflowAdapter({client});
  const idle = () => wait(() => app.render().runOpen && !app.render().fd.busy, 'the receipt did not open');
  const openReceipt = async () => {
    if (!app.render().detail) { app.render().openWorkflow('flow'); await wait(() => app.render().detail && !app.render().fd.busy, 'the workflow did not open'); }
    if (app.render().runOpen) app.render().r.ask(); else app.render().fd.runs[0].open();
    await idle();
  };
  await openReceipt();
  const apply = async (action, {before, after, args = []}) => {
    if (action === 'decideTap') {
      const approved = args[0] ? args[0] === 'true' : after.intent ? after.wireApproved : after.reviewApproved;
      const sent = posts.length, row = app.render().r.approvals[0];
      assert.equal(row.canDecide, true, 'the model decides on a request the phone does not offer');
      approved ? row.approve() : row.deny();
      if (after.intent) await wait(() => posts.length === sent + 1, 'the decision was not sent');
    } else if (action === 'requestLost') wire = null;
    else if (action === 'serverRecord') {
      const accepted = !engine.finished && !engine.cancelRequested && wire.digest === engine.digest && engine.status === 'pending';
      if (accepted) { engine.status = wire.approved ? 'approved' : 'denied'; engine.recorded[engine.digest]++; }
      if (call) call.reply = accepted ? receipt() : null;
      wire = null;
    } else if (action === 'successReply') { assert.ok(call?.reply, 'the model reports a recorded decision the engine did not record'); call.resolve(call.reply); call = null; await wait(() => !app.render().fd.busy); }
    else if (action === 'unknownReply') { call.reject(Error('offline')); call = null; await wait(() => !app.render().fd.busy); }
    else if (action === 'readReceipt') { await openReceipt(); opened = true; }
    else if (action === 'requestChanged') { engine.digest = 2; engine.status = 'pending'; }
    else if (action === 'finishRun') engine.finished = true;
    else if (action === 'cancelRun') engine.cancelRequested = true;
    // The app stops: a new adapter is mounted over the same journal, and the earlier one is never answered.
    else if (action === 'restart') { app.restart(); call = null; opened = false; }
    else assert.equal(action, '', `unmapped model action ${action}`);
  };
  const observe = () => {
    const stored = app.storage[slot] ? JSON.parse(app.storage[slot]) : null, view = app.render(), row = opened && view.runOpen ? view.r.approvals[0] : null;
    return {engine: {...engine, recorded: {...engine.recorded}}, wire: wire ? {digest: wire.digest, approved: wire.approved} : null,
      sent: {1: posts.filter(post => post.digest === 1).length, 2: posts.filter(post => post.digest === 2).length},
      intent: stored ? Number(stored.requestDigest.slice(1)) : 0, intentApproved: stored ? stored.approved : null,
      opened, busy: opened ? view.fd.busy : false,
      known: row ? {digest: Number(row.title.slice(-1)), status: ['approved', 'denied'].includes(row.status) ? row.status : 'pending'} : null,
      review: row ? (row.approveLabel === 'Confirm approve' ? 'approve' : row.denyLabel === 'Confirm deny' ? 'deny' : 'none') : 'none',
      canDecide: row ? row.canDecide : false};
  };
  return {apply, observe, close: () => app.close()};
}

const project = s => ({engine: {digest: s.digest, status: s.status, finished: s.finished, cancelRequested: s.cancelRequested, recorded: {1: s.recorded.get(1), 2: s.recorded.get(2)}},
  wire: s.wire ? {digest: s.wireDigest, approved: s.wireApproved} : null, sent: {1: s.sent.get(1), 2: s.sent.get(2)},
  intent: s.intent ? s.intentDigest : 0, intentApproved: s.intent ? s.wireApproved : null,
  opened: s.opened, busy: s.opened ? s.busy : false,
  known: s.opened ? {digest: s.knownDigest, status: s.knownStatus} : null,
  review: s.opened && s.reviewDigest !== 0 ? (s.reviewApproved ? 'approve' : 'deny') : 'none',
  canDecide: s.opened && !s.intent && !s.knownClosed && s.knownStatus === 'pending'});

async function replay(walk, label, seen) {
  const code = await subject();
  try {
  assert.deepEqual(code.observe(), project(walk[0].state), `${label} initial state`);
  for (let i = 1; i < walk.length; i++) {
    const {action, state, args, rejected} = walk[i], before = walk[i - 1].state;
    if (rejected) { assert.equal(action, 'decideTap'); assert.equal(code.observe().canDecide, false, `${label}: the phone offers a decision the model refuses`); continue; }
    seen.note(action);
    await code.apply(action, {before, after: state, args});
    assert.deepEqual(code.observe(), project(state), `${label} step ${i} ${action || 'stutter'}`);
  }
  } finally { code.close(); }
}

test('the real workflow adapter follows every step of the approval model scenarios', {timeout: 120000}, async () => {
  const seen = actionCounter();
  for (const scenario of scenarios) await replay(modelScenario(model, scenario, {main}), scenario, seen);
  for (const action of ['decideTap', 'requestLost', 'serverRecord', 'successReply', 'unknownReply', 'readReceipt', 'requestChanged', 'finishRun', 'cancelRun', 'restart']) assert.ok(seen.count(action) > 0, action);
});

test('the real workflow adapter follows random approval model walks step by step', {timeout: 240000}, async () => {
  const seen = actionCounter(), walks = modelWalks(model, {main, traces: 150, steps: 40});
  assert.equal(walks.length, 150);
  for (const [index, walk] of walks.entries()) await replay(walk.map(step => ({...step, rejected: false})), `walk ${index}`, seen);
  // A recorded decision answered before the app stops is rare in a random walk; the scenarios above replay it.
  for (const action of ['decideTap', 'requestLost', 'serverRecord', 'unknownReply', 'readReceipt', 'requestChanged', 'finishRun', 'cancelRun', 'restart']) assert.ok(seen.count(action) > 0, `${action} ${JSON.stringify(seen.all())}`);
});
