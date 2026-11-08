import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces} from '../../check-traces.mjs';
import {loadSchedulerSource} from './module.mjs';
import {schedulerFixture} from './fixture.mjs';

const modelPath = 'specs/quint/legacy/CoreTaskScheduler.qnt';
const modelAction = (name, ...args) => ({name, args});
const driverSources = [fileURLToPath(import.meta.url), fileURLToPath(new URL('./fixture.mjs', import.meta.url)), modelPath];

export async function runTaskSchedulerRefinement(extraSources = []) {
  const loaded = await loadSchedulerSource([...driverSources, ...extraSources]);
  const live = [], restart = [];
  async function scenario(group, name, body) {
    const fixture = await schedulerFixture(loaded);
    const trace = {name, expect: fixture.observe(), steps: []};
    function record(label, action) {trace.steps.push({label, action, expect: fixture.observe()});}
    const driver = {
      ...fixture,
      start(id) {fixture.start(id);record('start selected adapter', modelAction('startAdapter', id));},
      stop() {fixture.stop();record('stop scheduler, detach active tick', modelAction('stopDaemon'));},
      register(id) {fixture.register(id);record('TaskService registers', modelAction('registerService', id));},
      stopService(id) {fixture.stopService(id);record('TaskService stops its own registration', modelAction('stopService', id));},
      dirty(id) {fixture.dirty(id);record('TaskService marks agent dirty', modelAction('markDirty'));},
      async fire(slot) {
        assert.equal(await fixture.fire(slot), true);
        record('timer captures dirty registration and starts query', modelAction('fireTick', slot));
      },
      async quiet(slot, label) {
        assert.equal(await fixture.fire(slot), false);
        record(label, null);
      },
      async query(slot, outcome, branch) {
        await fixture.finishQuery(slot, outcome);
        record(`query ${outcome} observed`, modelAction(branch, slot));
      },
      async finish(slot) {
        await fixture.finishRun(slot);
        record('actual TaskService runTick completes', modelAction('runDone', slot));
      },
      record,
    };
    try {await body(driver, fixture); group.push(trace);}
    finally {await fixture.close();}
  }

  await scenario(live, 'clean query waits for an explicit dirty mark', async (f, fixture) => {
    f.start(3); f.register(1); await f.fire(5);
    fixture.start(3); f.record('same adapter start preserves active owner', null);
    await f.quiet(6, 'attached query suppresses another callback');
    await f.query(5, 'empty', 'queryEmpty');
    await f.quiet(6, 'empty query leaves interval quiet');
    f.dirty(1); await f.fire(6); await f.query(6, 'empty', 'queryEmpty');
    assert.equal(f.queries.length, 2);
  });
  await scenario(live, 'late result from replaced adapter preserves successor tick', async f => {
    f.start(3); f.register(1); await f.fire(5); f.start(4); await f.fire(6);
    await f.query(5, 'stale rows', 'queryStale');
    await f.quiet(7, 'old finally leaves attached successor pending');
    await f.query(6, 'held', 'queryRows'); await f.finish(6);
    assert.deepEqual(f.queries.map(query => query.adapter), [3, 4]);
  });
  await scenario(live, 'stopped old instance cannot withdraw a replacement registration', async f => {
    f.start(3); f.register(1); await f.fire(5); f.register(2); f.stopService(1);
    await f.query(5, 'stale rows', 'queryStale');
    await f.fire(6); await f.query(6, 'held', 'queryRows'); await f.finish(6);
    assert.deepEqual(f.workers.map(worker => worker.service), [2]);
  });
  await scenario(live, 'detached run keeps its actual service busy', async f => {
    f.start(3); f.register(1); await f.fire(5); await f.query(5, 'held', 'queryRows');
    f.start(4);
    await f.quiet(6, 'dirty busy service is retained without a query');
    await f.finish(5);
    await f.fire(6); await f.query(6, 'held', 'queryRows'); await f.finish(6);
    assert.deepEqual(f.workers.map(worker => worker.service), [1, 1]);
  });
  await scenario(live, 'stop retires held query without running worker', async f => {
    f.start(3); f.register(1); await f.fire(5); f.stop();
    await f.query(5, 'stale rows', 'queryStale');
    assert.equal(f.workers.length, 0);
  });
  await scenario(live, 'stopped service cannot register while capacity remains', async (f, fixture) => {
    f.start(3); f.register(1); f.stopService(1);
    fixture.register(1);
    f.record('stopped instance cannot restart daemon registration', {...modelAction('registerService', 1), reject: true});
    f.dirty(1);
    assert.equal(await fixture.fire(5), false);
    f.record('unregistered dirty mark is cleared without a DB query', modelAction('fireTick', 5));
  });
  await scenario(live, 'dirty event during old query remains pending', async f => {
    f.start(3); f.register(1); await f.fire(5); f.dirty(1);
    await f.query(5, 'empty', 'queryEmpty');
    await f.fire(6); await f.query(6, 'empty', 'queryEmpty');
    assert.equal(f.queries.length, 2);
  });
  await scenario(restart, 'current query refusal re-dirties only current registration', async f => {
    f.start(3); f.register(1); await f.fire(5); await f.query(5, 'failure', 'queryFailure');
    assert.deepEqual(f.errors, [{service: 1, scope: 'TaskScheduler.query', code: 'TASK_SCHEDULER_QUERY_FAILED'}]);
    await f.fire(6); await f.query(6, 'held', 'queryRows'); await f.finish(6);
  });
  await scenario(restart, 'stale adapter failure cannot clear or re-dirty successor', async f => {
    f.start(3); f.register(1); await f.fire(5); f.start(4); await f.fire(6);
    await f.query(5, 'failure', 'queryFailure');
    assert.deepEqual(f.errors, []);
    await f.query(6, 'empty', 'queryEmpty');
    await f.quiet(7, 'stale failure does not create a retry');
  });
  await scenario(restart, 'same-generation refusal ignores superseded registration', async f => {
    f.start(3); f.register(1); await f.fire(5); f.register(2);
    await f.query(5, 'failure', 'queryFailure');
    assert.deepEqual(f.errors, []);
    await f.fire(6); await f.query(6, 'held', 'queryRows'); await f.finish(6);
    assert.deepEqual(f.workers.map(worker => worker.service), [2]);
  });

  const assumptions = [
    'One agent, two exact TaskService object identities, two adapter identities, three tick slots and up to two scheduler start/stop mutations as in the archived configuration.',
    'Controlled clock and DB query execute the actual source interval callback. The patched TaskService actually validates and runs the configured worker before its externally controlled completion.',
    'The read-only compiler observer exposes private module state without changing scheduler transitions. A transient no-query attachment can stutter at stable checkpoints.',
    'The action witness selects the original Query branch that source took. safety is checked at each checkpoint; the source has no separate taken history variable.',
  ];
  const receipts = [];
  for (const [model, traces] of [['CoreTaskScheduler', live], ['CoreTaskSchedulerRestart', restart]]) {
    receipts.push(await checkTraces({model, modelPath, sources: loaded.sources, driverHashes: loaded.driverHashes,
      traces, assumptions, scope: 'bounded-orchestration'}));
  }
  return {receipts, obligations: [
    {model: 'CoreTaskScheduler', obligation: 'Multi-agent grouped dispatch, out-of-scope rows and process-task registration/disposal.',
      reason: 'These actual source transitions are outside the single-agent archived design.'},
    {model: 'CoreTaskSchedulerRestart', obligation: 'Full stop/start recovery, arbitrary host DB and timer behavior and multi-process scheduling.',
      reason: 'The original configuration admits two scheduler start/stop mutations. The controlled timer and DB ports cover named schedules rather than all external behavior.'},
  ]};
}
