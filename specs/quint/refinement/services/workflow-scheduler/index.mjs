import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {captureInputs, checkTraces} from '../../check-traces.mjs';
import {engineDriverSources, prepareEngineModule} from '../workflow-engine/ports.mjs';
import {serviceInputs} from '../source-inputs.mjs';
import {action, until} from '../support.mjs';
import {createSchedulerFixture} from './fixture.mjs';

async function observe(f) {
  const row = (await f.rows()).executions[0];
  const execution = row?.execution;
  const wake = row ? f.service.workerReconciliations.get(row.id) : undefined;
  return {
    's.present': !!row, 's.typed': !!execution?.input.typedSchedule, 's.status': row?.status ?? 'none',
    's.finished': row?.finished ?? false, 's.active': f.pending.length > 0, 's.starts': f.calls.length,
    's.now': f.clock.now - f.clock.initial, 's.wakeAt': wake ? wake.dueAtMs - f.clock.initial : 0,
    's.stopped': f.service.reconciliationStopped, 's.cancelled': !!execution?.cancellationRequestedAt,
    's.reconciliation': execution?.reconciliation?.state ?? 'none',
    's.signals': f.controls.filter(control => control.kind === 'signal').length,
  };
}
async function running(f, count) { await until(() => f.calls.length === count, 'resumed workflow process entry'); }
async function emit(f, id, type, at) {
  await f.pending[0].input.onEvent({sequence: ++f.eventSequence, type, timestamp: new Date().toISOString(),
    payload: {timerId: `timer-${id}`, ...(at === undefined ? {} : {firesAtMs: f.clock.initial + at})}});
}
async function signal(f) {
  await f.service.signalExecution(f.calls[0].runId, 'fixture-signal', {value: 1}, 'owner-A');
  await running(f, f.calls.length);
}

