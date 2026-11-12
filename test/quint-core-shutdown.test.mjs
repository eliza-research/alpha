import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {modelStateInventory, unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../specs/quint/refinement/check-traces.mjs';
import {loadAgentRuntime} from '../specs/quint/refinement/services/core-runtime/module.mjs';

const action = (name, ...args) => ({name, args});
const flush = () => new Promise(setImmediate);
async function until(predicate, label) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}

async function fixture(module, {prepareFails = false, reentrant = false} = {}) {
  const runtime = new module.AgentRuntime({
    agentId: '00000000-0000-4000-8000-000000000001',
    runtimeInstanceId: '00000000-0000-4000-8000-000000000002',
    character: {name: 'Quint shutdown fixture', bio: [], plugins: []},
    fetch: async () => {throw Error('The shutdown fixture forbids external requests');},
  });
  const bestResults = new Map([1, 2, 3].map(id => [id, 'none']));
  let strictResult = 'none';
  let strictPromise;
  let reentrantPromise;
  let prepareCalls = 0;
  let stopCalls = 0;
  let serviceStop = 'none';
  let firstFast = false;
  let roomGate;
  let roomPromise;
  let turnSignal;
  let postGate;
  let postPromise;
  const stopGate = Promise.withResolvers();
  const service = {
    prepareStop() {
      prepareCalls++;
      assert.equal(runtime.getStopSignal().aborted, true, 'Admission closes before preparation');
      assert.ok(runtime.stopPromise, 'The stop identity is published before preparation');
      if (reentrant) reentrantPromise = runtime.stop({requireQuiescence: true});
      if (prepareFails) throw Error('Controlled preparation failure');
    },
    stop() {
      stopCalls++;
      return stopGate.promise;
    },
  };
  const serviceClass = {name: 'ShutdownFixture', serviceType: 'fixture', start: async () => service};
  await runtime.registerService(serviceClass);
  // This is the real startup helper used during initialization. It admits a
  // running service while the shared load handler still awaits its outer owner.
  await runtime._runServiceStart('fixture', 'fixture', serviceClass);
  runtime.registerEvent('quint-shutdown-event', async () => {});
  async function observe() {
    const operation = runtime.serviceLifecycle.stopOperations.get(service);
    if (operation && serviceStop === 'none') {
      serviceStop = 'pending';
      operation.then(() => {serviceStop = 'ok';}, () => {serviceStop = 'failed';});
    }
    await flush();
    assert.equal(runtime.stopRequested, runtime.getStopSignal().aborted);
    const published = runtime.services.get('fixture') ?? [];
    assert.ok(published.length <= 1);
    if (published.length) assert.equal(published[0], service, 'The registry retains the original service identity until teardown clears it');
    assert.ok(runtime.roomHandlerQueue.pendingTotal() <= 1);
    assert.ok(module.pendingPostDeliveryTaskCount(runtime) <= 1);
    return {
      's.requested': runtime.stopRequested, 's.stopped': runtime.stopped,
      's.inFlight': !!runtime.stopPromise, 's.fast': firstFast,
      's.strict': !!runtime.strictStopPromise, 's.strictResult': strictResult,
      's.bestResults': qmap(bestResults), 's.room': runtime.roomHandlerQueue.pendingTotal() === 1,
      's.turnAborted': runtime.turnControllers.hasActiveTurn('room') && !!turnSignal?.aborted,
      's.post': module.pendingPostDeliveryTaskCount(runtime) === 1,
      's.prepareFails': prepareFails, 's.prepareCalls': prepareCalls, 's.stopCalls': stopCalls,
      's.serviceStop': serviceStop, 's.servicePublished': published.length === 1, 's.lookup': runtime.serviceInstancesByClass.has(serviceClass),
      's.handler': runtime.servicePromiseHandlers.has('fixture'),
      's.eventHandler': !!runtime.getEvent('quint-shutdown-event')?.length,
      's.generation': runtime.retirement.generation, 's.failures': runtime.retirement.failures.length,
    };
  }
  return {
    runtime, observe, bestResults,
    init: action('initFor', prepareFails),
    get strictResult() {return strictResult;},
    get strictPromise() {return strictPromise;},
    get reentrantPromise() {return reentrantPromise;},
    async addRoom() {
      roomGate = Promise.withResolvers();
      roomPromise = runtime.roomHandlerQueue.withLease('room', async () => runtime.turnControllers.runWith('room', async signal => {
        turnSignal = signal;
        await roomGate.promise;
      }));
      await until(() => !!turnSignal, 'room turn admission');
    },
    async finishRoom() {roomGate.resolve(); await roomPromise; await flush();},
    async addPost() {
      postGate = Promise.withResolvers();
      postPromise = module.trackPostDeliveryTask(runtime, 'fixture', () => postGate.promise, {kind: 'diagnostic'});
      await flush();
    },
    async finishPost() {postGate.resolve(); await postPromise; await flush();},
    async best(id, fast = false) {
      if (!runtime.stopPromise && !runtime.stopped) firstFast = fast;
      bestResults.set(id, 'pending');
      runtime.stop({fast, serviceStopTimeoutMs: 1000}).then(
        () => bestResults.set(id, 'ok'), () => bestResults.set(id, 'failed'));
      await flush();
    },
    async strict(fast = false) {
      if (!runtime.stopPromise && !runtime.stopped && !runtime.strictStopPromise) firstFast = fast;
      const returned = runtime.stop({fast, requireQuiescence: true, serviceStopTimeoutMs: 1000});
      if (strictPromise) assert.equal(returned, strictPromise, 'Strict callers reuse one promise');
      else {
        strictPromise = returned;
        strictResult = 'pending';
        returned.then(() => {strictResult = 'ok';}, () => {strictResult = 'failed';});
      }
      await flush();
    },
    async finishService(success = true) {
      if (success) stopGate.resolve(); else stopGate.reject(Error('Controlled teardown failure'));
      await flush(); await flush();
    },
    async waitStopped() {await until(() => runtime.stopped && stopCalls === 1, 'service teardown');},
    async waitBest(id, result = 'ok') {await until(() => bestResults.get(id) === result, 'best-effort completion');},
    async waitStrict(result = 'ok') {await until(() => strictResult === result, 'strict completion');},
  };
}

