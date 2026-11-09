import assert from 'node:assert/strict';
import {qmap, qset} from '../../check-traces.mjs';
import {until} from './fixture.mjs';

const agentKeys = new Map([1, 2, 3].map(id => [id, `00000000-0000-4000-8000-00000000000${id}`]));
const serviceAgents = new Map([[1, 1], [2, 2], [3, 1]]);
const processNames = new Map([[1, 'work'], [2, 'work'], [3, 'other']]);
const taskRows = new Map([1, 2, 3, 4, 5, 6].map((id, index) => [id, {
  id: `00000000-0000-4000-8000-00000000001${id}`,
  ...(id === 5 ? {} : {agentId: agentKeys.get([1, 1, 2, 2, 0, 3][index])}),
  name: 'SCHEDULER_RUNTIME', tags: ['queue', 'repeat'],
  metadata: {updatedAt: 0, updateInterval: 1, blocking: true},
}]));
const slots = [1, 2, 3];
const taskIds = new Map([...taskRows].map(([id, row]) => [row.id, id]));
const map = (ids, select) => qmap([...ids].map(id => [id, select(id)]));
const lookup = (values, value) => [...values].find(([, entry]) => entry === value)?.[0] ?? 0;
const waitTurn = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
}

export async function runtimeSchedulerFixture(loaded) {
  const runtime = await loaded.newInstance(), timers = new Map();
  const queries = [], runs = [], workers = [], reports = [], processCalls = [];
  const ticks = new Map(), processes = new Map();
  const transientTicks = new Set();
  runtime.installSchedulerClock({
    setInterval(callback, milliseconds) {
      assert.equal(milliseconds, 1000);
      const handle = Symbol('shared scheduler interval');
      timers.set(handle, callback);
      return handle;
    },
    clearInterval(handle) {assert.equal(timers.delete(handle), true);},
  });
  const adapters = new Map([1, 2].map(id => [id, {
    getTasks(request) {
      const gate = deferred();
      const agents = request.agentIds.map(key => lookup(agentKeys, key));
      assert.deepEqual(request.tags, ['queue']);
      assert.ok(agents.length && new Set(agents).size === agents.length && agents.every(agent => agent === 1 || agent === 2));
      queries.push({adapter: id, agents, gate});
      return gate.promise;
    },
  }]));
  const inspect = () => runtime.observeScheduler();
  const instances = new Map([...serviceAgents].map(([id, agent]) => {
    const worker = {async execute(_runtime, _options, row) {
      const active = runs.filter(call => call.service === id && !call.settled);
      assert.equal(active.length, 1, 'Source service has one actual daemon call owner');
      const gate = deferred(), job = {run: active[0], row: taskIds.get(row.id), gate};
      assert.ok(job.row);
      workers.push(job);
      await gate.promise;
      return {preserveTask: true};
    }};
    const host = {agentId: agentKeys.get(agent), logger: {debug() {}, info() {}, warn() {}, error() {}},
      reportError(scope, error) {reports.push({service: id, scope, code: error.code});},
      getTaskWorker(name) {return name === 'SCHEDULER_RUNTIME' ? worker : undefined;},
      getSetting() {}, getService() {return null;},
      async getTask(id) {return [...taskRows.values()].find(row => row.id === id) ?? null;},
      async patchTaskMetadata() {return 'updated';}};
    const service = new runtime.TaskService(host, {now: () => 100000,
      setTimeout() {throw Error('Daemon service must use shared timer');}, clearTimeout() {}});
    const actualRunTick = service.runTick.bind(service);
    service.runTick = async rows => {
      const promise = inspect().activeTick;
      const slot = [...ticks].find(([, tick]) => tick.promise === promise)?.[0];
      assert.ok(slot, 'Actual dispatch has attached owning tick');
      const call = {slot, service: id, agent, rows: rows.map(row => taskIds.get(row.id)), settled: false};
      assert.ok(call.rows.every(id => id !== undefined), 'Actual group contains only supplied task identities');
      runs.push(call);
      try {await actualRunTick(rows);}
      finally {call.settled = true;}
    };
    return [id, service];
  }));
  function fire(slot) {
    const before = inspect();
    assert.equal(timers.size, 1);
    assert.ok(timers.has(before.timer));
    const count = queries.length;
    timers.get(before.timer)();
    const after = inspect();
    if (queries.length === count) {
      if (after.activeTick && before.activeTick !== after.activeTick) {
        const pending = after.activeTick;
        transientTicks.add(pending);
        void pending.then(() => transientTicks.delete(pending));
      }
      return null;
    }
    assert.equal(queries.length, count + 1);
    assert.ok(!ticks.has(slot) || ticks.get(slot).settled);
    const query = queries.at(-1);
    const cohort = new Map(query.agents.map(agent => {
      const entry = before.registry.find(([key]) => key === agentKeys.get(agent))?.[1];
      assert.ok(entry, 'Queried agent has a captured registration');
      return [agent, {service: lookup(instances, entry.taskService), id: entry.registrationId}];
    }));
    const tick = {query, cohort, promise: after.activeTick, generation: before.schedulerGeneration, settled: false};
    ticks.set(slot, tick);
    void tick.promise.then(() => {tick.settled = true;});
    return query;
  }
  async function respond(slot, rows) {
    const tick = ticks.get(slot), before = runs.length;
    assert.ok(tick && !tick.settled);
    if (rows === null) tick.query.gate.reject(Error('controlled DB refusal'));
    else tick.query.gate.resolve(rows.map(id => taskRows.get(id)));
    await until(() => tick.settled || runs.length > before);
    if (!tick.settled) await until(() => workers.some(job => job.run === runs.at(-1)));
  }
  async function finishGroup(slot, fail = false) {
    const run = runs.findLast(call => call.slot === slot && !call.settled);
    assert.ok(run);
    const before = runs.length;
    for (const [index] of run.rows.entries()) {
      await until(() => workers.filter(job => job.run === run).length > index);
      const gate = workers.filter(job => job.run === run)[index].gate;
      if (fail && index === 0) gate.reject(Error('controlled worker failure'));
      else gate.resolve();
    }
    await until(() => ticks.get(slot).settled || runs.length > before);
    if (!ticks.get(slot).settled) await until(() => workers.some(job => job.run === runs.at(-1)));
  }
  function registerProcess(id) {
    const name = processNames.get(id);
    const dispose = runtime.registerScheduledProcessTask(name, async signal => {
      const gate = deferred();
      processCalls.push({id, signal, gate});
      await gate.promise;
    });
    const raw = inspect().processTasks.find(([key]) => key === name)[1];
    processes.set(id, {dispose, raw, pending: null, returned: false});
  }
  function disposeProcess(id) {
    const entry = processes.get(id);
    const pending = entry.dispose();
    if (entry.pending === null) {
      entry.pending = pending;
      void pending.then(() => {entry.returned = true;});
    }
    return pending;
  }
  async function finishProcess(id, fail = false) {
    const call = processCalls.findLast(entry => entry.id === id);
    assert.ok(call && processes.get(id).raw.active);
    if (fail) call.gate.reject(Error('controlled process failure'));
    else call.gate.resolve();
    await until(() => processes.get(id).raw.active === undefined);
  }
  function observe() {
    const view = inspect();
    const active = [...ticks].find(([, tick]) => tick.promise === view.activeTick)?.[0] ?? 0;
    assert.ok(active || view.activeTick === null || transientTicks.has(view.activeTick));
    assert.equal(view.timer !== null, timers.size === 1);
    const reportCount = (service, scope) => reports.filter(report => report.service === service && report.scope === scope).length;
    const owner = name => {
      const entry = view.processTasks.find(([key]) => key === name)?.[1];
      return [...processes].find(([, process]) => process.raw === entry)?.[0] ?? 0;
    };
    const noEntry = {service: 0, id: 0};
    return {
      's.generation': view.schedulerGeneration, 's.nextId': view.nextRegistrationId,
      's.adapter': lookup(adapters, view.adapter), 's.timer': view.timer !== null, 's.active': active,
      's.dirty': qset(view.dirtyAgents.map(key => lookup(agentKeys, key))),
      's.registry': map([1, 2], id => {
        const entry = view.registry.find(([key]) => key === agentKeys.get(id))?.[1];
        return entry ? {service: lookup(instances, entry.taskService), id: entry.registrationId} : noEntry;
      }),
      's.stopped': map(serviceAgents.keys(), id => instances.get(id).stopped),
      's.busy': qset(view.busyServices.map(service => lookup(instances, service))),
      's.scopeReports': map(serviceAgents.keys(), id => reportCount(id, 'TaskScheduler.scope')),
      's.queryReports': map(serviceAgents.keys(), id => reportCount(id, 'TaskScheduler.query')),
      's.runReports': map(serviceAgents.keys(), id => reportCount(id, 'TaskScheduler.runTick')),
      TickPhase: map(slots, slot => {
        const tick = ticks.get(slot);
        if (!tick || tick.settled) return 'free';
        return runs.some(call => call.slot === slot && !call.settled) ? 'running' : 'query';
      }),
      TickGeneration: map(slots, slot => ticks.get(slot)?.settled === false ? ticks.get(slot).generation : 0),
      TickAdapter: map(slots, slot => ticks.get(slot)?.settled === false ? ticks.get(slot).query.adapter : 0),
      TickCohort: map(slots, slot => map([1, 2], id => ticks.get(slot)?.settled === false
        ? ticks.get(slot).cohort.get(id) ?? noEntry : noEntry)),
      TickService: map(slots, slot => runs.findLast(call => call.slot === slot && !call.settled)?.service ?? 0),
      TickRows: map(slots, slot => runs.findLast(call => call.slot === slot && !call.settled)?.rows ?? []),
      's.processOwners': map([1, 2], key => owner(key === 1 ? 'work' : 'other')),
      ProcessExists: map(processNames.keys(), id => processes.has(id)),
      ProcessAborted: map(processNames.keys(), id => processes.get(id)?.raw.controller.signal.aborted ?? false),
      ProcessActive: map(processNames.keys(), id => processes.get(id)?.raw.active !== undefined),
      ProcessReturned: map(processNames.keys(), id => processes.get(id)?.returned ?? false),
      ProcessCalls: map(processNames.keys(), id => processCalls.filter(call => call.id === id).length),
    };
  }
  return {
    queries, runs, workers, reports, processCalls, observe, fire, respond, finishGroup,
    registerProcess, disposeProcess, finishProcess, waitTurn,
    start(id) {runtime.startTaskScheduler(adapters.get(id));},
    stop() {runtime.stopTaskScheduler();},
    register(id) {instances.get(id).startTimer();},
    stopService(id) {instances.get(id).prepareStop();},
    dirty(id) {instances.get(id).markDirty();},
    async close() {
      runtime.stopTaskScheduler();
      const pending = [...processes.keys()].map(disposeProcess);
      for (const query of queries) query.gate.resolve([]);
      for (const call of processCalls) call.gate.resolve();
      for (let index = 0; index < 10 && runs.some(call => !call.settled); index++) {
        for (const worker of workers) worker.gate.resolve();
        await waitTurn();
      }
      await Promise.all([...ticks.values()].map(tick => tick.promise).concat(pending));
      for (const service of instances.values()) await service.stop();
      assert.equal(timers.size, 0);
    },
  };
}
