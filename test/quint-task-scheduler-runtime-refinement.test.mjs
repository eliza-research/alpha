import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../specs/quint/refinement/check-traces.mjs';
import {loadSchedulerSource} from '../specs/quint/refinement/services/task-scheduler/module.mjs';
import {runtimeSchedulerFixture} from '../specs/quint/refinement/services/task-scheduler/runtime-fixture.mjs';

const model = 'TaskSchedulerRuntime';
const modelPath = `specs/quint/services/${model}.qnt`;
const action = (name, ...args) => ({name, args});
const sources = ['fixture.mjs', 'runtime-fixture.mjs', 'runtime.mjs']
  .map(name => fileURLToPath(new URL(`./${name}`, import.meta.url))).concat(modelPath);

async function runTaskSchedulerRuntimeRefinement(extraSources = []) {
  const loaded = await loadSchedulerSource([...sources, ...extraSources]);
  const traces = [];
  async function scenario(name, body) {
    const f = await runtimeSchedulerFixture(loaded);
    const trace = {name, expect: f.observe(), steps: []};
    const record = (label, action) => trace.steps.push({label, action, expect: f.observe()});
    const driver = {
      ...f, record,
      start(id) {f.start(id);record('select adapter', action('startAdapter', id));},
      stop() {f.stop();record('stop daemon and detach old tick', action('stopDaemon'));},
      register(id) {f.register(id);record('TaskService registers in shared scheduler', action('registerService', id));},
      stopService(id) {f.stopService(id);record('service retires only owned registration', action('stopService', id));},
      dirty(service, agent) {f.dirty(service);record('TaskService marks agent dirty', action('markDirty', agent));},
      fire(slot, agents) {
        assert.deepEqual(f.fire(slot)?.agents ?? [], agents);
        record('actual timer captures one ordered DB cohort and queues process tasks', action('fireTick', slot));
      },
      async response(slot, rows) {
        await f.respond(slot, rows);
        record('DB result is grouped and first still-current service dispatched',
          rows === null ? action('queryFailure', slot) : action('queryRows', slot, rows));
      },
      async finish(slot, failed = false) {
        await f.finishGroup(slot, failed);
        record('actual service finishes and next captured group is checked', action('finishGroup', slot, failed));
      },
      registerProcess(id) {f.registerProcess(id);record('register process task', action('registerProcess', id));},
      disposeProcess(id) {
        const completion = f.disposeProcess(id);
        record('remove and abort exact process owner', action('disposeProcess', id));
        return completion;
      },
      async enterProcess(...ids) {
        await f.waitTurn();
        record('process callbacks cross their queued admission boundary', ids.map(id => action('enterProcess', id)));
      },
      async finishProcess(id, failed = false, dispose) {
        await f.finishProcess(id, failed);
        if (dispose) await dispose;
        record('process run settles and any disposer returns',
          dispose ? [action('finishProcess', id), action('disposerReturned', id)] : action('finishProcess', id));
      },
      async finishDispose(id, pending, skipped = false) {
        await pending;
        record('process disposer returns after cleanup', skipped ? [action('enterProcess', id), action('disposerReturned', id)] : action('disposerReturned', id));
      },
    };
    try {await body(driver, f);traces.push(trace);}
    finally {await f.close();}
  }

  await scenario('mixed scope rows preserve agent and row order', async f => {
    f.start(1); f.register(1); f.register(2); f.fire(1, [1, 2]);
    await f.response(1, [3, 5, 2, 1, 6]); await f.finish(1); await f.finish(1);
    assert.deepEqual(f.runs.map(({service, rows}) => [service, rows]), [[2, [3]], [1, [2, 1]]]);
    assert.deepEqual(f.reports.map(({service, code}) => [service, code]), [1, 2, 1, 2].map(service => [service, 'TASK_SCHEDULER_SCOPE_VIOLATION']));
  });
  await scenario('omitted agent stays clean and rows for an unqueried known agent are refused', async f => {
    f.start(1); f.register(1); f.register(2); f.fire(1, [1, 2]);
    await f.response(1, [1]); await f.finish(1);
    f.fire(2, [1]); await f.response(2, [3, 2]); await f.finish(2);
    assert.deepEqual(f.runs.map(({service, rows}) => [service, rows]), [[1, [1]], [1, [2]]]);
    assert.deepEqual(f.reports, [{service: 1, scope: 'TaskScheduler.scope', code: 'TASK_SCHEDULER_SCOPE_VIOLATION'}]);
    f.dirty(2, 2); f.fire(3, [1, 2]); await f.response(3, []);
  });
  await scenario('invalid rows diagnose current registrations and stale captured rows drop', async f => {
    f.start(1); f.register(1); f.register(2); f.fire(1, [1, 2]);
    f.dirty(2, 2); f.register(3); f.stopService(1);
    await f.response(1, [5, 1, 3]); await f.finish(1);
    assert.deepEqual(f.runs.map(call => call.service), [2]);
    assert.deepEqual(f.reports, [{service: 2, scope: 'TaskScheduler.scope', code: 'TASK_SCHEDULER_SCOPE_VIOLATION'}]);
    f.fire(2, [2, 1]); await f.response(2, [1]); await f.finish(2);
    assert.deepEqual(f.runs.map(call => call.service), [2, 3]);
  });
  await scenario('captured later group is rechecked after earlier run', async f => {
    f.start(1); f.register(1); f.register(2); f.fire(1, [1, 2]);
    await f.response(1, [3, 1]); f.register(3); await f.finish(1);
    assert.deepEqual(f.runs.map(call => call.service), [2]);
    f.fire(2, [1, 2]); await f.response(2, [2]); await f.finish(2);
    assert.deepEqual(f.runs.map(call => call.service), [2, 3]);
  });
  await scenario('stop restart detaches old run, skips only busy service and preserves successor', async f => {
    f.start(1); f.register(1); f.register(2); f.fire(1, [1, 2]);
    await f.response(1, [1, 3]); f.stop(); f.start(2); f.register(1); f.register(2);
    f.fire(2, [2]); await f.response(2, [3]);
    await f.finish(1);
    assert.deepEqual(f.runs.map(call => [call.slot, call.service]), [[1, 1], [2, 2]]);
    await f.finish(2); f.fire(3, [1, 2]); await f.response(3, []);
    assert.deepEqual(f.queries.map(query => query.adapter), [1, 2, 2]);
  });
  await scenario('detached query refusal is quiet, current failure diagnoses only captured current owners', async f => {
    f.start(1); f.register(1); f.register(2); f.fire(1, [1, 2]);
    f.stop(); f.start(2); f.register(1); f.register(2); f.fire(2, [1, 2]);
    await f.response(1, null); assert.deepEqual(f.reports, []);
    f.register(3); await f.response(2, null);
    assert.deepEqual(f.reports, [{service: 2, scope: 'TaskScheduler.query', code: 'TASK_SCHEDULER_QUERY_FAILED'}]);
    f.fire(3, [1, 2]); await f.response(3, []);
  });
  await scenario('worker rejection reports one service and still dispatches next group', async f => {
    f.start(1); f.register(1); f.register(2); f.fire(1, [1, 2]);
    await f.response(1, [1, 3]); await f.finish(1, true); await f.finish(1);
    assert.deepEqual(f.runs.map(call => call.service), [1, 2]);
    assert.deepEqual(f.reports, [{service: 1, scope: 'TaskScheduler.runTick', code: 'TASK_TICK_FAILED'}]);
  });
  await scenario('dispose between interval queue and promise callback never starts worker', async f => {
    f.registerProcess(1); f.fire(1, []);
    const dispose = f.disposeProcess(1); await f.finishDispose(1, dispose, true);
    assert.equal(f.processCalls.length, 0);
  });
  await scenario('duplicate name rejects, retired owner drains beside same-name successor', async (f, actual) => {
    f.registerProcess(1);
    assert.throws(() => actual.registerProcess(2), error => error.code === 'TASK_SCHEDULER_DUPLICATE_PROCESS_TASK');
    f.record('duplicate live process name refused', {...action('registerProcess', 2), reject: true});
    f.fire(1, []); await f.enterProcess(1);
    const earlier = f.disposeProcess(1);
    assert.equal(f.processCalls[0].signal.aborted, true);
    f.registerProcess(2); f.fire(1, []); await f.enterProcess(2);
    await f.finishProcess(1, false, earlier);
    await f.disposeProcess(1);
    assert.equal(f.processCalls[1].signal.aborted, false);
    await f.finishProcess(2, true);
    f.fire(1, []); await f.enterProcess(2); await f.finishProcess(2);
    assert.deepEqual(f.processCalls.map(call => call.id), [1, 2, 2]);
    const later = f.disposeProcess(2); await f.finishDispose(2, later);
  });
  await scenario('process tasks run beside active query and retain timer after daemon stops', async f => {
    f.start(1); f.register(1); f.fire(1, [1]);
    f.registerProcess(1); f.registerProcess(3); f.fire(2, []); await f.enterProcess(1, 3);
    f.fire(2, []); assert.deepEqual(f.processCalls.map(call => call.id), [1, 3]);
    f.stop(); await f.response(1, []);
    const earlier = f.disposeProcess(1); await f.finishProcess(1, false, earlier);
    await f.finishProcess(3);
    f.fire(2, []); await f.enterProcess(3); await f.finishProcess(3);
    const final = f.disposeProcess(3); await f.finishDispose(3, final);
    assert.equal(f.queries.length, 1);
  });

  const receipt = await checkTraces({model, modelPath, sources: loaded.sources, driverHashes: loaded.driverHashes,
    traces, batchSize: 3, scope: 'bounded-orchestration', assumptions: [
      'Two agents, three distinct TaskService owners, two adapters, three in-flight slots, two process task names and three process owner objects.',
      'Real daemon and patched TaskService execute with controlled timer, DB and worker ports. Out-of-scope, stale, empty and failed database replies are supplied by the DB fixture.',
      'Exact current registration/timer/promise identities and typed runtime reports are observed. Tick grouping order is checked when the actual runTick boundary receives rows. Internal undispatched groups and retired logger-only diagnostics are outside direct observation.',
      'A disposed process remains an owner of its active run until its promise settles. The same name can admit a successor after synchronous map removal. A transient no-query promise is collapsed to a stable checkpoint.',
    ]});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Larger concurrent cohorts, arbitrary adapter row values and cross-process timer/persistence behavior.',
      reason: 'Current abstraction observes selected finite schedules against an opt-in shared daemon with controlled host boundaries.'},
    {model, obligation: 'Actual production enablement and process task side effects.',
      reason: 'The current Alpha source does not directly enable the shared daemon. External process and scheduled worker effects use controlled completions.'},
  ]};
}

// Four bounded checker batches can each use up to 120 seconds; allow source setup and cleanup too.
test('actual scheduler refines batched scope and independent process ownership', {timeout: scaledTimeout(600000)}, async () => {
  const result = await runTaskSchedulerRuntimeRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(result.receipts.length, 1);
  const [receipt] = result.receipts;
  assert.equal(receipt.model, 'TaskSchedulerRuntime');
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  for (const name of ['TickCohort', 'TickRows', 's.busy', 'ProcessActive', 'ProcessReturned']) {
    assert.ok(receipt.observedFields.includes(name));
  }
  assert.ok(result.obligations.length > 0);
});
