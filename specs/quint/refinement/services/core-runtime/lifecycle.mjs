import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../../check-traces.mjs';
import {loadCoreRuntime} from './module.mjs';

const action = (name, ...args) => ({name, args});
const flush = () => new Promise(setImmediate);
const ids = [1, 2];

function fixture(module, options = {}) {
  const active = options.classes ?? ids;
  const initial = options.initial ?? [];
  const classes = new Map();
  const starts = new Map(ids.map(id => [id, 0]));
  const stops = new Map(ids.map(id => [id, 0]));
  const hookResults = new Map(ids.map(id => [id, 'unused']));
  const startGates = new Map();
  const stopGates = new Map();
  const instances = new Map();
  const emissions = new Map();
  const emitted = new Set();
  const callResults = new Map([1, 2, 3].map(id => [id, 'unused']));
  const callValues = new Map([1, 2, 3].map(id => [id, 0]));
  const observedStops = new Map();
  const reports = [];
  const init = Promise.withResolvers();
  let initReady = options.ready ?? true;
  let initOpen = options.open ?? false;
  const initFailed = options.initializationFailed ?? false;
  if (initReady) init.resolve();
  let stopRequested = false;
  let stopped = false;
  let handlerResult = 'pending';
  const servicePromise = Promise.withResolvers();
  servicePromise.promise.then(() => {handlerResult = 'resolved';}, () => {handlerResult = 'rejected';});
  const registries = {
    types: new Map(), instances: new Map(), startingClasses: new Map(),
    failedClasses: new Set(), startingTypes: new Map(), status: new Map(),
    handlers: new Map([['fixture', {resolve: servicePromise.resolve, reject: servicePromise.reject}]]),
    promises: new Map([['fixture', servicePromise.promise]]),
  };
  const makeInstance = id => ({
    id,
    stop() {
      stops.set(id, stops.get(id) + 1);
      const gate = Promise.withResolvers();
      stopGates.set(id, gate);
      return gate.promise;
    },
  });
  for (const id of ids) {
    classes.set(id, {
      name: `FixtureService${id}`,
      start() {
        starts.set(id, starts.get(id) + 1);
        hookResults.set(id, 'pending');
        const gate = Promise.withResolvers();
        startGates.set(id, gate);
        return gate.promise.then(value => {
          hookResults.set(id, value ? 'instance' : 'null');
          return value;
        }, error => {hookResults.set(id, 'rejected'); throw error;});
      },
      ...(options.sendFailure?.includes(id) ? {registerSendHandlers() {throw Error('Controlled send-handler failure');}} : {}),
    });
  }
  if (active.length) registries.types.set('fixture', active.map(id => classes.get(id)));
  for (const id of initial) {
    const instance = makeInstance(id);
    instances.set(id, instance);
    registries.instances.set(classes.get(id), instance);
  }
  const runtime = {
    agentId: 'fixture-agent', services: new Map(), initPromise: init.promise,
    logger: {warn() {}, error() {}},
    reportError(location, error) {reports.push({location, error});},
    emitEvent() {
      const candidates = [...registries.instances.values()].filter(instance => !emitted.has(instance) && !initial.includes(instance.id));
      assert.equal(candidates.length, 1, 'Each source emission belongs to one newly published instance');
      const instance = candidates[0];
      emitted.add(instance);
      const gate = Promise.withResolvers();
      emissions.set(instance.id, gate);
      return gate.promise.finally(() => emissions.delete(instance.id));
    },
  };
  if (initial.length) runtime.services.set('fixture', initial.map(id => instances.get(id)));
  registries.status.set('fixture', initial.length ? 'registered' : 'pending');
  const host = {
    stopRequested: () => stopRequested, stopped: () => stopped,
    initializationFailed: () => initFailed,
    runServiceStart: (...args) => lifecycle._runServiceStart(...args),
    resolveServiceTypeAlias: () => 'fixture',
    initResolver: () => initOpen ? init.resolve : undefined,
    serviceTypes: () => registries.types,
    serviceInstancesByClass: () => registries.instances,
    startingServiceClasses: () => registries.startingClasses,
    failedServiceClasses: () => registries.failedClasses,
    startingServices: () => registries.startingTypes,
    serviceRegistrationStatus: () => registries.status,
    servicePromiseHandlers: () => registries.handlers,
    servicePromises: () => registries.promises,
  };
  const retirement = new module.RuntimeRetirement();
  const lifecycle = new module.RuntimeServiceLifecycle(runtime, host, retirement);
  const classIds = values => [...values].map(value => [...classes].find(([, candidate]) => candidate === value)[0]);
  async function observe() {
    for (const [id, instance] of instances) {
      const operation = lifecycle.stopOperations.get(instance);
      if (operation && !observedStops.has(id)) {
        observedStops.set(id, 'pending');
        operation.then(() => observedStops.set(id, 'ok'), () => observedStops.set(id, 'failed'));
      }
    }
    await flush();
    const observed = {
      's.classes': qset(active), 's.initReady': initReady, 's.initOpen': initOpen, 's.initFailed': initFailed, 's.alias': !!options.alias,
      's.stopRequested': stopRequested, 's.stopped': stopped,
      's.instances': qset(classIds(registries.instances.keys())),
      's.starting': qset(classIds(registries.startingClasses.keys())),
      's.failed': qset(classIds(registries.failedClasses)), 's.observers': qset(emissions.keys()),
      's.startCalls': qmap(starts), 's.hookResults': qmap(hookResults),
      's.stopOps': qmap(ids.map(id => [id, observedStops.get(id) ?? 'none'])), 's.stopCalls': qmap(stops),
      's.results': qmap(callResults), 's.values': qmap(callValues),
      's.status': registries.status.get('fixture'),
      's.handler': registries.handlers.has('fixture') ? 'pending' : handlerResult,
      's.servicePromise': registries.promises.has('fixture'), 's.startingType': registries.startingTypes.has('fixture'),
      's.generation': retirement.generation, 's.retirementFailures': retirement.failures.length,
      's.observerFailures': reports.filter(report => report.location === 'AgentRuntime.serviceStartedObserver').length,
    };
    assert.deepEqual((runtime.services.get('fixture') ?? []).map(instance => instance.id), [...registries.instances.keys()].map(cls => [...classes].find(([, candidate]) => candidate === cls)[0]).sort(), 'Registry order follows class registration order');
    return observed;
  }
  return {
    lifecycle, retirement, registries, instances, starts, stops, emissions, callResults, observe,
    init: action('initFor', qset(active), initReady, initOpen, qset(initial), !!options.alias, initFailed),
    async ensure(id) {
      lifecycle._ensureServiceStarted(options.alias ? 'alias' : 'fixture').then(value => {
        callResults.set(id, value ? 'ok' : 'null'); callValues.set(id, value?.id ?? 0);
      }, () => {callResults.set(id, 'failed');});
      callResults.set(id, 'barrier');
      await flush();
      if (callResults.get(id) === 'barrier' && registries.startingTypes.has('fixture')) callResults.set(id, 'waiting');
    },
    async ready() {
      initReady = true; initOpen = false; init.resolve(); await flush();
      for (const [id, result] of callResults) if (result === 'barrier') callResults.set(id, 'waiting');
    },
    requestStop(value = true) {stopRequested = true; stopped = value;},
    async returnStart(id, result = 'instance') {
      const gate = startGates.get(id);
      assert.ok(gate, 'The source must have admitted this start');
      if (result === 'rejected') gate.reject(Error('Controlled start failure'));
      else if (result === 'null') gate.resolve(null);
      else {
        const instance = makeInstance(id);
        instances.set(id, instance);
        gate.resolve(instance);
      }
      await flush();
    },
    async finishObserver(id, fail = false) {
      const gate = emissions.get(id);
      assert.ok(gate, 'The source must publish before its observer can settle');
      if (fail) gate.reject(Error('Controlled observer failure'));
      else gate.resolve();
      await flush();
    },
    async beginStop(id) {void lifecycle._stopServiceInstance('fixture', instances.get(id), 'fixture'); await flush();},
    async finishStop(id, success = true) {
      const gate = stopGates.get(id);
      assert.ok(gate);
      if (success) gate.resolve(); else gate.reject(Error('Controlled stop failure'));
      await flush();
    },
    async invalidStop(value) {await lifecycle._stopServiceInstance('fixture', value, 'fixture'); await flush();},
  };
}

