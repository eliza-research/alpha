import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {checkTraces, qmap} from '../../refinement/check-traces.mjs';
import {bundleVendorCore, historicalCoreSource, root} from './source-support.mjs';

const model = 'CoreInteractiveTask';
const upstream = 'vendor/eliza/packages/core/tla/InteractiveTask';
const originalGraph = upstream+'.reducer.graph.json';
const inventory = 'specs/quint/legacy/core/source-inventory.json';
const pin = 'upstream.lock.json';
const ops = ['op1', 'op2'];
const origins = {A: 'https://a.example', B: 'https://b.example'};
const owner = {actorId: 'synthetic-actor', agentId: 'synthetic-agent',
  connector: {source: 'browser', accountId: 'synthetic-account'}};
const action = (name, ...args) => ({name, args});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => readFileSync(resolve(root, path));
const finished = new Set(['succeeded', 'failed', 'cancelled']);

function freeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const field of Object.values(value)) freeze(field);
  }
  return value;
}

function project(task) {
  const origin = task.observation?.origin;
  if (origin) assert.ok(Object.values(origins).includes(origin), 'Only the two synthetic origin classes enter the projection');
  const op = Object.fromEntries(ops.map(id => [id, task.operations.find(row => row.proposal.id === id)?.status ?? 'none']));
  return {auth: task.authorization.state, extended: task.originGrants !== undefined,
    obs: origin ? (origin === origins.A ? 'A' : 'B') : 'none', op,
    scopeB: task.allowedOrigins.includes(origins.B), status: task.status};
}

function driver(module, name) {
  let current = freeze(module.createInteractiveTask({
    id: 'synthetic-task', owner, goalRef: 'synthetic-goal', now: 1000,
    allowedCapabilities: ['click'], allowedOrigins: [origins.A],
    authorization: {decisionId: 'synthetic-grant', policyRevision: 'synthetic-policy',
      decidedAt: new Date(1000).toISOString(), state: 'active', revokedAt: null},
  }));
  let outcomesFinal = true, revocationFinal = true;
  const observe = () => {
    const state = project(current);
    return {s: {...state, op: qmap(Object.entries(state.op))},
      history: {outcomesFinal, revocationFinal}};
  };
  const trace = {name, expect: observe(), steps: []};
  function point(label, transition) {
    trace.steps.push({label, action: transition, expect: observe()});
  }
  function apply(transition, modelAction, {label = transition.type, expectedEpochDelta = 0, ...contextChanges} = {}) {
    const before = current;
    const context = freeze({owner, expectedRevision: before.revision, now: before.updatedAt+1, ...contextChanges});
    const {task, event} = module.transitionInteractiveTask(before, context, freeze(transition));
    assert.notEqual(task, before, 'The pure reducer returns a new task');
    assert.equal(task.revision, before.revision+1);
    assert.equal(task.epoch, before.epoch+expectedEpochDelta);
    assert.equal(task.updatedAt, Math.max(before.updatedAt, context.now));
    assert.deepEqual(
      [event.kind, event.taskId, event.sequence, event.epoch, event.at, event.status],
      [transition.type, task.id, task.revision, task.epoch, task.updatedAt, task.status],
      'Actual event envelope identifies exactly the returned state',
    );
    const id = transition.proposal?.id ?? transition.operationId;
    if (id) {
      assert.equal(event.operationId, id);
      assert.equal(event.operationStatus, task.operations.find(row => row.proposal.id === id)?.status);
    }
    outcomesFinal &&= before.operations.every(row => {
      const retained = task.operations.find(next => next.proposal.id === row.proposal.id);
      return Boolean(retained) && (!finished.has(row.status) || retained.status === row.status);
    });
    revocationFinal &&= before.authorization.state !== 'revoked' || task.authorization.state === 'revoked';
    current = freeze(task);
    point(label, modelAction);
    return {task, event};
  }
  function refuse(transition, code, {modelAction, label = transition.type, ...contextChanges} = {}) {
    const before = current;
    const context = freeze({owner, expectedRevision: before.revision, now: before.updatedAt+1, ...contextChanges});
    assert.throws(() => module.transitionInteractiveTask(before, context, freeze(transition)), error => error.code === code);
    assert.equal(current, before);
    point(label+' refused by '+code, modelAction ? {...modelAction, reject: true} : null);
  }
  function observation(origin = 'A', changes = {}) {
    const version = (current.observation?.version ?? 0)+1;
    return {id: 'view-'+version, pageId: 'synthetic-page', origin: origins[origin],
      version, inputRevision: 3, observedAt: current.updatedAt+1, ...changes};
  }
  function proposal(id, changes = {}) {
    const seen = current.observation;
    assert.ok(seen);
    return {id, taskId: current.id, epoch: current.epoch, observationId: seen.id,
      observationVersion: seen.version, inputRevision: seen.inputRevision, targetRef: 'synthetic-target',
      capability: 'click', authorizationId: current.authorization.decisionId,
      expiresAt: current.updatedAt+20, ...changes};
  }
  return {
    trace, apply, refuse, observation, proposal,
    get task() {return current;},
    see(origin = 'A', resume = false) {
      return apply({type: resume ? 'resume' : 'observe', observation: observation(origin)}, action('Observe', origin, resume));
    },
    prepare(id) {
      const prepared = proposal(id);
      apply({type: 'prepare', proposal: prepared}, action('Prepare', id));
      return prepared;
    },
    dispatch(id, context = {}) {return apply({type: 'dispatch', operationId: id}, action('Dispatch', id), context);},
    result(type, id, status, evidenceRef = status === 'unknown' ? undefined : 'synthetic-readback') {
      return apply({type, operationId: id, status, ...(evidenceRef ? {evidenceRef} : {})},
        action(type === 'result' ? 'Result' : 'Reconcile', id, status),
        {expectedEpochDelta: type === 'reconcile' && status !== 'unknown' ? 1 : 0});
    },
    interrupt(type, context = {}) {
      return apply({type}, action('Interrupt', type), {expectedEpochDelta: 1, ...context});
    },
  };
}

