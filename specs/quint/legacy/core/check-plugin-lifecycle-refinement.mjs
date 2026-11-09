import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {setImmediate as tick} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../../refinement/check-traces.mjs';
import {loadAgentRuntime} from '../../refinement/services/core-runtime/module.mjs';
import {loadTaskService} from '../../refinement/services/task-service/module.mjs';

const model = 'CorePluginLifecycle';
const registration = model+'Register';
const services = model+'Services';
const modelPath = 'specs/quint/legacy/'+model+'.qnt';
const tla = 'vendor/eliza/packages/core/tla/PluginLifecycle';
const pluginA = 'quint-plugin-lifecycle-a', pluginB = 'quint-plugin-lifecycle-b';
const type = 'quint-plugin-lifecycle-service', source = 'quint-plugin-lifecycle-connector';
const classes = [1, 2], unloaders = [11, 12], registrars = [51, 52];
const action = (name, ...args) => ({name: 'source'+name, args});
const connector = label => ({source, label, sendHandler: async () => {
  throw Error('Plugin lifecycle fixtures do not dispatch messages');
}});
const denyFetch = async () => {throw Error('Plugin lifecycle fixtures forbid external requests');};
const map = (keys, project) => qmap(keys.map(key => [key, project(key)]));

function track(promise, completed = 'done') {
  const outcome = {promise, state: 'pending'};
  outcome.settled = promise.then(value => {
    outcome.state = completed;
    outcome.value = value;
  }, error => {
    outcome.state = 'err';
    outcome.error = error;
  });
  return outcome;
}

function schedule(name, observe) {
  const trace = {name, expect: observe(), steps: []};
  return {trace, point(label, ...actions) {
    const step = {label, action: actions.length ? actions : null, expect: observe()};
    trace.steps.push(step);
    return step;
  }};
}

