import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../../check-traces.mjs';
import {action, until} from '../support.mjs';
import {serviceInputs} from '../source-inputs.mjs';
import {createEngineFixture, engineDriverSources, prepareEngineModule} from './ports.mjs';

const owner = value => value === 'owner-A' ? 1 : value === 'owner-B' ? 2 : 0;
const version = value => value === 'version-1' ? 1 : value === 'version-2' ? 2 : 0;
const reject = (name, ...args) => ({...action(name, ...args), reject: true});

async function snapshot(fixture) {
  const rows = await fixture.rows();
  const definition = rows.workflows.find(row => row.id === 'workflow-A' && row.agentId === 'agent-A');
  const runs = rows.executions.filter(row => row.id !== fixture.otherId && row.agentId === 'agent-A');
  assert.ok(runs.length <= 1, 'one bound idempotency identity admits at most one run');
  const run = runs[0];
  const receipt = rows.submissions.find(row => row.runId === run?.id);
  const canonical = run ? (await fixture.service.approvalReceipts(run.id)).approvals[0] : undefined;
  const execution = run?.execution;
  return {
    's.version': version(definition.versionId), 's.active': definition.workflow.active,
    's.removed': !!definition.workflow.metadata.elizaPhoneRemovedAt,
    's.otherActive': rows.executions.some(row => row.id === fixture.otherId && !row.finished),
    's.runs': runs.length, 's.receipt': !!receipt, 's.owner': owner(receipt?.ownerId),
    's.payload': receipt?.input.data ?? 0, 's.runVersion': version(execution?.workflowVersionId),
    's.mode': run?.mode ?? 'none', 's.status': run?.status ?? 'none',
    's.finished': run?.finished ?? false, 's.workerActive': fixture.pending.some(item => item.input.runId === run?.id),
    's.workerStarts': fixture.calls.filter(item => item.runId === run?.id).length,
    's.cancelRequested': !!execution?.cancellationRequestedAt,
    's.reconciliation': execution?.reconciliation?.state ?? 'none',
    's.approval': canonical?.status ?? 'none', 's.supported': canonical?.supported ?? false,
    's.digest': canonical ? (canonical.requestDigest === 'digest-A' ? 1 : 2) : 0,
    's.decisionOwner': owner(canonical?.decidedBy),
    's.recordedApproval': execution?.approvals?.[0]?.status ?? 'none',
    's.controls': fixture.controls.filter(item => item.runId === run?.id).length,
  };
}

async function start(fixture, options = {}) {
  const result = await fixture.service.startReviewedWorkflow('workflow-A', 'submission-A', options.version ?? 'version-1',
    {data: options.payload ?? 1}, options.owner ?? 'owner-A', options.authorize ?? (() => {}));
  return result;
}
async function running(fixture, count = 1) {
  await until(() => fixture.calls.length === count, 'actual worker entry');
}
async function approval(fixture, {supported = true, digest = 'digest-A'} = {}) {
  const input = fixture.pending[0].input;
  fixture.approvals.set(input.runId, [{runId: input.runId, workflowId: 'workflow-A', workflowVersionId: 'version-1',
    nodeId: 'node-A', iteration: 0, requestDigest: digest, status: 'pending', title: 'Review',
    summary: 'Send reviewed content', operation: 'send', target: 'target-A', account: 'account-A', supported}]);
  await input.onEvent({sequence: 1, type: 'ApprovalRequested', nodeId: 'node-A', iteration: 0,
    timestamp: new Date().toISOString(), payload: {summary: 'Send reviewed content'}});
}
function decide(fixture, {approved = true, ownerId = 'owner-A', versionId = 'version-1', digest = 'digest-A'} = {}) {
  return fixture.service.decideReviewedApproval(fixture.calls[0].runId, 'node-A', 0, approved, versionId, digest, ownerId);
}
function commitDecision(fixture, input) {
  const receipt = fixture.approvals.get(input.runId)[0];
  receipt.status = input.kind === 'approve' ? 'approved' : 'denied';
  receipt.decidedBy = input.decidedBy;
  receipt.decidedAt = new Date().toISOString();
}
async function definition(fixture, {versionId = 'version-1', active = true, removed = false} = {}) {
  const rows = await fixture.rows();
  const previous = rows.workflows.find(row => row.id === 'workflow-A');
  const workflow = {...previous.workflow, active, metadata: {...previous.workflow.metadata}};
  if (removed) workflow.metadata.elizaPhoneRemovedAt = new Date().toISOString();
  else delete workflow.metadata.elizaPhoneRemovedAt;
  await fixture.database.query('UPDATE workflow.embedded_workflows SET workflow=$1,active=$2,version_id=$3 WHERE id=$4',
    [JSON.stringify(workflow), active, versionId, 'workflow-A']);
}

