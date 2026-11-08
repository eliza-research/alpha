import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../../refinement/check-traces.mjs';
import {loadAgentRuntime} from '../../refinement/services/core-runtime/module.mjs';
import {loadTaskService} from '../../refinement/services/task-service/module.mjs';

const driver = fileURLToPath(import.meta.url);
const upstreamWitnesses = 'vendor/eliza/packages/core/test/runtime-lifecycle-model.test.ts';
const room = '00000000-0000-4000-8000-000000000001';
const action = (name, ...args) => ({name, args});
const turn = () => new Promise(setImmediate);

function actor(runtime, prepareCalls) {
  const phases = new Map([[1, 'idle'], [2, 'idle']]);
  const signals = new Map(), held = new Map();
  const observe = () => {
    const queued = [...phases].filter(([, value]) => value === 'queued').map(([id]) => id);
    const owned = [...phases].filter(([, value]) => value === 'turn').map(([id]) => id);
    assert.ok(owned.length <= 1);
    assert.equal(runtime.roomHandlerQueue.pendingTotal(), queued.length + owned.length);
    assert.equal(runtime.stopRequested, runtime.getStopSignal().aborted);
    return {
      sourceLifecycle: runtime.getLifecycleState(),
      'sourceState.initResolved': !runtime.initResolver,
      'sourceState.initFailed': runtime.initializationFailed,
      'sourceState.queue': queued,
      'sourceState.owner': owned[0] ?? 0,
      'sourceState.tpc': qmap(phases),
      'sourceState.aborted': qmap([1, 2].map(id => [id, signals.get(id)?.aborted ?? false])),
      'sourceState.stopReq': runtime.stopRequested,
      'sourceState.stopped': runtime.stopped,
      'sourceState.stopPromise': Boolean(runtime.stopPromise),
      'sourceState.closed': !runtime.roomHandlerQueue.isAcceptingAdmissions(),
      'sourceState.turnsClosed': runtime.turnControllers.closedReason !== null,
      'sourceState.failures': runtime.retirement.failures.length > 0,
      ...(prepareCalls ? {'sourceState.prepareCalls': prepareCalls()} : {}),
    };
  };
  async function submit(id) {
    phases.set(id, 'queued');
    const pending = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const completion = runtime.roomHandlerQueue.withLease(room, () =>
      runtime.turnControllers.runWith(room, async signal => {
        phases.set(id, 'turn');
        signals.set(id, signal);
        entered.resolve();
        await pending.promise;
      }),
    ).then(() => {
      phases.set(id, 'done');
    }, error => {
      assert.equal(error.code, 'ROOM_HANDLER_QUEUE_CLOSED');
      phases.set(id, 'refused');
    });
    held.set(id, {pending, entered, completion});
    await turn();
  }
  async function finish(id, successor) {
    const owned = held.get(id);
    assert.ok(owned);
    owned.pending.resolve();
    await owned.completion;
    if (successor) await held.get(successor).entered.promise;
  }
  return {observe, submit, finish, phases};
}

function schedule(name, owner) {
  const trace = {name, init: action('init'), expect: owner.observe(), steps: []};
  return {trace, point(label, ...actions) {
    trace.steps.push({label, action: actions, expect: owner.observe()});
  }};
}