export async function checkInteractiveTaskTraces(extraSources = []) {
  const compiled = new Map();
  const bundle = await bundleVendorCore(undefined,
    'export {createInteractiveTask, transitionInteractiveTask} from "./packages/core/src/messaging/interactive-task.ts";',
    [fileURLToPath(import.meta.url), ...extraSources, pin, inventory, originalGraph,
      upstream+'.tla', upstream+'.reducer.cfg',
      'vendor/eliza/packages/core/test/interactive-task-conformance.test.ts',
      'vendor/eliza/packages/core/test/interactive-task-rebind.test.ts'],
    [{name: 'interactive-task-observed-source', setup(builder) {
      builder.onLoad({filter: /\.ts$/, namespace: 'file'}, ({path}) => {
        const contents = readFileSync(path);
        compiled.set(path, hash(contents));
        return {contents, loader: 'ts', resolveDir: dirname(path)};
      });
    }}]);
  assert.equal(bundle.revision, JSON.parse(read(pin)).commit);
  assert.ok(compiled.size > 0);
  for (const [path, digest] of compiled) assert.equal(bundle.driverHashes[path], digest, 'Compiled source must match its captured bytes');
  const archivedGraph = historicalCoreSource(originalGraph);
  const oldGraph = read(archivedGraph);
  const history = JSON.parse(read(inventory)).historicalArtifacts
    .find(entry => entry.path === 'packages/core/tla/InteractiveTask.reducer.graph.json');
  assert.equal(hash(oldGraph), history.sha256);
  assert.equal(bundle.driverHashes[archivedGraph], history.sha256);
  const module = bundle.instantiate({});
  const traces = [];

  {
    const f = driver(module, 'scope_withdrawal_requires_readback_and_fresh_resume');
    f.refuse({type: 'observe', observation: f.observation('B')}, 'TASK_SCOPE_CHANGED',
      {modelAction: action('Observe', 'B', false)});
    f.see();
    f.prepare('op1');
    const extended = f.apply({type: 'extend-origin', origin: origins.B, checkRef: 'synthetic-origin-review'},
      action('Extend'), {expectedEpochDelta: 1});
    assert.equal(extended.task.operations[0].status, 'cancelled');
    assert.equal(extended.event.origin, origins.B);
    f.refuse({type: 'dispatch', operationId: 'op1'}, 'TASK_REPLAY', {modelAction: action('Dispatch', 'op1')});
    f.see('B');
    f.prepare('op2');
    f.dispatch('op2');
    const retracted = f.apply({type: 'retract-origin', origin: origins.B}, action('Retract'), {expectedEpochDelta: 1});
    assert.ok(retracted.task.originGrants[0].retractedAt);
    f.refuse({type: 'result', operationId: 'op2', status: 'succeeded', evidenceRef: 'stale-result'}, 'TASK_REPLAY',
      {modelAction: action('Result', 'op2', 'succeeded')});
    f.refuse({type: 'resume', observation: f.observation()}, 'TASK_UNKNOWN_OUTCOME',
      {modelAction: action('Observe', 'A', true)});
    f.result('reconcile', 'op2', 'succeeded');
    f.see('A', true);
    f.apply({type: 'complete'}, action('Complete'), {expectedEpochDelta: 1});
    f.interrupt('revoke');
    f.interrupt('recover');
    f.refuse({type: 'observe', observation: f.observation()}, 'TASK_ENDED',
      {modelAction: action('Observe', 'A', false)});
    traces.push(f.trace);
  }
  {
    const f = driver(module, 'exact_owner_revision_observation_and_lease_fences');
    f.see();
    f.refuse({type: 'observe', observation: f.observation('A', {version: f.task.observation.version})}, 'TASK_STALE_OBSERVATION');
    f.refuse({type: 'pause'}, 'TASK_WRONG_OWNER', {owner: {...owner, actorId: 'another-actor'}});
    f.refuse({type: 'pause'}, 'TASK_CONFLICT', {expectedRevision: f.task.revision+1});
    const stale = [
      {epoch: f.task.epoch+1}, {observationId: 'other-view'}, {observationVersion: 9},
      {inputRevision: f.task.observation.inputRevision+1}, {taskId: 'other-task'},
    ];
    for (const fields of stale) {
      f.refuse({type: 'prepare', proposal: f.proposal('op1', fields)}, 'TASK_STALE_ACTION',
        {label: 'prepare with changed '+Object.keys(fields)[0]});
    }
    for (const fields of [{authorizationId: 'other-grant'}, {capability: 'other-capability'}]) {
      f.refuse({type: 'prepare', proposal: f.proposal('op1', fields)}, 'TASK_ACTION_DENIED',
        {label: 'prepare with changed '+Object.keys(fields)[0]});
    }
    const prepared = f.prepare('op1');
    f.refuse({type: 'dispatch', operationId: 'op1'}, 'TASK_STALE_ACTION', {now: prepared.expiresAt, label: 'dispatch at lease expiry'});
    f.dispatch('op1', {now: f.task.updatedAt-1, label: 'dispatch with a backwards wall clock clamps journal time'});
    f.refuse({type: 'result', operationId: 'op1', status: 'failed'}, 'TASK_INVALID', {label: 'terminal result without evidence'});
    f.result('result', 'op1', 'failed');
    f.refuse({type: 'prepare', proposal: f.proposal('op1')}, 'TASK_REPLAY', {modelAction: action('Prepare', 'op1')});
    traces.push(f.trace);
  }
  {
    const f = driver(module, 'unknown_stays_blocked_until_evidence_and_new_observation');
    f.see();
    f.prepare('op1');
    const stale = f.proposal('op2');
    f.dispatch('op1');
    f.refuse({type: 'rebind'}, 'TASK_NOT_ACTIVE');
    f.result('result', 'op1', 'unknown');
    f.refuse({type: 'complete'}, 'TASK_UNKNOWN_OUTCOME', {modelAction: action('Complete')});
    f.result('reconcile', 'op1', 'unknown');
    f.result('reconcile', 'op1', 'failed');
    f.see('A', true);
    f.refuse({type: 'prepare', proposal: stale}, 'TASK_STALE_ACTION', {label: 'proposal from the pre-reconciliation epoch'});
    f.prepare('op2');
    f.dispatch('op2');
    f.result('result', 'op2', 'succeeded');
    f.refuse({type: 'reconcile', operationId: 'op2', status: 'failed', evidenceRef: 'different-readback'}, 'TASK_REPLAY',
      {modelAction: action('Reconcile', 'op2', 'failed')});
    traces.push(f.trace);
  }
  {
    const f = driver(module, 'pause_recovery_and_cancel_preserve_uncertainty');
    f.see();
    f.prepare('op1');
    f.interrupt('pause', {now: f.task.updatedAt-1});
    f.see('A', true);
    f.prepare('op2');
    f.dispatch('op2');
    f.interrupt('recover');
    f.interrupt('cancel');
    f.interrupt('revoke');
    f.result('reconcile', 'op2', 'succeeded');
    assert.equal(f.task.status, 'cancelled');
    assert.equal(f.task.authorization.state, 'revoked');
    traces.push(f.trace);
  }
  let divergence;
  {
    const f = driver(module, 'trusted_rebind_adds_a_state_outside_original_graph');
    f.see();
    f.prepare('op1');
    const prior = project(f.task);
    traces.push({...f.trace, name: 'prepared_operation_before_trusted_rebind', steps: [...f.trace.steps]});
    const after = f.apply({type: 'rebind'}, null, {expectedEpochDelta: 1});
    assert.equal(after.event.kind, 'rebind');
    assert.equal(after.task.operations[0].status, 'cancelled');
    const graph = JSON.parse(oldGraph);
    assert.ok(graph.states.some(state => isDeepStrictEqual(state, prior)));
    assert.ok(!graph.states.some(state => isDeepStrictEqual(state, project(after.task))),
      'Current rebind state has no representation in the original exhaustive graph');
    divergence = f.trace;
  }

  const shared = {model, sources: bundle.sources, driverHashes: bundle.driverHashes, scope: 'bounded-component',
    assumptions: [
      'The actual pinned createInteractiveTask and transitionInteractiveTask execute against recursively frozen synthetic tasks, contexts and transitions.',
      'Two finite operation identities and two allowed-origin classes. Full original state and both prefix monitors are projected from actual source, with source-only checks on revision, epoch, event evidence, and wall-clock clamping.',
      'Detailed source fences absent from the original abstraction map to unchanged-state observations. Guards present in the original model are also checked as disabled actions. Storage, actuator and real browser effects are separate.',
    ]};
  const receipt = await checkTraces({...shared, traces});
  const id = model+'RebindDivergence';
  const out = 'test-results/quint-refinement/'+id+'.json';
  await assert.rejects(checkTraces({...shared, id, out, traces: [divergence]}), /Source\/model trace mismatch/);
  const mismatch = JSON.parse(readFileSync(resolve(root, out), 'utf8'));
  assert.equal(mismatch.results[0].kind, 'observation-mismatch');
  assert.ok(mismatch.driverInputsBound);
  return {receipts: [receipt], mismatch: {...mismatch, receiptPath: out}};
}