export async function collectWorkflowEngineTraces() {
  const traces = [];
  async function scenario(name, callback, {active = true, removed = false, typed, other = false} = {}) {
    const fixture = await createEngineFixture();
    try {
      let metadata = {}, source;
      if (typed) {
        const time = new Date(typed.scheduledAt);
        const spec = {version: 1, name: 'Scheduled fixture', description: '', trigger: {kind: 'time',
          localTime: time.toISOString().slice(11, 16), timeZone: 'UTC', days: [time.getUTCDay()]},
          steps: [{id: 'input-A', kind: 'Read', operation: 'supplied_text', text: 'fixture'}]};
        const compiled = fixture.phone.phoneDraftDefinition(spec);
        metadata = compiled.metadata;
        source = compiled.source;
      }
      if (removed) metadata.elizaPhoneRemovedAt = new Date().toISOString();
      await fixture.seed({active, metadata, source});
      if (other) {
        fixture.otherId = 'other-run';
        const now = new Date().toISOString();
        const existing = {id: fixture.otherId, workflowId: 'workflow-A', workflowVersionId: 'version-1', mode: 'manual', status: 'waiting-approval',
          finished: false, input: {}, approvals: [], events: [], startedAt: now};
        await fixture.db.insert(fixture.schema.embeddedExecutions).values({agentId: 'agent-A', id: fixture.otherId, workflowId: 'workflow-A',
          mode: existing.mode, status: existing.status, finished: false, startedAt: now, execution: existing});
      }
      const trace = {name, init: action('initFor', active, removed, other), expect: await snapshot(fixture), steps: []};
      const checkpoint = async (label, transition) => trace.steps.push({label, action: transition, expect: await snapshot(fixture)});
      await callback(fixture, checkpoint);
      traces.push(trace);
    } finally { await fixture.close(); }
  }

  await scenario('concurrent exact manual retries share one durable run and one process', async (f, point) => {
    const [first, second] = await Promise.all([start(f), start(f)]);
    assert.equal(first.id, second.id);
    await running(f);
    await point('two concurrent callers observe the same SQL admission', [action('admitManual', 1, 1, 1), action('enterWorker')]);
    await start(f);
    await point('durable duplicate while process is active', action('replayManual', 1, 1, 1));
    await f.settle();
    await point('worker result committed', action('workerResult', 'finished'));
    await start(f);
    await point('terminal duplicate remains the same execution', action('replayManual', 1, 1, 1));
    await f.calls[0].onEvent({sequence: 99, type: 'Trace', timestamp: new Date().toISOString(), payload: {late: true}});
    await point('late process event cannot resurrect terminal SQL row', action('lateTerminalEvent'));
  });
  await scenario('bound submission rejects changed owner input and version but tolerates later definition', async (f, point) => {
    await start(f); await running(f);
    await point('original request', [action('admitManual', 1, 1, 1), action('enterWorker')]);
    for (const [options, args, status] of [[{owner: 'owner-B'}, [2, 1, 1], 404], [{payload: 2}, [1, 2, 1], 409], [{version: 'version-2'}, [1, 1, 2], 409]]) {
      await assert.rejects(start(f, options), error => error.statusCode === status);
      await point('mismatched request rejected without another process', reject('replayManual', ...args));
    }
    await definition(f, {versionId: 'version-2'});
    await point('new definition does not rewrite admitted version', action('definition', 2, true, false));
    await start(f);
    await point('exact original identity still reconciles', action('replayManual', 1, 1, 1));
  });
  await scenario('new admission rejects stale version and failed authorization', async (f, point) => {
    await definition(f, {versionId: 'version-2'});
    await point('definition changes before admission', action('definition', 2, true, false));
    await assert.rejects(start(f), error => error.statusCode === 409 && error.response.code === 'WORKFLOW_VERSION_NOT_ADMITTED');
    await point('stale reviewed version has no durable effects', reject('admitManual', 1, 1, 1));
    await assert.rejects(start(f, {version: 'version-2', authorize: () => { throw Error('Authorization rejected'); }}), /Authorization rejected/);
    await point('caller authorization failure rolls back admission', null);
    await start(f, {version: 'version-2'}); await running(f);
    await point('fresh authorized version is admitted', [action('admitManual', 1, 1, 2), action('enterWorker')]);
  });
  await scenario('paused manual start is allowed while trigger admission is disabled', async (f, point) => {
    await assert.rejects(f.service.startWorkflow('workflow-A', {mode: 'trigger'}), error => error.statusCode === 409);
    await point('paused schedule refused', reject('admitScheduled', 'ready'));
    await start(f); await running(f);
    await point('explicit reviewed manual request remains allowed', [action('admitManual', 1, 1, 1), action('enterWorker')]);
  }, {active: false});
  await scenario('removed definition denies new manual and scheduled admission', async (f, point) => {
    await assert.rejects(start(f), error => error.statusCode === 409);
    await point('removed manual denied', reject('admitManual', 1, 1, 1));
    await assert.rejects(f.service.startWorkflow('workflow-A', {mode: 'trigger'}), error => error.statusCode === 409);
    await point('removed schedule denied', reject('admitScheduled', 'ready'));
  }, {removed: true});
  await scenario('transaction rollback leaves neither run nor receipt then retries normally', async (f, point) => {
    f.faultNextTransaction('before-commit');
    await assert.rejects(start(f), /Injected rollback/);
    await point('both inserts rolled back', null);
    await start(f); await running(f);
    await point('retry after known rollback admits once', [action('admitManual', 1, 1, 1), action('enterWorker')]);
  });
  await scenario('lost postcommit reply recovers queued SQL state on real service restart', async (f, point) => {
    f.faultNextTransaction('after-commit');
    await assert.rejects(start(f), /Injected lost response/);
    await point('both inserts survived but worker was not launched', action('admitManual', 1, 1, 1));
    await f.restart(); await running(f);
    await point('new service recovers durable queued run', [action('restart'), action('enterWorker')]);
    await start(f);
    await point('original submission reconciles after restart', action('replayManual', 1, 1, 1));
  });
  for (const nativeStatus of ['cancelled', null]) {
    await scenario(`cancel waits for worker teardown and repeats durable receipt (${nativeStatus})`, async (f, point) => {
      await start(f); await running(f);
      await point('admitted worker', [action('admitManual', 1, 1, 1), action('enterWorker')]);
      f.controlWith(async () => ({status: nativeStatus}));
      const cancellation = f.service.cancelExecutionWithReceipt(f.calls[0].runId);
      await untilExecution(f, row => !!row.execution.cancellationRequestedAt);
      await point('request persists before waiting on process', action('requestCancel'));
      await f.settle('cancelled'); const first = await cancellation;
      assert.equal(first.request.replayed, false);
      await point('native cancellation readback settles after teardown', [action('workerResult', 'cancelled'), action('cancelReceipt', nativeStatus ?? 'none')]);
      const second = await f.service.cancelExecutionWithReceipt(f.calls[0].runId);
      assert.equal(second.request.replayed, true);
      assert.equal(first.request.requestedAt, second.request.requestedAt);
      await point('retry retains the original request identity', action('cancelReceipt', nativeStatus ?? 'none'));
    });
  }
  await scenario('captured successful result wins a concurrent cancellation request', async (f, point) => {
    await start(f); await running(f); await point('running', [action('admitManual', 1, 1, 1), action('enterWorker')]);
    const cancellation = f.service.cancelExecutionWithReceipt(f.calls[0].runId);
    await untilExecution(f, row => !!row.execution.cancellationRequestedAt);
    await point('durable cancel precedes successful result', action('requestCancel'));
    await f.settle('finished'); const result = await cancellation;
    assert.equal(result.execution.status, 'finished');
    await point('actual terminal output remains authoritative', [action('workerResult', 'finished'), action('cancelReceipt', 'cancelled')]);
  });
  await scenario('native terminal without captured result fails closed after provisional cancellation', async (f, point) => {
    await start(f); await running(f); await point('running', [action('admitManual', 1, 1, 1), action('enterWorker')]);
    f.controlWith(async () => ({status: 'finished'}));
    const cancelled = f.service.cancelExecutionWithReceipt(f.calls[0].runId);
    const rejected = assert.rejects(cancelled, error => error.statusCode === 409 && error.response.code === 'WORKFLOW_TERMINAL_RESULT_UNAVAILABLE');
    await untilExecution(f, row => !!row.execution.cancellationRequestedAt);
    await point('request persisted', action('requestCancel'));
    await f.settle('cancelled'); await rejected;
    await point('unavailable native result cannot masquerade as completed output', [action('workerResult', 'cancelled'), action('cancelReceipt', 'finished')]);
  });
  await scenario('unknown process outcome stays unfinished and retries same execution on restart', async (f, point) => {
    await start(f); await running(f); await point('running', [action('admitManual', 1, 1, 1), action('enterWorker')]);
    await f.settle(undefined, 'WORKFLOW_WORKER_OUTCOME_UNKNOWN');
    await point('unknown outcome retained for reconciliation', action('workerUnknown'));
    await f.restart(); await running(f, 2);
    await point('same durable identity resumed by new service', [action('restart'), action('enterWorker')]);
    await f.settle(); await point('resumed result persists', action('workerResult', 'finished'));
  });
  await scenario('restart refuses a run whose immutable version cannot be recovered', async (f, point) => {
    f.faultNextTransaction('after-commit'); await assert.rejects(start(f), /Injected lost response/);
    await point('queued admitted version', action('admitManual', 1, 1, 1));
    await definition(f, {versionId: 'version-2'}); await point('current source changed without old revision', action('definition', 2, true, false));
    await f.restart(); await point('unrecoverable version is explicit failed run', [action('restart'), action('resumeUnavailable')]);
  });

  async function approvalScenario(name, callback, options = {}) {
    await scenario(name, async (f, point) => {
      await start(f); await running(f); await point('running', [action('admitManual', 1, 1, 1), action('enterWorker')]);
      await approval(f, options); await point('actual event persists approval projection', action('requestApproval', options.supported !== false, 1));
      await f.settle('waiting-approval'); await point('process parks for approval', action('workerResult', 'waiting-approval'));
      await callback(f, point);
    });
  }
  for (const lostReply of [false, true]) {
    await approvalScenario(`canonical committed approval accepted even when control reply is lost (${lostReply})`, async (f, point) => {
      f.controlWith(async input => { commitDecision(f, input); if (lostReply) throw Error('lost control reply'); return {status: null}; });
      await decide(f); await running(f, 2);
      await point('canonical digest owner decision checked before resume', [action('decide', true, 1, 1, 1), action('enterWorker')]);
      await decide(f); await point('same owner replays canonical decision without another command', action('replayDecision', true, 1, 1, 1));
      await f.settle(); await point('approved run finishes', action('workerResult', 'finished'));
    });
  }
  await approvalScenario('uncommitted control failure retries only after canonical readback', async (f, point) => {
    f.controlWith(async () => { throw Error('control unavailable'); });
    await assert.rejects(decide(f), /control unavailable/);
    await point('failed command retains pending canonical and SQL projection', action('decisionUnconfirmed', true, 1, false));
    f.controlWith(async input => { commitDecision(f, input); return {status: null}; });
    await decide(f); await running(f, 2);
    await point('later confirmed decision admits resume', [action('decide', true, 1, 1, 1), action('enterWorker')]);
  });
  await approvalScenario('committed decision with unreadable immediate receipt remains canonical on replay', async (f, point) => {
    const read = f.ports.readApprovals;
    let unavailable = false;
    f.ports.readApprovals = async (...args) => { if (unavailable) { unavailable = false; throw Error('receipt unavailable'); } return read(...args); };
    f.controlWith(async input => { commitDecision(f, input); unavailable = true; return {status: null}; });
    await assert.rejects(decide(f), /receipt unavailable/);
    await point('SQL update rolls back while process decision remains committed', action('decisionUnconfirmed', true, 1, true));
    await decide(f); await running(f, 2);
    await point('canonical replay does not issue another decision or repair stale projection', [action('replayDecision', true, 1, 1, 1), action('enterWorker')]);
  });
  await approvalScenario('unsupported approval can be denied but cannot be approved', async (f, point) => {
    await assert.rejects(decide(f), error => error.statusCode === 422);
    await point('unsupported fields prevent approval command', reject('decide', true, 1, 1, 1));
    f.controlWith(async input => { commitDecision(f, input); return {status: null}; });
    await decide(f, {approved: false}); await running(f, 2);
    await point('explicit denial remains available', [action('decide', false, 1, 1, 1), action('enterWorker')]);
  }, {supported: false});
  await approvalScenario('changed digest version and other owner decision cannot reuse stale review', async (f, point) => {
    await assert.rejects(decide(f, {versionId: 'version-2'}), error => error.statusCode === 409);
    await point('version-bound decision rejected', reject('decide', true, 1, 2, 1));
    f.approvals.get(f.calls[0].runId)[0].requestDigest = 'digest-B';
    await point('canonical request replaced while review was open', action('replaceRequest', 2));
    await assert.rejects(decide(f), error => error.statusCode === 409);
    await point('old digest rejected', reject('decide', true, 1, 1, 1));
    commitDecision(f, {runId: f.calls[0].runId, kind: 'approve', decidedBy: 'owner-B'});
    await point('independent owner committed the canonical decision', action('canonicalDecision', true, 2));
    await assert.rejects(decide(f, {digest: 'digest-B'}), error => error.statusCode === 409);
    await point('replay by another owner rejected', reject('replayDecision', true, 1, 1, 2));
  });
  await approvalScenario('cancellation bars pending review admission', async (f, point) => {
    const result = await f.service.cancelExecutionWithReceipt(f.calls[0].runId);
    assert.equal(result.execution.status, 'cancelled');
    await point('parked run cancelled', [action('requestCancel'), action('cancelReceipt', 'cancelled')]);
    await assert.rejects(decide(f), error => error.statusCode === 409);
    await point('pending approval cannot resume cancelled run', reject('decide', true, 1, 1, 1));
  });

  const minute = Math.floor(Date.now() / 60000) * 60000;
  for (const [name, scheduledAt, other, disposition] of [
    ['ready occurrence', minute, false, 'ready'], ['missed occurrence', minute - 7200000, false, 'missed'],
    ['overlap occurrence', minute, true, 'overlap'],
  ]) {
    await scenario(`typed ${name} uses actual compiler and clock admission`, async (f, point) => {
      const options = {mode: 'trigger', triggerData: {scheduledAtMs: scheduledAt, workflowVersionId: 'version-1'}};
      const first = await f.service.startWorkflow('workflow-A', options);
      if (disposition === 'ready') await running(f);
      await point('typed occurrence classified and persisted', disposition === 'ready'
        ? [action('admitScheduled', disposition), action('enterWorker')] : action('admitScheduled', disposition));
      const second = await f.service.startWorkflow('workflow-A', options);
      assert.equal(first.id, second.id);
      await point('exact occurrence replays one durable row', action('replayScheduled'));
    }, {typed: {scheduledAt}, other});
  }
  await scenario('dispatch layer shares inflight promise and durable retry after restart', async (f, point) => {
    const dispatcher = f.createWorkflowDispatchService(f.runtime);
    const first = dispatcher.execute('workflow-A', {}, {idempotencyKey: 'event-A'});
    const second = dispatcher.execute('workflow-A', {}, {idempotencyKey: 'event-A'});
    await running(f);
    await point('two trigger dispatches admit one worker', [action('admitScheduled', 'ready'), action('enterWorker')]);
    await f.settle(); const [a, b] = await Promise.all([first, second]);
    assert.equal(a.executionId, b.executionId); assert.equal(b.dedup, true);
    await point('one shared terminal result', action('workerResult', 'finished'));
    await f.restart(); const retry = await f.createWorkflowDispatchService(f.runtime).execute('workflow-A', {}, {idempotencyKey: 'event-A'});
    assert.equal(retry.executionId, a.executionId); assert.equal(retry.dedup, true);
    await point('new dispatcher reads durable idempotency result', [action('restart'), action('replayScheduled')]);
  });
  return traces;
}

