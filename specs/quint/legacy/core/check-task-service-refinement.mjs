import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../../refinement/check-traces.mjs';
import {loadTaskService} from '../../refinement/services/task-service/module.mjs';

const model = 'CoreTaskService';
const profiles = {
  daemonOneshot: model,
  daemonRepeat: model+'DaemonRepeat',
  localOneshot: model+'LocalOneshot',
  localRepeat: model+'LocalRepeat',
};
const modelPath = 'specs/quint/legacy/'+model+'.qnt';
const upstream = 'vendor/eliza/packages/core/tla/TaskService';
const workerName = 'QUINT_ORIGINAL_TASK_SERVICE';
const action = (name, ...args) => ({name: 'source'+name, args});
const begin = runner => [action('Begin', runner), action('Read', runner)];
const select = (runner, repeat) => [action('Select', runner), ...(!repeat ? [action('Recheck', runner)] : [])];
const finish = (runner, outcome) => [action('Work', runner, outcome),
  ...(outcome !== 'preserve' ? [action('Write', runner)] : []), action('Release', runner)];
const failure = Error('Synthetic worker refused');

async function until(condition, label) {
  const end = performance.now()+10000;
  while (!condition() && performance.now() < end) await delay(5);
  assert.ok(condition(), label);
}

async function fixture(loaded, profile, {maxFailures = 2} = {}) {
  const database = await loaded.createIsolatedTestDatabase('quint-original-task-'+randomUUID(), [], {postgresUrl: null});
  const {runtime, adapter} = database;
  runtime.fetch = async () => {throw Error('TaskService fixture forbids external requests');};
  const local = profile.includes('Local');
  const repeat = profile.endsWith('Repeat');
  const runner = new AsyncLocalStorage();
  const timers = new Map(), operations = [], calls = [], checks = new Map(), refuseRead = new Set();
  const realRead = runtime.getTask.bind(runtime);
  const realQuery = runtime.getTasks.bind(runtime);
  let now = 100000, id, closing = false, queueReads = 0;
  const service = new loaded.TaskService(runtime, {
    now: () => now,
    setTimeout(callback, wait) {
      const timer = Symbol('task timer');
      timers.set(timer, {callback, when: now+wait});
      return timer;
    },
    clearTimeout(timer) {timers.delete(timer);},
  });
  runtime.getTask = async task => {
    if (refuseRead.delete(runner.getStore())) throw Error('Synthetic one-shot reread unavailable');
    return realRead(task);
  };
  runtime.getTasks = request => {
    queueReads++;
    return realQuery(request);
  };
  runtime.registerTaskWorker({
    name: workerName,
    async shouldRun(_runtime, row) {
      assert.equal(row.id, id);
      const held = checks.get(runner.getStore());
      if (held) {
        held.entered.resolve();
        await held.release.promise;
      }
      return true;
    },
    async execute(_runtime, _options, row) {
      assert.equal(row.id, id);
      if (closing) return {preserveTask: true};
      const call = {runner: runner.getStore(), row, gate: Promise.withResolvers(), outcome: 'pending'};
      calls.push(call);
      return call.gate.promise;
    },
  });
  const read = () => realRead(id);
  async function observe() {
    const row = await read();
    const result = {
      'sourceState.row.exists': !!row, 'sourceState.inSet': service.executingTasks.has(id),
      'sourceState.armed': service.hasTimer, sourceTickActive: !!service.activeTick,
      'sourceState.starts': Math.min(2, calls.filter(call => repeat || call.outcome !== 'preserve').length),
      ...(profile === model ? {} : {safety: true}),
    };
    assert.equal(service.hasTimer, timers.size === 1);
    if (row) {
      const meta = row.metadata;
      Object.assign(result, {
        'sourceState.row.paused': meta.paused === true,
        'sourceState.row.due': repeat ? meta.updatedAt + meta.updateInterval <= now : !row.dueAt || Number(row.dueAt) <= now,
        'sourceState.row.failing': (meta.failureCount ?? 0) > 0,
        'sourceState.row.wake': meta.wakeAt !== undefined,
        'sourceState.row.wakeDue': meta.wakeAt !== undefined && meta.wakeAt <= now,
        'sourceState.row.rev': meta.wakeRevision ?? 0,
      });
    }
    return result;
  }
  function run(slot, fn) {
    const pending = runner.run(slot, fn).then(value => ({value}), error => ({error}));
    operations.push(pending);
    return pending;
  }
  function fire() {
    assert.equal(timers.size, 1);
    const [[handle, timer]] = [...timers];
    timers.delete(handle);
    now = Math.max(now, timer.when);
    return run(1, timer.callback);
  }
  async function waitForCall(slot, count = 1) {
    await until(() => calls.filter(call => call.runner === slot).length === count, 'Actual worker reached its held completion');
    return calls.filter(call => call.runner === slot).at(-1);
  }
  function settle(call, outcome = 'ok') {
    assert.equal(call.outcome, 'pending');
    call.outcome = outcome;
    if (outcome === 'fail') call.gate.reject(failure);
    else call.gate.resolve(outcome === 'preserve' ? {preserveTask: true} : undefined);
  }
  async function wake(at) {
    assert.equal(adapter.supportsAtomicTaskWake, true);
    assert.equal(await runtime.patchTaskMetadata(id, {set: {}, unset: [], wake: {requestAt: at}}), 'patched');
  }
  async function cleanup() {
    closing = true;
    for (const check of checks.values()) check.release.resolve();
    for (const call of calls) call.gate.resolve({preserveTask: true});
    try {await Promise.all(operations); await runtime.stop();}
    finally {await database.cleanup();}
  }
  try {
    await runtime.initialize({skipMigrations: true});
    await runtime.registerService({name: 'QuintTaskServiceFixture', serviceType: loaded.TaskService.serviceType,
      async start() {return service;}});
    assert.equal(await runtime.getServiceLoadPromise(loaded.TaskService.serviceType), service);
    id = await runtime.createTask({name: workerName, tags: repeat ? ['queue','repeat'] : ['queue'],
      metadata: {updatedAt: 0, updateInterval: 60000, blocking: true, maxFailures}});
    if (local) service.startTimer();
    assert.equal(service.hasTimer, local);
  } catch (error) {await cleanup(); throw error;}
  return {service, observe, read, checks, refuseRead, calls, fire, waitForCall, settle, wake, cleanup,
    get now() {return now;},
    get queueReads() {return queueReads;},
    advance(time) {assert.ok(time >= now); now = time;},
    due: () => run(2, () => service.runDueTasks()),
    daemon: rows => run(3, () => service.runTick(rows)),
    manual: () => run(4, () => service.executeTaskById(id)),
    pause: () => service.pauseTask(id),
    resume: () => service.resumeTask(id),
    query: () => realQuery({tags: ['queue'], agentIds: [runtime.agentId]}),
  };
}