async function serviceFixture(sql, profile, lateConnector) {
  const database = await sql.createIsolatedTestDatabase('quint-plugin-lifecycle-'+randomUUID(), [], {postgresUrl: null});
  const runtime = database.runtime;
  runtime.fetch = denyFetch;
  const dispose = Promise.withResolvers();
  let disposeCalls = 0;
  const start = new Map(classes.map(id => [id, Promise.withResolvers()]));
  const runs = new Map(classes.map(id => {
    const stop = Promise.withResolvers();
    const record = {id, stop, calls: 0, returned: false, closed: false, attempts: 0};
    record.instance = {async stop() {
      record.calls++;
      try {await stop.promise;}
      finally {record.closed = true;}
    }};
    return [id, record];
  }));
  const definitions = new Map(classes.map(id => [id, {
    name: 'FixtureService'+id, serviceType: type, allowsMultiple: true,
    async start(owner) {
      const record = runs.get(id);
      record.attempts++;
      await start.get(id).promise;
      if (lateConnector && id === 1) owner.registerMessageConnector(connector('A'));
      record.returned = true;
      return record.instance;
    },
    registerSendHandlers(owner) {owner.registerMessageConnector(connector('A'));},
  }]));
  const removal = new Map();
  const classId = value => {
    const found = [...definitions].find(([, definition]) => value === definition);
    assert.ok(found, 'Only the two reviewed service classes may appear');
    return found[0];
  };
  const instanceId = value => {
    if (!value) return 0;
    const found = [...runs].find(([, run]) => value === run.instance);
    assert.ok(found, 'Only actual fixture instances may appear');
    return found[0];
  };
  const owns = name => runtime.getPluginOwnership(name);
  const ownsConnector = name => Boolean(owns(name)?.messageConnectors.some(entry => entry.source === source && !entry.accountId));
  const slots = Array.from({length: profile === services ? 6 : 4}, (_, index) => index+1);
  const observe = () => ({
    'sourceState.pluginsA': runtime.plugins.some(plugin => plugin.name === pluginA),
    'sourceState.owned': Boolean(owns(pluginA)),
    'sourceState.disposeCalls': disposeCalls,
    'sourceState.types': qset((runtime.serviceTypes.get(type) ?? []).map(classId)),
    'sourceState.byClass': map(classes, id => instanceId(runtime.serviceInstancesByClass.get(definitions.get(id)))),
    sourceStartingClasses: qset(classes.filter(id => runtime.startingServiceClasses.has(definitions.get(id)))),
    'sourceState.failedC': qset(classes.filter(id => runtime.failedServiceClasses.has(definitions.get(id)))),
    'sourceState.services': qset(runtime.getServicesByType(type).map(instanceId)),
    'sourceState.live': qset(classes.filter(id => runs.get(id).returned && !runs.get(id).closed)),
    'sourceState.stopCalls': map(slots, id => runs.get(id)?.calls ?? 0),
    'sourceState.stopOps': qset(classes.filter(id => runtime.serviceLifecycle.stopOperations.has(runs.get(id).instance))),
    'sourceState.stopRequested': runtime.stopRequested,
    'sourceState.registry': runtime.getMessageConnectors().find(entry => entry.source === source)?.label ?? 'none',
    ...(owns(pluginA) ? {'sourceState.ownsA': ownsConnector(pluginA)} : {}),
    'sourceState.ownsB': ownsConnector(pluginB),
    sourceUnloadOutcomes: map(unloaders, id => removal.get(id)?.state ?? 'idle'),
    ...(profile === services ? {safety: true} : {}),
  });
  async function cleanup() {
    dispose.resolve();
    for (const gate of start.values()) gate.resolve();
    for (const record of runs.values()) record.stop.resolve();
    try {await runtime.stop();}
    finally {await database.cleanup();}
  }
  try {
    await runtime.initialize({skipMigrations: true});
    await runtime.registerPlugin({
      name: pluginA, services: [...definitions.values()],
      async dispose() {disposeCalls++; await dispose.promise;},
    });
    if (profile === services) {
      for (const gate of start.values()) gate.resolve();
      await runtime.getServiceLoadPromise(type);
    }
    await tick();
    assert.deepEqual(classes.map(id => runs.get(id).attempts), [1, 1]);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    runtime, dispose, start, runs, removal, observe, cleanup,
    unload(id) {removal.set(id, track(runtime.unloadPlugin(pluginA)));},
    registerRival() {
      return runtime.registerPlugin({name: pluginB, async init(_configuration, owner) {
        owner.registerMessageConnector(connector('B'));
      }});
    },
  };
}

function recordedDifference(differences, name, profile, trace, field) {
  const mismatch = structuredClone(trace);
  mismatch.name = name;
  const step = trace.steps.at(-1);
  assert.ok(Object.hasOwn(step.expect, field));
  delete step.expect[field];
  differences.push({name, profile, trace: mismatch});
}

