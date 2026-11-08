import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setImmediate as tick, setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../../refinement/check-traces.mjs';
import {loadTaskService} from '../../refinement/services/task-service/module.mjs';

const design = 'CoreServiceLifecycleDesign';
const siblings = design+'Siblings';
const modelPath = 'specs/quint/legacy/'+design+'.qnt';
const upstreamDesign = 'vendor/eliza/packages/core/tla/ServiceLifecycle';
const type = 'quint-translated-service';
const classes = [11, 12];
const callers = [21, 22];
const action = (name, ...args) => ({name: 'source'+name, args});
const room = '00000000-0000-4000-8000-000000000001';

async function fixture(loaded, profile, options = {}) {
  const database = await loaded.createIsolatedTestDatabase('quint-legacy-service-'+randomUUID(), [], {postgresUrl: null});
  const {runtime} = database;
  runtime.fetch = async () => {throw Error('Service lifecycle fixtures forbid external requests');};
  const starts = new Map(), instances = new Map(), observers = new Map(), requests = new Map();
  const stopOperations = new Map(), gates = [];
  let next = 1;
  const gate = () => {
    const value = Promise.withResolvers();
    gates.push(value);
    return value;
  };
  const count = id => starts.get(id)?.length ?? 0;
  function serviceClass(id) {
    return {
      name: 'FixtureService'+id,
      serviceType: type,
      start() {
        const pending = gate();
        const previous = starts.get(id) ?? [];
        previous.push(pending);
        starts.set(id, previous);
        return pending.promise;
      },
      ...(options.sendFailure && id === 11 ? {
        registerSendHandlers() {throw Error('Synthetic handler setup failed after publication');},
      } : {}),
    };
  }
  const definitions = new Map(classes.map(id => [id, serviceClass(id)]));
  const instanceId = instance => {
    if (!instance) return 0;
    const entry = [...instances].find(([, record]) => record.instance === instance);
    assert.ok(entry, 'Every published instance comes from a controlled start');
    return entry[0];
  };
  const classId = definition => {
    const entry = [...definitions].find(([, value]) => value === definition);
    assert.ok(entry, 'Every class is a controlled service');
    return entry[0];
  };
  runtime.registerEvent('SERVICE_STARTED', async event => {
    if (event.serviceType !== type) return;
    const emitted = (runtime.services.get(type) ?? []).find(value => !observers.has(instanceId(value)));
    const id = instanceId(emitted);
    assert.ok(id, 'Runtime publication precedes the observer');
    const observer = gate();
    observers.set(id, observer);
    await observer.promise;
  });
  async function settle() {
    await tick();
    for (const [id, record] of instances) {
      const operation = runtime.serviceLifecycle.stopOperations.get(record.instance);
      if (operation && !stopOperations.has(id)) {
        const observation = {operation, status: 'running'};
        stopOperations.set(id, observation);
        const done = () => {observation.status = 'done';};
        void operation.then(done, done);
      } else if (operation) {
        assert.equal(operation, stopOperations.get(id).operation, 'The real WeakMap retains the same stop promise');
      }
    }
    await tick();
  }
  const slots = Array.from({length: profile === siblings ? 4 : 3}, (_, index) => index+1);
  const observe = () => {
    const mapped = (ids, project) => qmap(ids.map(id => [id, project(id)]));
    return {
      'sourceState.types': qset((runtime.serviceTypes.get(type) ?? []).map(classId)),
      'sourceState.byClass': mapped(classes, id => instanceId(runtime.serviceInstancesByClass.get(definitions.get(id)))),
      'sourceState.starting': mapped(classes, id => runtime.startingServiceClasses.has(definitions.get(id))),
      'sourceState.failed': mapped(classes, id => runtime.failedServiceClasses.has(definitions.get(id))),
      'sourceState.att': mapped(classes, count),
      'sourceState.published': qset((runtime.services.get(type) ?? []).map(instanceId)),
      'sourceState.status': runtime.getServiceRegistrationStatus(type),
      'sourceState.nextInst': next,
      'sourceState.cls': mapped(slots, id => instances.get(id)?.cls ?? 0),
      'sourceState.stopCalls': mapped(slots, id => instances.get(id)?.stops ?? 0),
      'sourceState.stopOp': mapped(slots, id => stopOperations.get(id)?.status ?? 'none'),
      'sourceState.stopReq': runtime.stopRequested,
      'sourceState.stopped': runtime.stopped,
      ...(!options.owned ? {
        sourcePendingCallers: qset([...requests].filter(([, request]) => request.status === 'pending').map(([id]) => id)),
        sourceCompletedCallers: qset([...requests].filter(([, request]) => request.status !== 'pending').map(([id]) => id)),
      } : {}),
      ...(profile === siblings ? {safety: true} : {}),
    };
  };
  async function initialize() {
    await runtime.initialize({skipMigrations: true});
    await settle();
  }
  async function register(id) {await runtime.registerService(definitions.get(id));}
  async function registerOwned() {
    await runtime.registerPlugin({name: 'quint-owned-service', services: [definitions.get(11)]});
  }
  function load(id) {
    assert.ok(callers.includes(id) && !requests.has(id));
    const request = {status: 'pending'};
    request.result = runtime.getServiceLoadPromise(type).then(value => {
      request.status = 'ok';
      request.value = instanceId(value);
    }, error => {
      request.status = 'failed';
      request.error = error;
    });
    requests.set(id, request);
  }
  async function startResult(id, ok = true) {
    const pending = starts.get(id)?.at(-1);
    assert.ok(pending, 'The actual start hook was called');
    if (!ok) {
      pending.reject(Error('Synthetic service startup failure'));
      await settle();
      return;
    }
    const stop = gate();
    const record = {cls: id, stops: 0, stop, instance: {
      stop() {record.stops++; return stop.promise;},
    }};
    const index = next++;
    instances.set(index, record);
    pending.resolve(record.instance);
    await settle();
    return index;
  }
  async function waitForStart(id, attempt) {
    const deadline = performance.now() + 10000;
    while (count(id) < attempt && performance.now() < deadline) await delay(20);
    assert.equal(count(id), attempt, 'The actual eager retry timer admits exactly one more start');
    await settle();
  }
  async function finishObserver(id) {
    const observer = observers.get(id);
    assert.ok(observer, 'The actual observer was called');
    observer.resolve();
    await settle();
  }
  async function finishStop(id) {
    const record = instances.get(id);
    assert.equal(record.stops, 1);
    record.stop.resolve();
    await settle();
  }
  async function cleanup() {
    for (const gate of gates) gate.resolve();
    try {await runtime.stop({requireQuiescence: true});}
    finally {await database.cleanup();}
  }
  try {
    if (options.owned) await registerOwned();
    else await register(11);
    if (!options.owned) await initialize();
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {runtime, initialize, register, observe, settle, load, requests, count, instances, observers, startResult, waitForStart, finishObserver,
    finishStop, cleanup, unload: () => runtime.unloadPlugin('quint-owned-service')};
}

function schedule(name, f) {
  const trace = {name, expect: f.observe(), steps: []};
  return {trace, point(label, ...actions) {
    trace.steps.push({label, action: actions, expect: f.observe()});
  }};
}

function ensure(f, t, id) {
  f.load(id);
  return f.settle().then(() => {
    const result = f.requests.get(id);
    const actions = [action('Begin', id), action('Ensure', id)];
    if (result.status !== 'pending') actions.push(action('Settle', id));
    t.point('public load enters or joins shared class attempts', ...actions);
  });
}

export async function checkServiceLifecycleDesignRefinement(extraSources = []) {
  const compiled = await loadTaskService([
    fileURLToPath(import.meta.url), ...extraSources,
    'vendor/eliza/packages/core/test/service-lifecycle-model.test.ts',
    upstreamDesign+'.tla', upstreamDesign+'.liveness.cfg', upstreamDesign+'.siblings.cfg',
  ]);
  const traces = new Map([[design, []], [siblings, []]]);
  let divergence;
  async function scenario(profile, name, run, options) {
    const f = await fixture(compiled, profile, options);
    const t = schedule(name, f);
    try {
      await run(f, t);
      traces.get(profile).push(t.trace);
    } finally {
      await f.cleanup();
    }
  }
  await scenario(design, 'concurrent-public-loads-share-start-and-shutdown', async (f, t) => {
    await ensure(f, t, 21);
    await ensure(f, t, 22);
    assert.equal(f.count(11), 1);
    await f.startResult(11);
    t.point('instance is published while the start observer holds the promise', action('StartOk', 11));
    assert.equal(f.runtime.getService(type), f.instances.get(1).instance);
    assert.ok([...f.requests.values()].every(request => request.status === 'pending'));
    await f.finishObserver(1);
    assert.ok([...f.requests.values()].every(request => request.value === 1));
    t.point('both actual callers receive one instance', action('StartEvent', 11), action('Settle', 21), action('Settle', 22));
    const stopping = f.runtime.stop();
    await f.settle();
    t.point('runtime service shutdown calls one stop hook', action('RequestStop'), action('StopServices'), action('StopNext'));
    await f.finishStop(1);
    await stopping;
    t.point('shutdown clears published state after teardown', action('StopDone', 1), action('WaitStop'), action('Clear'));
  });
  await scenario(design, 'late-start-after-admission-cordon-is-stopped-without-publication', async (f, t) => {
    await ensure(f, t, 21);
    const release = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const holding = f.runtime.roomHandlerQueue.withLease(room, () => {entered.resolve(); return release.promise;});
    try {
      await entered.promise;
      const stopping = f.runtime.stop();
      await f.settle();
      t.point('runtime rejects new service admission before service sweep', action('RequestStop'));
      await f.startResult(11);
      t.point('late start reaches stop without publication', action('StartOk', 11));
      assert.equal(f.requests.get(21).status, 'pending');
      await f.finishStop(1);
      assert.equal(f.requests.get(21).status, 'failed');
      t.point('late teardown precedes load rejection', action('StopDone', 1), action('LateStopped', 11), action('Settle', 21));
      release.resolve();
      await holding;
      await stopping;
      t.point('ordinary shutdown clears the maps', action('StopServices'), action('Clear'));
    } finally {release.resolve(); await holding;}
  });
  await scenario(design, 'plugin-unload-joins-stop-owned-by-runtime', async (f, t) => {
    await f.initialize();
    t.point('real initialization releases eager plugin start', action('Begin', 21), action('Ensure', 21));
    await f.startResult(11);
    t.point('owned service publishes and notifies', action('StartOk', 11));
    await f.finishObserver(1);
    t.point('start observer settles', action('StartEvent', 11), action('Settle', 21));
    const stopping = f.runtime.stop();
    await f.settle();
    t.point('runtime starts service teardown', action('RequestStop'), action('StopServices'), action('StopNext'));
    const unloading = f.unload();
    await f.settle();
    t.point('unload removes lookup and joins the original stop', action('Unload'), action('DrainUnload'));
    await f.finishStop(1);
    await Promise.all([stopping, unloading]);
    t.point('both operations finish after a single teardown', action('StopDone', 1), action('WaitStop'), action('Clear'), action('FinishUnload'));
    assert.equal(f.instances.get(1).stops, 1);
  }, {owned: true});
  await scenario(design, 'unload-during-start-withdraws-class-before-waiting', async (f, t) => {
    await f.initialize();
    t.point('plugin eager start admitted', action('Begin', 21), action('Ensure', 21));
    await ensure(f, t, 22);
    const unloading = f.unload();
    await f.settle();
    t.point('unload withdraws class before awaiting either ensure', action('Unload'));
    await f.startResult(11);
    t.point('unowned returned instance is stopped', action('StartOk', 11));
    await f.finishStop(1);
    await unloading;
    assert.equal(f.requests.get(22).status, 'failed');
    assert.equal(f.runtime.getServiceRegistrationStatus(type), 'unknown');
    t.point('unload and rejected load leave no type status', action('StopDone', 1), action('LateStopped', 11),
      action('Settle', 21), action('Settle', 22), action('AwaitUnload'), action('DrainUnload'));
  }, {owned: true});
  await scenario(siblings, 'failed-class-does-not-hide-or-restart-a-running-sibling', async (f, t) => {
    await f.register(12);
    t.point('late implementation registered', action('RegisterLate', 12));
    await ensure(f, t, 21);
    await f.startResult(11, false);
    t.point('failed implementation leaves caller waiting for its sibling', action('StartFail', 11));
    assert.equal(f.requests.get(21).status, 'pending');
    await f.startResult(12);
    t.point('successful sibling becomes reachable', action('StartOk', 12));
    await f.finishObserver(1);
    assert.equal(f.requests.get(21).value, 1);
    t.point('the original load returns the sibling', action('StartEvent', 12), action('Settle', 21));
    await ensure(f, t, 22);
    assert.equal(f.requests.get(22).value, 1);
    assert.equal(f.count(11), 1);
  });
  await scenario(siblings, 'one-real-eager-backoff-retries-the-failed-class', async (f, t) => {
    await f.initialize();
    t.point('real eager caller admits its initial start', action('Begin', 21), action('Ensure', 21));
    await f.startResult(11, false);
    t.point('source reports failure before the eager retry', action('StartFail', 11), action('Settle', 21));
    await f.waitForStart(11, 2);
    t.point('real backoff fires and the class restarts', action('Delay', 21), action('Ensure', 21));
    await f.startResult(11);
    t.point('the retried class publishes', action('StartOk', 11));
    await f.finishObserver(1);
    t.point('the retried class clears its failure mark', action('StartEvent', 11), action('Settle', 21));
  }, {owned: true});
  await scenario(design, 'publication-survives-synchronous-send-handler-failure', async (f, t) => {
    await ensure(f, t, 21);
    await f.startResult(11);
    const result = f.requests.get(21);
    assert.equal(result.status, 'ok');
    assert.equal(result.value, 1);
    assert.equal(f.runtime.getService(type), f.instances.get(1).instance);
    assert.equal(f.runtime.failedServiceClasses.size, 1);
    assert.equal(f.observers.size, 0);
    t.point('observed publication and successful public load', action('StartOk', 11), action('StartEvent', 11), action('Settle', 21));
    const observed = t.trace.steps.at(-1);
    divergence = structuredClone(t.trace);
    delete observed.expect['sourceState.failed'];
  }, {sendFailure: true});

  const assumptions = [
    'Actual AgentRuntime public service loads, plugin lifecycle, RuntimeServiceLifecycle and RuntimeRetirement run with synthetic service hooks and an isolated PGlite runtime. The shared SDK inputs are captured before execution.',
    'One type, two class identities and two ensure callers. Source microtasks between a hook result and the maps it updates are grouped into original action sequences. This checks selected schedules against the original design, without checking temporal fairness.',
    'The model abstracts raw caller outcomes, public lookup order, the remaining eager retry budget, and stop failure reporting. The handler-setup discrepancy is separately checked at the failed-class observation.',
  ];
  const shared = {modelPath, sources: compiled.sources, driverHashes: compiled.driverHashes, scope: 'bounded-orchestration', assumptions};
  const receipts = [];
  for (const [model, campaign] of traces) receipts.push(await checkTraces({...shared, model, traces: campaign}));

  const id = design+'PublicationDivergence';
  const out = 'test-results/quint-refinement/'+id+'.json';
  await assert.rejects(checkTraces({...shared, model: design, id, out, traces: [divergence]}),
    /Source\/model trace mismatch/);
  const mismatch = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(mismatch.results[0].kind, 'observation-mismatch');
  assert.equal(mismatch.driverInputsBound, true);
  return {receipts, mismatch};
}