export async function checkTaskServiceRefinement(extraSources = []) {
  const loaded = await loadTaskService([
    fileURLToPath(import.meta.url), ...extraSources,
    'vendor/eliza/packages/core/test/task-scheduler-model.test.ts',
    upstream+'.tla', ...Object.keys(profiles).map(profile => upstream+'.'+profile+'.cfg'),
  ]);
  const campaigns = new Map(Object.values(profiles).map(profile => [profile, []]));
  let divergence;
  async function scenario(profile, name, execute, options) {
    const f = await fixture(loaded, profile, options);
    try {
      const trace = {name, expect: await f.observe(), steps: []};
      const point = async (label, actions) => {
        const step = {label, action: actions, expect: await f.observe()};
        trace.steps.push(step);
        return step;
      };
      await execute(f, point, trace);
      campaigns.get(profile).push(trace);
    } finally {await f.cleanup();}
  }
  await scenario(model, 'stale_daemon_snapshot_rechecks_after_host_one_shot_delete', async (f, point) => {
    const held = {entered: Promise.withResolvers(), release: Promise.withResolvers()};
    f.checks.set(3, held);
    const stale = f.daemon(await f.query());
    await held.entered.promise;
    await point('daemon has a real persisted snapshot and holds preflight', begin(3));
    const due = f.due();
    const worker = await f.waitForCall(2);
    await point('host acquires the one-shot and rechecks its row', [...begin(2), ...select(2, false)]);
    f.settle(worker);
    assert.equal((await due).error, undefined);
    assert.equal(await f.read(), null);
    await point('host settles and durably deletes', finish(2, 'ok'));
    held.release.resolve();
    assert.equal((await stale).error, undefined);
    assert.equal(f.calls.length, 1);
    await point('stale daemon readback misses and never executes', [action('Select', 3), action('RecheckRefused', 3), action('Release', 3)]);
  });
  await scenario(model, 'failed_one_shot_recheck_and_preserved_retry_keep_row', async (f, point) => {
    f.refuseRead.add(2);
    const due = await f.due();
    assert.equal(due.error?.code, 'TASK_TICK_FAILED');
    assert.equal(f.calls.length, 0);
    assert.ok(await f.read());
    await point('failed reread releases claim without executing or deleting', [...begin(2), action('Select', 2),
      action('RecheckRefused', 2), action('Release', 2)]);
    const daemon = f.daemon(await f.query());
    const worker = await f.waitForCall(3);
    await point('fresh daemon invocation executes the retained one-shot', [...begin(3), ...select(3, false)]);
    f.settle(worker, 'preserve');
    assert.equal((await daemon).error, undefined);
    assert.ok(await f.read());
    await point('preserve result leaves row eligible and releases claim', finish(3, 'preserve'));
  });
  await scenario(profiles.daemonRepeat, 'blocking_owner_and_fresh_wake_survive_stale_completion', async (f, point) => {
    const manual = f.manual();
    const first = await f.waitForCall(4);
    await point('manual execution acquires blocking repeat ownership', [...begin(4), ...select(4, true)]);
    assert.equal((await f.daemon(await f.query())).error, undefined);
    assert.equal(f.calls.length, 1);
    await point('daemon cannot overlap a blocking manual owner', [...begin(3), action('Select', 3)]);
    const target = f.now+5000;
    await f.wake(target);
    await point('atomic wake write assigns a newer revision', [action('Request')]);
    f.settle(first);
    assert.equal((await manual).error, undefined);
    assert.equal((await f.read()).metadata.wakeAt, target);
    await point('stale worker completion leaves the newer wake intact', finish(4, 'ok'));
    f.advance(target);
    await point('controlled clock reaches the retained wake', [action('WakeElapse')]);
    const due = f.due();
    const next = await f.waitForCall(2);
    assert.equal(next.row.metadata.wakeRevision, 1);
    await point('host worker observes the exact fresh wake', [...begin(2), ...select(2, true)]);
    f.settle(next);
    assert.equal((await due).error, undefined);
    assert.equal((await f.read()).metadata.wakeAt, undefined);
    await point('matching revision consumes the wake without resetting the revision', finish(2, 'ok'));
  });
  await scenario(profiles.daemonRepeat, 'repeat_failure_backoff_common_projection', async (f, point, trace) => {
    const manual = f.manual();
    const call = await f.waitForCall(4);
    await point('manual worker holds the repeat claim', [...begin(4), ...select(4, true)]);
    f.settle(call, 'fail');
    assert.equal((await manual).error?.code, 'TASK_EXECUTION_FAILED');
    assert.equal((await f.read()).metadata.paused, true);
    const final = await point('current failure threshold persists failure state and pause', finish(4, 'fail'));
    divergence = structuredClone(trace);
    divergence.name = 'repeat_failure_threshold_adds_pause_outside_literal_write';
    delete final.expect['sourceState.row.paused'];
  }, {maxFailures: 1});
  await scenario(profiles.localOneshot, 'timer_defers_behind_host_and_then_disarms_on_empty_queue', async (f, point) => {
    const host = f.due();
    const owner = await f.waitForCall(2);
    await point('host owns activeTick and one-shot worker', [...begin(2), ...select(2, false)]);
    const queries = f.queueReads;
    assert.equal((await f.fire()).error, undefined);
    assert.equal(f.queueReads, queries);
    await point('fired timer waits behind the original activeTick', [action('Begin', 1)]);
    f.settle(owner);
    assert.equal((await host).error, undefined);
    await point('host completion deletes and the deferred timer rearms', finish(2, 'ok'));
    assert.equal((await f.fire()).error, undefined);
    assert.equal(f.queueReads, queries+1);
    await point('timer reads an empty queue and disarms', begin(1));
  });
  await scenario(profiles.localOneshot, 'paused_one_shot_stays_until_real_resume', async (f, point) => {
    await f.pause();
    await point('pause persisted before timer reads', [action('Pause')]);
    assert.equal((await f.fire()).error, undefined);
    assert.equal(f.calls.length, 0);
    await point('paused snapshot is retained without dispatch', [...begin(1), action('Select', 1)]);
    await f.resume();
    await point('resume writes through the real task service', [action('Pause')]);
    const timer = f.fire();
    const worker = await f.waitForCall(1);
    await point('resumed timer executes the one-shot', [...begin(1), ...select(1, false)]);
    f.settle(worker);
    assert.equal((await timer).error, undefined);
    await point('resumed one-shot completes and deletes', finish(1, 'ok'));
  });
  await scenario(profiles.localRepeat, 'atomic_wake_rearms_local_repeat_before_interval', async (f, point) => {
    const initial = f.fire();
    const first = await f.waitForCall(1);
    await point('due repeat enters through the local timer', [...begin(1), ...select(1, true)]);
    f.settle(first);
    assert.equal((await initial).error, undefined);
    await point('successful completion schedules the next cadence', finish(1, 'ok'));
    const target = f.now+1000;
    await f.wake(target);
    await point('runtime wake write leaves the local timer armed', [action('Request')]);
    f.advance(target);
    await point('wake arrives before the ordinary cadence', [action('WakeElapse')]);
    const next = f.fire();
    const second = await f.waitForCall(1, 2);
    assert.equal(second.row.metadata.wakeRevision, 1);
    await point('timer reads the exact wake revision and dispatches', [...begin(1), ...select(1, true)]);
    f.settle(second);
    assert.equal((await next).error, undefined);
    await point('successful execution consumes the revision', finish(1, 'ok'));
  });

  const shared = {modelPath, sources: loaded.sources, driverHashes: loaded.driverHashes, scope: 'bounded-orchestration',
    assumptions: [
      'Actual TaskService and AgentRuntime execute against PGlite. Source capture includes reviewed effective TaskService patch inputs. One real task row, synthetic worker, and controlled clock.',
      'Public manual, due, pause and resume entrypoints and the actual runTick over a real daemon snapshot execute. Local timer handles are delivered through the production clock port.',
      'Selected transitions group source promise microtasks. Claims project counted ownership to membership in the original blocking profiles. Scheduler process integration and original temporal fairness are separate.',
    ]};
  const receipts = [];
  for (const [profile, traces] of campaigns) receipts.push(await checkTraces({...shared, model: profile, traces}));
  const id = model+'FailurePauseDivergence';
  const out = 'test-results/quint-refinement/'+id+'.json';
  await assert.rejects(checkTraces({...shared, model: profiles.daemonRepeat, id, out, traces: [divergence]}),
    /Source\/model trace mismatch/);
  const mismatch = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(mismatch.results[0].kind, 'observation-mismatch');
  assert.ok(mismatch.driverInputsBound);
  return {receipts, mismatch};
}
