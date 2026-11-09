import assert from 'node:assert/strict';
import {qmap, qset} from '../../check-traces.mjs';

const services = [1, 2];
const slots = [5, 6, 7];
const agentId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const row = {id: taskId, agentId, name: 'SCHEDULER_REFINEMENT', tags: ['queue', 'repeat'],
  metadata: {updatedAt: 0, updateInterval: 1, blocking: true}};

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

export async function until(predicate) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), 'Actual source reached the controlled scheduler boundary');
}

export async function schedulerFixture(loaded) {
  const runtime = await loaded.newInstance();
  const timers = new Map(), queries = [], workers = [], runs = [], errors = [];
  runtime.installSchedulerClock({
    setInterval(callback, milliseconds) {
      assert.equal(milliseconds, 1000);
      const handle = Symbol('scheduler interval');
      timers.set(handle, callback);
      return handle;
    },
    clearInterval(handle) {assert.equal(timers.delete(handle), true);},
  });
  const adapters = new Map([3, 4].map(id => [id, {
    getTasks(request) {
      const gate = deferred();
      queries.push({adapter: id, request, gate});
      return gate.promise;
    },
  }]));
  const instances = new Map(services.map(id => {
    const worker = {async execute(_runtime, _options, task) {
      const gate = deferred();
      workers.push({service: id, task, gate});
      await gate.promise;
      return {preserveTask: true};
    }};
    const host = {agentId, logger: {debug() {}, info() {}, warn() {}, error() {}},
      reportError(scope, error) {errors.push({service: id, scope, code: error.code});},
      getTaskWorker(name) {return name === row.name ? worker : undefined;},
      getSetting() {}, getService() {return null;}, async getTask() {return row;}};
    const instance = new runtime.TaskService(host, {now: () => 100000,
      setTimeout() {throw Error('Daemon registration must not start a local timer');}, clearTimeout() {}});
    const runTick = instance.runTick.bind(instance);
    instance.runTick = async tasks => {
      const call = {service: id, tasks, settled: false};
      runs.push(call);
      try {await runTick(tasks);}
      finally {call.settled = true;}
    };
    return [id, instance];
  }));
  const instanceId = instance => [...instances].find(([, entry]) => entry === instance)?.[0] ?? 0;
  const adapterId = adapter => [...adapters].find(([, entry]) => entry === adapter)?.[0] ?? 0;
  const observedTicks = new Map();
  const current = () => runtime.observeScheduler();
  async function fire(slot) {
    const before = current();
    assert.equal(timers.size, 1);
    assert.ok(timers.has(before.timer));
    const count = queries.length;
    timers.get(before.timer)();
    const after = current();
    if (queries.length === count) {
      // A clean interval can attach a promise that immediately settles.
      // A callback with an existing owner does not attach a second promise.
      if (after.activeTick !== before.activeTick) await after.activeTick;
      return false;
    }
    assert.equal(queries.length, count + 1);
    assert.notEqual(after.activeTick, before.activeTick);
    const query = queries.at(-1);
    const entry = before.registry.find(([agent]) => agent === agentId)?.[1];
    assert.ok(entry);
    assert.deepEqual(query.request, {tags: ['queue'], agentIds: [agentId]});
    assert.equal(query.adapter, adapterId(before.adapter));
    const tick = {query, promise: after.activeTick, settled: false, generation: before.schedulerGeneration,
      registrationId: entry.registrationId, service: instanceId(entry.taskService), run: null};
    assert.ok(!observedTicks.has(slot) || observedTicks.get(slot).settled);
    observedTicks.set(slot, tick);
    tick.promise.then(() => {tick.settled = true;});
    return true;
  }
  async function finishQuery(slot, outcome) {
    const tick = observedTicks.get(slot);
    assert.ok(tick && !tick.settled);
    const beforeRuns = runs.length, beforeWorkers = workers.length;
    if (outcome === 'failure') tick.query.gate.reject(Error('controlled DB refusal'));
    else tick.query.gate.resolve(outcome === 'empty' ? [] : [row]);
    if (outcome === 'held') {
      await until(() => workers.length > beforeWorkers);
      assert.equal(workers.length, beforeWorkers + 1);
      assert.equal(runs.length, beforeRuns + 1);
      tick.run = runs.at(-1);
      tick.worker = workers.at(-1);
      assert.equal(tick.run.service, tick.service);
      assert.equal(tick.worker.service, tick.service);
      assert.deepEqual(tick.run.tasks, [row]);
      assert.equal(tick.worker.task, row);
    } else {
      await tick.promise;
      assert.equal(runs.length, beforeRuns);
      assert.equal(workers.length, beforeWorkers);
    }
  }
  async function finishRun(slot) {
    const tick = observedTicks.get(slot);
    assert.ok(tick?.worker && !tick.settled);
    tick.worker.gate.resolve();
    await tick.promise;
    assert.equal(tick.run.settled, true);
  }
  function observe() {
    const view = current();
    assert.equal(view.processTasks.length, 0, 'Literal profiles exclude process tasks');
    assert.ok(view.registry.every(([agent]) => agent === agentId));
    const entry = view.registry[0]?.[1];
    const active = [...observedTicks].find(([, tick]) => tick.promise === view.activeTick)?.[0] ?? 0;
    assert.equal(active === 0, view.activeTick === null);
    assert.equal(view.timer !== null, timers.size === 1);
    return {
      safety: true,
      'observed.registry': entry ? {svc: instanceId(entry.taskService), id: entry.registrationId} : {svc: 0, id: 0},
      'observed.nextId': view.nextRegistrationId,
      'observed.dirty': view.dirtyAgents.includes(agentId),
      'observed.timer': view.timer !== null,
      'observed.adapter': adapterId(view.adapter),
      'observed.activeTick': active,
      'observed.gen': view.schedulerGeneration,
      'observed.tk': qmap(slots.map(slot => {
        const tick = observedTicks.get(slot);
        return [slot, tick && !tick.settled
          ? {pc: tick.run ? 'run' : 'query', gen: tick.generation, id: tick.registrationId, svc: tick.service}
          : {pc: 'free', gen: 0, id: 0, svc: 0}];
      })),
      'observed.inRun': qmap(services.map(id => [id, runs.filter(call => call.service === id && !call.settled).length])),
      'observed.stopped': qmap(services.map(id => [id, instances.get(id).stopped])),
      'observed.busy': qset(view.busyServices.map(instanceId)),
    };
  }
  return {
    errors, queries, workers, runs, observe, fire, finishQuery, finishRun,
    start(id) {runtime.startTaskScheduler(adapters.get(id));},
    stop() {runtime.stopTaskScheduler();},
    register(id) {instances.get(id).startTimer();},
    stopService(id) {instances.get(id).prepareStop();},
    dirty(id) {instances.get(id).markDirty();},
    async close() {
      runtime.stopTaskScheduler();
      for (const query of queries) query.gate.resolve([]);
      for (const worker of workers) worker.gate.resolve();
      await Promise.all([...observedTicks.values()].map(tick => tick.promise));
      for (const service of instances.values()) await service.stop();
      assert.equal(timers.size, 0);
    },
  };
}