export async function checkRuntimeLifecycleRefinement(extraSources = []) {
  const inputs = [driver, upstreamWitnesses, ...extraSources];
  const core = await loadAgentRuntime(inputs);
  const sql = await loadTaskService(inputs);
  const traces = [];
  {
    let starts = 0;
    class EagerService {
      static serviceType = 'quint-failed-init-eager';
      static async start() { starts++; return new EagerService(); }
    }
    const runtime = new core.AgentRuntime({
      character: {name: 'Quint failed initialization', bio: []}, logLevel: 'fatal',
      plugins: [{name: 'quint-failed-initialization', services: [EagerService]}],
      fetch: async () => {throw Error('Synthetic lifecycle fixture forbids external requests');},
    });
    const f = actor(runtime);
    const t = schedule('failed_core_initialization_releases_eager_wait_without_starting', f);
    try {
      const initialize = runtime.initialize();
      const refused = assert.rejects(initialize, /Database adapter not initialized/);
      t.point('core plugin registration begins while startup is unresolved', action('sourceRegister'));
      await refused;
      await turn();
      assert.equal(starts, 0);
      t.point('failed initialization releases the eager service waiter', action('sourceCoreInit', false), action('sourceServiceResume'));
      traces.push(t.trace);
    } finally { await runtime.stop(); }
  }
  const database = await sql.createIsolatedTestDatabase('quint-core-runtime-lifecycle', [], {postgresUrl: null});
  try {
    const runtime = database.runtime;
    let prepared = 0, stopped = 0;
    const service = {prepareStop() {prepared++;}, async stop() {stopped++;}};
    const serviceClass = {name: 'QuintLifecycleFixture', serviceType: 'quint-lifecycle', start: async () => service};
    const f = actor(runtime, () => prepared);
    const t = schedule('strict_shutdown_drains_current_and_already_queued_turns', f);
    const initialize = runtime.initialize({skipMigrations: true});
    t.point('core initialization registers plugins before resolving', action('sourceRegister'));
    await initialize;
    t.point('actual runtime publishes initialization success', action('sourceCoreInit', true));
    await runtime.registerService(serviceClass);
    await runtime.getServiceLoadPromise(serviceClass.serviceType);
    assert.equal(runtime.getService(serviceClass.serviceType), service);
    t.point('actual eager service startup settles on the initialized owner', action('sourceServiceResume'), action('sourceServiceStarted'));

    await f.submit(1);
    t.point('room owner and its turn start', action('sourceAdmit', 1), action('sourceGrant'), action('sourceRun', 1));
    await f.submit(2);
    t.point('a second turn waits behind the room owner', action('sourceAdmit', 2));
    const stopping = runtime.stop({requireQuiescence: true});
    assert.equal(runtime.stop({requireQuiescence: true}), stopping);
    await turn();
    t.point('strict calls share one stop and abort the active turn', action('sourceStop', 3, false, true), action('sourceStop', 4, false, true));
    await f.finish(1, 2);
    t.point('the accepted waiter enters with an aborted turn signal', action('sourceFinish', 1), action('sourceGrant'), action('sourceRun', 2));
    await f.finish(2);
    await stopping;
    assert.equal(stopped, 1);
    assert.equal(runtime.getService(serviceClass.serviceType), null);
    t.point('both turns, service teardown and the two strict callers settle', action('sourceFinish', 2),
      action('sourceDrained'), action('sourceServiceStop'), action('sourceServiceStopDone'), action('sourceServiceSettled'),
      action('sourceBestDone', 3), action('sourceStrictDrained', 3), action('sourceStrictJoinDone', 4));
    traces.push(t.trace);
  } finally { await database.runtime.stop(); await database.cleanup(); }
  {
    const runtime = new core.AgentRuntime({
      character: {name: 'Quint closed room admission', bio: []}, logLevel: 'fatal',
      fetch: async () => {throw Error('Synthetic lifecycle fixture forbids external requests');},
    });
    const f = actor(runtime);
    const t = schedule('new_room_admission_refuses_after_stop_has_closed_ingress', f);
    try {
      await f.submit(1);
      t.point('room owner starts before stop', action('sourceAdmit', 1), action('sourceGrant'), action('sourceRun', 1));
      const stopped = runtime.stop();
      await turn();
      t.point('stop closes room and turn admissions', action('sourceStop', 3, false, false));
      await f.submit(2);
      assert.equal(f.phases.get(2), 'refused');
      t.point('a later room caller is refused instead of queued', action('sourceAdmit', 2));
      await f.finish(1);
      await stopped;
      t.point('the earlier owner settles and stop returns', action('sourceFinish', 1),
        action('sourceDrained'), action('sourceServiceStop'), action('sourceServiceSettled'), action('sourceBestDone', 3));
      traces.push(t.trace);
    } finally {await runtime.stop();}
  }
  const sources = [...new Set([...core.sources, ...sql.sources])];
  for (const [path, digest] of Object.entries(core.driverHashes)) {
    if (sql.driverHashes[path]) assert.equal(sql.driverHashes[path], digest, path);
  }
  const driverHashes = {...core.driverHashes, ...sql.driverHashes};
  return checkTraces({model: 'CoreRuntimeLifecycle', sources, driverHashes, traces, scope: 'bounded-orchestration',
    assumptions: ['Real AgentRuntime startup, isolated PGlite persistence, room queue and turn registry execute with synthetic turns and service callbacks.',
      'Checkpoints combine source operations that settle in a single controlled schedule.',
      'Private attempt counters, late eager startup teardown and the original timeout profile need further source schedules.']});
}