async function runCoreRuntimeShutdownRefinement(extraSources = []) {
  const module = await loadAgentRuntime([fileURLToPath(import.meta.url), 'test/quint-core-shutdown.test.mjs', ...extraSources]);
  const traces = [];
  async function scenario(name, callback, options = {}) {
    const f = await fixture(module, options);
    const trace = {name, init: f.init, expect: await f.observe(), steps: []};
    const point = async (label, transition) => trace.steps.push({label, action: transition, expect: await f.observe()});
    await callback(f, point);
    assert.equal(f.runtime.retirement.pending.size, 0, 'Scenario settles its original retirement work');
    assert.equal(f.runtime.roomHandlerQueue.pendingTotal(), 0);
    assert.equal(module.pendingPostDeliveryTaskCount(f.runtime), 0);
    traces.push(trace);
  }
  const begin = async (f, point, {id = 1, strict = false, fast = false} = {}) => {
    if (strict) await f.strict(fast); else await f.best(id, fast);
    const actions = [strict ? action('beginStrict', fast) : action('beginBest', id, fast)];
    if (f.runtime.stopped) actions.push(action('startServices'));
    await point('stop admission publishes ownership and cancellation', actions);
  };
  const finish = async (f, point, {success = true, strict = false} = {}) => {
    await f.finishService(success);
    if (strict) await f.waitStrict(success ? 'ok' : 'failed'); else await f.waitBest(1);
    await point('service teardown and stop completion', [action('serviceSettled', success), action('finishBest', false), ...(strict ? [action('finishStrict')] : [])]);
  };
  await scenario('ordinary stop clears pending handlers and event registrations', async (f, point) => {
    await begin(f, point); await finish(f, point);
    await f.best(2); await point('repeated completed stop returns without another hook', action('beginBest', 2, false));
  });
  await scenario('concurrent ordinary callers share one teardown', async (f, point) => {
    await begin(f, point); await f.best(2); await point('concurrent caller joins', action('beginBest', 2, false));
    await finish(f, point);
  });
  await scenario('strict callers share a stable promise', async (f, point) => {
    await begin(f, point, {strict: true}); await f.strict(); await point('strict caller joins exact promise', action('beginStrict', false));
    await finish(f, point, {strict: true});
  });
  await scenario('strict stop joins an existing ordinary teardown', async (f, point) => {
    await begin(f, point); await f.strict(); await point('strict caller joins ordinary operation', action('beginStrict', false));
    await finish(f, point, {strict: true});
  });
  await scenario('a running room owns completion after its signal is aborted', async (f, point) => {
    await f.addRoom(); await point('room owner starts', action('addRoom'));
    await begin(f, point); assert.equal(f.runtime.roomHandlerQueue.isAcceptingAdmissions(), false);
    await assert.rejects(f.runtime.roomHandlerQueue.acquire('other'), {code: 'ROOM_HANDLER_QUEUE_CLOSED'});
    await f.finishRoom(); await f.waitStopped(); await point('room settlement allows teardown', [action('finishRoom'), action('startServices')]);
    await finish(f, point);
  });
  await scenario('ordinary stop drains diagnostic work before service teardown', async (f, point) => {
    await f.addPost(); await point('post-delivery work is tracked', action('addPost'));
    await begin(f, point); await f.finishPost(); await f.waitStopped();
    await point('post-delivery settlement releases teardown', [action('finishPost'), action('startServices')]);
    await finish(f, point);
  });
  await scenario('fast completion can precede original hook settlement and strict stop drains it', async (f, point) => {
    await f.addPost(); await point('diagnostic work is tracked', action('addPost'));
    await begin(f, point, {fast: true}); await f.waitBest(1);
    await point('fast timeout retains original retirement work', action('finishBest', true));
    await f.strict(true); await point('strict caller still waits', action('beginStrict', true));
    await f.finishService(); await point('original hook settles once', action('serviceSettled', true));
    await f.finishPost(); await f.waitStrict();
    await point('strict completion follows all observed work', [action('finishPost'), action('finishStrict')]);
  });
  await scenario('service stop failure remains visible to strict retirement', async (f, point) => {
    await begin(f, point, {strict: true}); await finish(f, point, {strict: true, success: false});
  });
  await scenario('preparation failure permits ordinary completion and rejects strict proof', async (f, point) => {
    await begin(f, point); await finish(f, point); await f.strict(); await f.waitStrict('failed');
    await point('retained preparation error rejects strict completion', [action('beginStrict', false), action('finishStrict')]);
  }, {prepareFails: true});
  await scenario('preparation can request strict shutdown reentrantly', async (f, point) => {
    await f.strict(); await f.waitStopped(); assert.equal(f.reentrantPromise, f.strictPromise);
    await point('strict identity exists before reentrant preparation', [action('beginStrict', false), action('startServices')]);
    await finish(f, point, {strict: true});
  }, {reentrant: true});
  await scenario('post-delivery API can accept later work after completed quiescence', async (f, point) => {
    await begin(f, point, {strict: true}); await finish(f, point, {strict: true});
    await f.addPost(); await point('later caller creates new work', action('addPost'));
    await f.strict(); await point('completed strict promise is retained', action('beginStrict', false));
    await f.finishPost(); await point('later work settles independently', action('finishPost'));
  });
  const previousRoomTimeout = process.env.ELIZA_FAST_ROOM_DRAIN_TIMEOUT_MS;
  process.env.ELIZA_FAST_ROOM_DRAIN_TIMEOUT_MS = '25';
  try {
    await scenario('fast room timeout retains a failure and ordinary shutdown can retry', async (f, point) => {
      await f.addRoom();
      await point('room owner starts', action('addRoom'));
      await begin(f, point, {fast: true});
      await f.waitBest(1, 'failed');
      await point('room timeout rejects the original caller', action('failRoomTimeout'));
      await f.finishRoom();
      await point('original room owner eventually settles', action('finishRoom'));
      await begin(f, point, {id: 2});
      await f.finishService();
      await f.waitBest(2);
      await point('ordinary retry completes without repeating preparation', [action('serviceSettled', true), action('finishBest', false)]);
    });
    await scenario('failed strict identity remains rejected after ordinary retry', async (f, point) => {
      await f.addRoom();
      await point('room owner starts', action('addRoom'));
      await begin(f, point, {strict: true, fast: true});
      await f.waitStrict('failed');
      await point('strict room timeout is retained', action('failRoomTimeout'));
      await f.finishRoom();
      await point('room owner settles later', action('finishRoom'));
      await f.strict();
      await point('later strict caller receives the same rejection', action('beginStrict', false));
      await begin(f, point);
      await f.finishService();
      await f.waitBest(1);
      await point('ordinary retry still performs original teardown', [action('serviceSettled', true), action('finishBest', false)]);
    });
  } finally {
    if (previousRoomTimeout === undefined) delete process.env.ELIZA_FAST_ROOM_DRAIN_TIMEOUT_MS;
    else process.env.ELIZA_FAST_ROOM_DRAIN_TIMEOUT_MS = previousRoomTimeout;
  }
  return checkTraces({model: 'CoreRuntimeShutdown', sources: module.sources, driverHashes: module.driverHashes,
    traces, scope: 'bounded-orchestration', assumptions: [
      'The real AgentRuntime, service lifecycle, retirement tracker, room queue, turn controller and post-delivery tracker execute. Compiled first-party and dependency bytes are captured before evaluation.',
      'One service is registered through registerService and started through the actual internal initialization helper. The fixture covers shutdown during initialization without inventing database readiness.',
      'One room owner, one diagnostic task and three ordinary callers bound the projection. Current SDK teardown clears the service lookup, per-class and promise registries while original stop promises remain independently observed.',
      'Strict completion establishes quiescence at settlement. The post-delivery API still accepts a later direct caller, and an already settled strict promise remains settled.',
      'Dynamic plugin registration, provider cancellation, initialization completion and full application-host shutdown remain separate campaigns.',
    ]});
}

test('actual AgentRuntime shutdown owns admission and strict retirement', async () => {
  const receipt = await runCoreRuntimeShutdownRefinement();
  assert.equal(receipt.traces, 13);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  const inventory = modelStateInventory(resolve('specs/quint/services/CoreRuntimeShutdown.qnt'), 'CoreRuntimeShutdown');
  assert.deepEqual(unobservedStateFields(inventory, receipt.observedFields), []);
});