export async function collectWorkflowWakeupTraces() {
  const traces = [];
  async function scenario(name, callback, {typed = false, queued = false} = {}) {
    const f = await createSchedulerFixture();
    f.eventSequence = 0;
    try {
      if (typed) {
        const spec = {version: 1, name: 'Clock fixture', description: '', trigger: {kind: 'time', localTime: '00:00', timeZone: 'UTC', days: [0]},
          steps: [{id: 'text', kind: 'Read', operation: 'supplied_text', text: 'fixture'}]};
        const definition = f.phone.phoneDraftDefinition(spec);
        await f.seed({source: definition.source, metadata: definition.metadata});
      } else await f.seed();
      const trace = {name, init: action('init'), expect: await observe(f), steps: []};
      const point = async (label, transition) => trace.steps.push({label, action: transition, expect: await observe(f)});
      if (queued) {
        f.faultNextTransaction('after-commit');
        await assert.rejects(f.service.startWorkflow('workflow-A', {mode: 'trigger', triggerData: {
          scheduledAtMs: f.clock.initial, workflowVersionId: 'version-1',
        }}), /Injected lost response/);
        await point('queued occurrence persisted before host loss', action('admit', true));
      } else {
        if (typed) await f.service.startWorkflow('workflow-A', {mode: 'trigger', triggerData: {scheduledAtMs: f.clock.initial, workflowVersionId: 'version-1'}});
        else await f.service.startReviewedWorkflow('workflow-A', 'submission-A', 'version-1', {}, 'owner-A', () => {});
        await running(f, 1);
        await point('durable run enters first worker', [action('admit', typed), action('enter')]);
      }
      await callback(f, point);
      traces.push(trace);
    } finally { await f.close(); }
  }
  await scenario('timer event arms one callback and resumes the same run', async (f, point) => {
    await emit(f, 1, 'TimerCreated', 1000); await point('persist timer event', action('timerCreated', 1, 1000));
    await f.settleWith({status: 'waiting-timer'}); await point('timer wait arms deadline plus grace', action('park', 'waiting-timer', -1));
    f.clock.advance(f.clock.initial + 1100); await running(f, 2);
    await point('callback reserves one resume', [action('advance', 1100), action('fire'), action('enter')]);
    await f.settleWith({status: 'finished'}); await point('same run completes', action('finish'));
  });
  await scenario('closed and reopened timer IDs use latest open occurrence', async (f, point) => {
    for (const [id, type, at] of [[1, 'TimerCreated', 1000], [1, 'TimerFired'], [1, 'TimerCreated', 2000], [2, 'TimerCreated', 200]]) {
      await emit(f, id, type, at); await point('persist ordered timer history', type === 'TimerCreated' ? action('timerCreated', id, at) : action('timerClosed', id));
    }
    await f.settleWith({status: 'waiting-timer'}); await point('minimum currently open timer wins', action('park', 'waiting-timer', -1));
  });
  for (const earlier of [true, false]) {
    await scenario(`signal resume ${earlier ? 'replaces later' : 'retains earlier'} timer`, async (f, point) => {
      await f.settleWith({status: 'waiting-event', wakeAtMs: f.clock.initial + 1000});
      await point('event wait first deadline', action('park', 'waiting-event', 1000));
      await signal(f); await running(f, 2); await point('signal resumes parked worker once', [action('signal'), action('enter')]);
      if (earlier) {
        await emit(f, 1, 'TimerCreated', 200); await point('resumed worker opens earlier timer', action('timerCreated', 1, 200));
        await f.settleWith({status: 'waiting-timer'}); await point('earlier timer replaces old reservation', action('park', 'waiting-timer', -1));
        f.clock.advance(f.clock.initial + 300); await running(f, 3);
        await point('only replacement fires', [action('advance', 300), action('fire'), action('enter')]);
      } else {
        await f.settleWith({status: 'waiting-event', wakeAtMs: f.clock.initial + 2000});
        await point('later timeout preserves earliest reservation', action('park', 'waiting-event', 2000));
      }
    });
  }
  await scenario('terminal result prevents a retained timer from restarting work', async (f, point) => {
    await f.settleWith({status: 'waiting-event', wakeAtMs: f.clock.initial + 1000}); await point('deadline reserved', action('park', 'waiting-event', 1000));
    await signal(f); await running(f, 2); await point('signal starts second invocation', [action('signal'), action('enter')]);
    await f.settleWith({status: 'finished'}); await point('terminal row committed with old wake still pending', action('finish'));
    f.clock.advance(f.clock.initial + 1100); await new Promise(resolve => setImmediate(resolve));
    // A source read after callback completion waits behind its current-row query.
    await f.rows(); await point('timer rechecks terminal row and does not execute', [action('advance', 1100), action('fire')]);
    assert.equal(f.calls.length, 2);
  });
  await scenario('live worker poll later becomes unknown and withdraws wakeup', async (f, point) => {
    await f.settle(undefined, 'WORKFLOW_WORKER_RUNNING'); await point('live worker receives reconciliation poll', action('workerUnknown', true));
    f.clock.advance(f.clock.initial + 1100); await running(f, 2);
    await point('poll resumes the same execution', [action('advance', 1100), action('fire'), action('enter')]);
    await f.settle(undefined, 'WORKFLOW_WORKER_OUTCOME_UNKNOWN'); await point('unknown outcome has no automatic poll', action('workerUnknown', false));
  });
  await scenario('unknown result clears an earlier still-pending timeout', async (f, point) => {
    await f.settleWith({status: 'waiting-event', wakeAtMs: f.clock.initial + 1000}); await point('timeout reserved', action('park', 'waiting-event', 1000));
    await signal(f); await running(f, 2); await point('early signal resumes', [action('signal'), action('enter')]);
    await f.settle(undefined, 'WORKFLOW_WORKER_OUTCOME_UNKNOWN'); await point('uncertainty withdraws old callback', action('workerUnknown', false));
  });
  await scenario('stop clears timer and ignores already-queued callback before restart', async (f, point) => {
    await f.settleWith({status: 'waiting-event', wakeAtMs: f.clock.initial + 1000}); await point('timeout reserved', action('park', 'waiting-event', 1000));
    const old = f.clock.timers[0]; await f.service.stop(); await point('host stop clears owned reservation', action('stop'));
    f.clock.deliverAlreadyQueued(old); await new Promise(resolve => setImmediate(resolve));
    await point('queued old-host callback is inert', action('staleCallback'));
    await f.restart(); await running(f, 2); await point('new host recovers same unfinished row', [action('restart'), action('enter')]);
  });
  await scenario('cancelled parked run cannot be restarted by its old timeout', async (f, point) => {
    await f.settleWith({status: 'waiting-event', wakeAtMs: f.clock.initial + 1000}); await point('timeout reserved', action('park', 'waiting-event', 1000));
    await f.service.cancelExecutionWithReceipt(f.calls[0].runId); await point('parked run cancelled', action('cancel'));
    f.clock.advance(f.clock.initial + 1100); await new Promise(resolve => setImmediate(resolve)); await f.rows();
    await point('cancelled row blocks timeout admission', [action('advance', 1100), action('fire')]); assert.equal(f.calls.length, 1);
  });
  await scenario('event without timeout waits for explicit signal', async (f, point) => {
    await f.settleWith({status: 'waiting-event'}); await point('event wait has no invented deadline', action('park', 'waiting-event', -1));
    await signal(f); await running(f, 2); await point('explicit signal resumes same row', [action('signal'), action('enter')]);
  });
  await scenario('empty timer history uses bounded fallback', async (f, point) => {
    await f.settleWith({status: 'waiting-timer'}); await point('missing open timer retries in one minute', action('park', 'waiting-timer', -1));
  });
  await scenario('far timer clamps native timeout range', async (f, point) => {
    await emit(f, 1, 'TimerCreated', 2147483647); await point('far timer retained', action('timerCreated', 1, 2147483647));
    await f.settleWith({status: 'waiting-timer'}); await point('setTimeout bound respected', action('park', 'waiting-timer', -1));
  });
  await scenario('typed occurrence queued before crash becomes missed after admission window', async (f, point) => {
    f.clock.advance(f.clock.initial + 1800001); await point('admission window expires while host is absent', action('advance', 1800001));
    await f.restart(); await point('startup records missed without worker entry', action('missedQueued')); assert.equal(f.calls.length, 0);
  }, {typed: true, queued: true});
  await scenario('previously started typed run is reconciled even after admission window', async (f, point) => {
    await f.settle(undefined, 'WORKFLOW_WORKER_OUTCOME_UNKNOWN'); await point('started run has unknown process outcome', action('workerUnknown', false));
    f.clock.advance(f.clock.initial + 1800001); await point('clock passes original admission window', action('advance', 1800001));
    await f.restart(); await running(f, 2); await point('started execution keeps its identity and resumes', [action('restart'), action('enter')]);
  }, {typed: true});
  return traces;
}