async function untilExecution(fixture, predicate) {
  const deadline = performance.now() + 10000;
  while (!(await fixture.rows()).executions.some(predicate)) {
    assert.ok(performance.now() < deadline, 'Timed out waiting for durable execution transition');
    await new Promise(resolve => setImmediate(resolve));
  }
}

export async function runWorkflowEngineRefinement(extraSources = []) {
  const discovered = await engineDriverSources();
  const sources = serviceInputs([...discovered, fileURLToPath(import.meta.url),
    'specs/quint/refinement/services/workflow-engine/ports.mjs', 'specs/quint/refinement/services/support.mjs',
    'package.json', 'package-lock.json', ...extraSources]);
  const driverHashes = captureInputs(sources);
  const compiledHashes = await prepareEngineModule(discovered, driverHashes);
  for (const [path, hash] of Object.entries(compiledHashes)) assert.equal(hash, driverHashes[path]);
  const traces = await collectWorkflowEngineTraces();
  const receipt = await checkTraces({model: 'WorkflowEngineAdmission', sources, driverHashes, traces,
    scope: 'bounded-orchestration', assumptions: [
      'Actual EmbeddedWorkflowService, dispatch, compiler, clock classifier and Drizzle queries run against real single-process PGlite. Two same-key callers execute concurrently.',
      'One workflow, one bound target submission/occurrence, optional pre-existing active run, two version/owner/input equality classes and at most two process invocations.',
      'Process execution/control and canonical Smithers approval-store reads are controlled external ports. Their installed implementation, process isolation, effect execution and multi-host PostgreSQL locking are separate obligations.',
      'Schema columns and primary keys come from actual Drizzle table definitions. Production migrations, indexes, defaults and PostgreSQL deployment are not established by this fixture.',
      'workerApproval represents the invocation-local approval snapshot. Source checkpoints observe persisted projection and canonical receipt, not this private closure field.',
    ]});
  return {receipts: [receipt], obligations: [
    {model: 'WorkflowEngineAdmission', obligation: 'Installed Smithers process and SQLite approval adapter, typed device-effect dispatch and hosted Google/native authority', reason: 'These external ports are controlled; no provider or real process effects are executed.'},
    {model: 'WorkflowEngineAdmission', obligation: 'Multi-host PostgreSQL isolation, schema migrations and production recovery supervision', reason: 'PGlite executes real SQL and same-process transactions, without establishing production process/host scheduling or schema rollout.'},
    {model: 'WorkflowEngineAdmission', obligation: 'Timer/event reconciliation queues, schedule task arming, multiple distinct submissions and full timezone input space', reason: 'Current finite slice checks one durable identity and selected real occurrence classifications; these wider collections remain outside the bound.'},
    {model: 'WorkflowEngineAdmission', obligation: 'All execution fields, event history, outputs/errors, notification listeners and invocation-local worker snapshot', reason: 'Selected fields and status/canonical approval relationships are observed. Broader source hashes are provenance, not field refinement.'},
  ]};
}