export async function runCoreServiceLifecycleRefinement(extraSources = []) {
  const module = await loadCoreRuntime([fileURLToPath(import.meta.url), 'test/quint-core-service-lifecycle.test.mjs', ...extraSources]);
  const traces = [];
  async function scenario(name, callback, options = {}) {
    const f = fixture(module, options);
    const trace = {name, init: f.init, expect: await f.observe(), steps: []};
    const point = async (label, transition) => trace.steps.push({label, action: transition, expect: await f.observe()});
    await callback(f, point);
    assert.equal(f.registries.startingClasses.size, 0, 'Every source schedule settles its starts');
    assert.equal(f.emissions.size, 0, 'Every source schedule settles its observers');
    assert.equal(f.retirement.pending.size, 0, 'Every source schedule drains its admitted work');
    traces.push(trace);
  }
  const begin = async (f, point, id = 1) => {
    const before = await f.observe();
    await f.ensure(id);
    const actions = [action('beginEnsure', id)];
    if (!before['s.stopRequested']) {
      actions.push(action('admitEnsure', id));
      if (f.callResults.get(id) === 'ok' && !before['s.initOpen']) actions.push(action('completeEnsure', id));
    }
    await point('service admission', actions);
  };
  const publish = async (f, point, id) => {await f.returnStart(id); await point('instance published before observer settles', action('returned', id, 'instance', false));};
  const complete = async (f, point, id, callers = [1], fail = false) => {
    await f.finishObserver(id, fail);
    await point('observer settles and waiting callers complete', [action('settled', id, true, fail), ...callers.map(caller => action('completeEnsure', caller))]);
  };
  await scenario('registration order wins when implementations finish backwards', async (f, point) => {
    await begin(f, point); await publish(f, point, 2); await complete(f, point, 2, []);
    await publish(f, point, 1); await complete(f, point, 1);
  });
  await scenario('concurrent ensures share class starts', async (f, point) => {
    await begin(f, point); await begin(f, point, 2); await publish(f, point, 1); await complete(f, point, 1, []);
    await publish(f, point, 2); await complete(f, point, 2, [1, 2]);
  });
  await scenario('one failed implementation leaves the shared load pending until a sibling succeeds', async (f, point) => {
    await begin(f, point); await f.returnStart(1, 'rejected');
    await point('first implementation rejects', [action('returned', 1, 'rejected', false), action('settled', 1, false, false)]);
    await publish(f, point, 2); await complete(f, point, 2);
    await begin(f, point, 2); await point('failed sibling is skipped after another implementation is running', null);
  });
  for (const result of ['rejected', 'null']) {
    await scenario(`all implementations ${result} and a later caller retries`, async (f, point) => {
      await begin(f, point); await f.returnStart(1, result);
      await point('first attempt fails', [action('returned', 1, result, false), action('settled', 1, false, false), action('completeEnsure', 1)]);
      await begin(f, point, 2); await publish(f, point, 1); await complete(f, point, 1, [2]);
    }, {classes: [1]});
  }
  await scenario('observer rejection leaves the published service usable', async (f, point) => {
    await begin(f, point); await publish(f, point, 1); await complete(f, point, 1, [1], true);
  }, {classes: [1]});
  await scenario('send-handler failure retains the already published instance', async (f, point) => {
    await begin(f, point); await f.returnStart(1);
    await point('published instance survives send-handler rejection', [action('returned', 1, 'instance', true), action('settled', 1, false, false), action('completeEnsure', 1)]);
  }, {classes: [1], sendFailure: [1]});
  await scenario('an alias resolves the canonical load handler after all starts settle', async (f, point) => {
    await begin(f, point); await f.returnStart(1, 'rejected');
    await point('alias failure reports against its original name', [action('returned', 1, 'rejected', false), action('settled', 1, false, false)]);
    await publish(f, point, 2); await complete(f, point, 2);
  }, {alias: true});
  await scenario('initialization barrier defers starts', async (f, point) => {
    await f.ensure(1); await point('caller waits for initialization', action('beginEnsure', 1));
    await f.ready(); await point('initialization releases service admission', [action('ready'), action('admitEnsure', 1)]);
    await publish(f, point, 1); await complete(f, point, 1);
  }, {classes: [1], ready: false});
  await scenario('already running service bypasses an open initialization barrier', async (f, point) => {
    await begin(f, point);
  }, {classes: [1], initial: [1], ready: false, open: true});
  await scenario('shutdown during initialization refuses the waiting caller', async (f, point) => {
    await f.ensure(1); await point('caller waits for initialization', action('beginEnsure', 1));
    f.requestStop(); await point('shutdown owns admission', action('requestStop', true));
    await f.ready(); await point('released caller observes shutdown', [action('ready'), action('admitEnsure', 1)]);
  }, {classes: [1], ready: false});
  await scenario('failed initialization refuses service admission', async (f, point) => {await begin(f, point);}, {classes: [1], initializationFailed: true});
  await scenario('missing service type returns null', async (f, point) => {await begin(f, point);}, {classes: []});
  for (const success of [true, false]) {
    await scenario(`late start is stopped before rejection with teardown ${success ? 'success' : 'failure'}`, async (f, point) => {
      await begin(f, point); f.requestStop(); await point('shutdown begins while start is pending', action('requestStop', true));
      await f.returnStart(1); await point('late instance enters tracked teardown', action('returned', 1, 'instance', false));
      await f.finishStop(1, success);
      await point('late teardown settles before caller failure', [action('finishStop', 1, success), action('settled', 1, false, false), action('completeEnsure', 1)]);
      await begin(f, point, 2);
    }, {classes: [1]});
  }
  for (const success of [true, false]) {
    await scenario(`stop identity deduplicates calls after ${success ? 'success' : 'failure'}`, async (f, point) => {
      await f.beginStop(1); await point('first caller publishes one stop operation', action('beginStop', 1));
      await f.beginStop(1); await point('concurrent caller joins the stop operation', action('beginStop', 1));
      await f.finishStop(1, success); await point('stop hook settles', action('finishStop', 1, success));
      await f.beginStop(1); await point('later caller reuses the settled operation', action('beginStop', 1));
    }, {classes: [1], initial: [1]});
  }
  await scenario('null and missing stop hooks retain teardown failures', async (f, point) => {
    await f.invalidStop(null); await point('null service is recorded', action('invalidStop'));
    await f.invalidStop({}); await point('missing stop hook is recorded', action('invalidStop'));
  }, {classes: []});
  return checkTraces({model: 'CoreServiceLifecycle', sources: module.sources, driverHashes: module.driverHashes,
    traces, scope: 'bounded-orchestration', assumptions: [
      'The real RuntimeServiceLifecycle and RuntimeRetirement execute with their actual maps, sets, WeakMap identities, promises and error implementation.',
      'Two registered implementations, three ensure callers and controlled service hook promises bound this projection. Host registry ownership, initialization and stop flags are explicit inputs.',
      'Observer publication and returned service promises are observed separately. Microtasks between hook settlement and class-map cleanup form the declared settlement macrostep.',
      'The current SDK host delegates class startup back to the real lifecycle method and exposes initialization failure explicitly. Eager-start retry timers, dynamic registration, reentrant observer callbacks and the AgentRuntime shutdown coordinator need separate source campaigns.',
    ]});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const receipt = await runCoreServiceLifecycleRefinement();
  console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints, passed: receipt.passed}));
}