export async function runWorkflowWakeupRefinement(extraSources = []) {
  const discovered = await engineDriverSources();
  const sources = serviceInputs([...discovered, fileURLToPath(import.meta.url),
    'specs/quint/refinement/services/workflow-scheduler/fixture.mjs', 'specs/quint/refinement/services/workflow-scheduler/clock.mjs',
    'specs/quint/refinement/services/workflow-scheduler/tasks.mjs', 'specs/quint/refinement/services/workflow-engine/ports.mjs',
    'specs/quint/refinement/services/support.mjs', 'package.json', ...extraSources]);
  const driverHashes = captureInputs(sources);
  await prepareEngineModule(discovered, driverHashes);
  const traces = await collectWorkflowWakeupTraces();
  const receipt = await checkTraces({model: 'WorkflowWakeups', sources, driverHashes, traces, scope: 'bounded-orchestration', assumptions: [
    'Actual EmbeddedWorkflowService, real SQL and a controlled platform clock execute these schedules; callbacks can be delivered after cancellation to exercise the old-host fence.',
    'One persisted execution, two timer identities and three worker invocations. Ordered event history is exercised; the model openTimers map remains an explicitly unobserved specification state.',
    'Process results and control are external ports. Waking the same run does not establish effect replay safety inside the installed Smithers worker.',
  ]});
  return {receipts: [receipt], obligations: [
    {model: 'WorkflowWakeups', obligation: 'Installed process/lease recovery, full event history and timer collections', reason: 'Controlled worker results and two timer identities bound the source campaign. openTimers is model-private and is not reconstructed by the driver.'},
    {model: 'WorkflowWakeups', obligation: 'Workflow task arming, trigger dispatcher and multi-run queues', reason: 'This slice covers per-execution wakeups. Persistent task registration and external scheduler dispatch are separate state owners.'},
  ]};
}