export async function checkPluginLifecycleRefinement(extraSources = []) {
  const inputs = [fileURLToPath(import.meta.url), ...extraSources,
    'vendor/eliza/packages/core/test/plugin-lifecycle-model.test.ts',
    ...['.tla', '.inflight.cfg', '.register.cfg', '.services.cfg'].map(extension => tla+extension)];
  const core = await loadAgentRuntime(inputs);
  const sql = await loadTaskService(inputs);
  const campaigns = new Map([[model, []], [registration, []], [services, []]]);
  const differences = [];

  for (const fail of [false, true]) {
    const runtime = new core.AgentRuntime({character: {name: 'Quint plugin registration', bio: []},
      logLevel: 'fatal', fetch: denyFetch});
    const init = Promise.withResolvers(), rollback = Promise.withResolvers();
    const outcomes = new Map();
    const refusal = Error('Synthetic plugin init refused');
    const rollbackError = Error('Synthetic rollback hook refused');
    const initConnect = 'quint-plugin-init-connector';
    let initCalls = 0, rollbackCalls = 0;
    const plugin = {
      name: pluginA,
      async init(_configuration, owner) {
        initCalls++;
        if (fail) owner.registerMessageConnector({...connector('A'), source: initConnect});
        await init.promise;
        if (fail) throw refusal;
      },
      async dispose() {
        rollbackCalls++;
        await rollback.promise;
        throw rollbackError;
      },
    };
    const t = schedule(fail ? 'join_preserves_original_init_error_after_rollback' : 'join_shares_successful_registration', () => ({
      'sourceState.pluginsA': runtime.plugins.some(plugin => plugin.name === pluginA),
      'sourceState.owned': Boolean(runtime.getPluginOwnership(pluginA)),
      sourceRegistrationOutcomes: map(registrars, id => outcomes.get(id)?.state ?? 'idle'),
      safety: true,
    }));
    try {
      outcomes.set(51, track(runtime.registerPlugin(plugin), 'ok'));
      t.point('first registration holds init', action('Register', 51));
      outcomes.set(52, track(runtime.registerPlugin(plugin), 'ok'));
      assert.equal(outcomes.get(52).promise, outcomes.get(51).promise);
      assert.equal(initCalls, 1);
      t.point('second registration joins the exact in-flight promise', action('Register', 52));
      init.resolve();
      if (fail) {
        await tick();
        assert.equal(rollbackCalls, 1);
        assert.equal(runtime.getMessageConnectors().find(entry => entry.source === initConnect)?.label, 'A');
        assert.equal(runtime.plugins.some(plugin => plugin.name === pluginA), false);
        assert.ok([...outcomes.values()].every(result => result.state === 'pending'));
        t.point('plugin list entry withdrawn while rollback and both promises remain pending');
        recordedDifference(differences, 'PluginRegistrationRollbackVisibility', registration, t.trace, 'sourceState.pluginsA');
        rollback.resolve();
      }
      await Promise.all([...outcomes.values()].map(result => result.settled));
      assert.ok([...outcomes.values()].every(result => fail ? result.error === refusal : result.state === 'ok'));
      if (fail) assert.equal(runtime.getMessageConnectors().some(entry => entry.source === initConnect), false);
      t.point('both callers settle with the original outcome', action('RegisterInit', 51, fail), action('RegisterJoin', 52));
      campaigns.get(registration).push(t.trace);
    } finally {
      init.resolve();
      rollback.resolve();
      await Promise.all([...outcomes.values()].map(result => result.settled));
      await runtime.stop();
    }
  }

  for (const lateConnector of [false, true]) {
    const f = await serviceFixture(sql, model, lateConnector);
    const t = schedule(lateConnector ? 'late_start_cannot_republish_connector' : 'unload_withdraws_held_starts_and_rejects_later_load', f.observe);
    try {
      f.unload(11);
      t.point('owner holds the dispose hook', action('Unload', 11));
      f.unload(12);
      assert.equal(f.removal.get(12).promise, f.removal.get(11).promise);
      t.point('second unload joins without disposing again', action('Unload', 12));
      f.dispose.resolve();
      await tick();
      t.point('class withdrawal precedes the wait for starts', action('Dispose', 11));
      await assert.rejects(f.runtime.getServiceLoadPromise(type), /not found or failed to start/);
      t.point('public load cannot restart the withdrawn classes', action('Load', 21), action('LoadBegin', 21));
      f.start.get(1).resolve();
      await tick();
      assert.equal(f.runs.get(1).calls, 1);
      assert.equal(f.runtime.getService(type), null);
      f.runs.get(1).stop.resolve();
      f.start.get(2).reject(Error('Synthetic second start refused'));
      await Promise.all([...f.removal.values()].map(result => result.settled));
      assert.ok([...f.removal.values()].every(result => result.state === 'done'));
      t.point('late returned service stops and teardown settles both callers',
        action('StartDone', 1, false), action('StartDone', 2, true), action('AwaitStarts', 11),
        action('UnloadStop', 11), action('UnloadFinish', 11), action('UnloadJoin', 12));
      if (lateConnector) assert.equal(f.observe()['sourceState.registry'], 'none');
      campaigns.get(model).push(t.trace);
    } finally {await f.cleanup();}
  }

  {
    const f = await serviceFixture(sql, services);
    const t = schedule('rival_connector_survives_joined_unload_and_failed_service_stop', f.observe);
    const refusal = Error('Synthetic first stop refused');
    try {
      await f.registerRival();
      t.point('rival claims the exact key away from the old owner', action('RegisterRival', 41));
      f.unload(11);
      t.point('first unload holds dispose', action('Unload', 11));
      f.unload(12);
      assert.equal(f.removal.get(12).promise, f.removal.get(11).promise);
      t.point('second unload joins', action('Unload', 12));
      f.dispose.resolve();
      await tick();
      t.point('owned lookups disappear before the first stop settles', action('Dispose', 11), action('AwaitStarts', 11), action('UnloadStop', 11));
      await assert.rejects(f.runtime.getServiceLoadPromise(type), /not found or failed to start/);
      t.point('load during teardown refuses the withdrawn service', action('Load', 21), action('LoadBegin', 21));
      f.runs.get(1).stop.reject(refusal);
      await tick();
      t.point('failed stop is recorded and the other instance is still stopped', action('UnloadWait', 11, true), action('UnloadStop', 11));
      f.runs.get(2).stop.resolve();
      await Promise.all([...f.removal.values()].map(result => result.settled));
      const failure = f.removal.get(11).error;
      assert.ok(failure instanceof AggregateError);
      assert.deepEqual(failure.errors, [refusal]);
      assert.equal(f.removal.get(12).error, failure);
      assert.equal(f.runtime.retirement.failures.length, 1);
      t.point('joined callers reject only after both stop hooks settle',
        action('UnloadWait', 11, false), action('UnloadStop', 11), action('UnloadFinish', 11), action('UnloadJoin', 12));
      campaigns.get(services).push(t.trace);
    } finally {await f.cleanup();}
  }
  {
    const f = await serviceFixture(sql, services);
    const t = schedule('runtime_stop_common_projection', f.observe);
    try {
      const stopping = f.runtime.stop();
      await tick();
      t.point('runtime stop enters the first service hook', action('Stop', 31), action('Drain', 31), action('StopService', 31));
      f.runs.get(1).stop.resolve();
      await tick();
      t.point('runtime visits the second service after the first settles', action('StopWait', 31), action('StopService', 31));
      f.runs.get(2).stop.resolve();
      await stopping;
      t.point('runtime stop finishes after both hooks and clears lookup', action('StopWait', 31), action('StopService', 31));
      assert.deepEqual(f.runtime.getServicesByType(type), []);
      recordedDifference(differences, 'PluginRuntimeStopLookup', services, t.trace, 'sourceState.services');
      campaigns.get(services).push(t.trace);
    } finally {await f.cleanup();}
  }

  const sources = [...new Set([...core.sources, ...sql.sources])];
  for (const [path, digest] of Object.entries(core.driverHashes)) {
    if (sql.driverHashes[path]) assert.equal(sql.driverHashes[path], digest, path);
  }
  const shared = {modelPath, sources, driverHashes: {...core.driverHashes, ...sql.driverHashes},
    scope: 'bounded-orchestration', assumptions: [
      'The actual AgentRuntime and plugin lifecycle execute with bound pinned source and isolated PGlite for service cases. Hook promises and connector registrations are synthetic. No connector sends.',
      'One service type, two class identities, one connector key and the actor counts from each original profile. Original macrosteps group selected source microtasks.',
      'Selected differences in rollback visibility and shutdown lookup clear are checked separately against exact source observations. These schedules do not check temporal fairness.',
    ]};
  const receipts = [];
  for (const [profile, traces] of campaigns) {
    receipts.push(await checkTraces({...shared, model: profile, traces}));
  }
  const mismatches = [];
  for (const {name, profile, trace} of differences) {
    const out = 'test-results/quint-refinement/'+name+'.json';
    await assert.rejects(checkTraces({...shared, model: profile, id: name, out, traces: [trace]}), /Source\/model trace mismatch/);
    const mismatch = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(mismatch.results[0].kind, 'observation-mismatch');
    assert.ok(mismatch.driverInputsBound);
    mismatches.push({...mismatch, name, receiptPath: out});
  }
  return {receipts, mismatches};
}
