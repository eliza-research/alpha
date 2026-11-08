import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../../check-traces.mjs';
import {loadCoreRuntime} from './module.mjs';

const action = (name, ...args) => ({name, args});
const flush = () => new Promise(setImmediate);

function fixture(RuntimeRetirement, name) {
  const retirement = new RuntimeRetirement();
  const identities = new Map();
  const results = new Map([[1, 'unused'], [2, 'unused'], [3, 'unused']]);
  const drains = new Map([[1, 'unused'], [2, 'unused']]);
  const gates = new Map();
  const promises = new Map();
  const observers = [];
  const observe = (includeDrains = true) => ({
    's.pending': qset([...retirement.pending].map(promise => {
      assert.ok(identities.has(promise), 'Every published work promise has an observed identity');
      return identities.get(promise);
    })),
    's.results': qmap([...results]),
    's.generation': retirement.generation,
    's.failures': retirement.failures.length,
    ...(includeDrains ? {'s.drains': qmap([...drains])} : {}),
  });
  const trace = {name, expect: observe(), steps: []};
  const point = (label, transition, includeDrains = true) => trace.steps.push({label, action: transition, expect: observe(includeDrains)});
  function begin(id, operation) {
    const gate = Promise.withResolvers();
    gates.set(id, gate);
    results.set(id, 'running');
    const before = new Set(retirement.pending);
    let published;
    const promise = retirement.run(() => {
      const added = [...retirement.pending].filter(value => !before.has(value));
      assert.equal(added.length, 1, 'Work is published before invoking its hook');
      published = added[0];
      identities.set(published, id);
      point('work is visible before its callback', action('beginRun', id));
      return operation ? operation(gate) : gate.promise;
    });
    assert.equal(promise, published, 'The published identity is returned to the caller');
    promises.set(id, promise);
    observers.push(promise.then(
      () => {results.set(id, 'ok'); point('original work promise fulfilled', action('settleRun', id, true));},
      () => {results.set(id, 'failed'); point('original work promise rejected', action('settleRun', id, false));},
    ));
    return promise;
  }
  function drain(id) {
    const waiting = retirement.pending.size > 0;
    drains.set(id, 'waiting');
    const promise = retirement.drain();
    point('caller requests quiescence', action('beginDrain', id), waiting);
    observers.push(promise.then(
      () => {drains.set(id, 'ok'); point('quiescence caller fulfilled', waiting ? action('finishDrain', id) : null);},
      error => {
        assert.equal(error.code, 'RUNTIME_QUIESCENCE_FAILED');
        drains.set(id, 'failed');
        point('recorded teardown failure reaches quiescence caller', waiting ? action('finishDrain', id) : null);
      },
    ));
    return promise;
  }
  return {
    trace, retirement, results, drains, begin, drain, promises,
    async resolve(id) {gates.get(id).resolve('result'); await flush();},
    async reject(id) {gates.get(id).reject(Error('Controlled hook rejection')); await flush();},
    recordFailure(cause = Error('Controlled teardown failure')) {
      retirement.recordFailure('fixture', cause);
      point('retirement failure is retained separately', action('recordFailure'));
    },
    async finish() {
      await flush();
      await Promise.all(observers);
      assert.equal(retirement.pending.size, 0, 'The source scenario leaves no work pending');
    },
  };
}

export async function runCoreRetirementRefinement(extraSources = []) {
  const module = await loadCoreRuntime([fileURLToPath(import.meta.url), 'test/quint-core-retirement.test.mjs', ...extraSources]);
  const traces = [];
  async function scenario(name, run) {
    const f = fixture(module.RuntimeRetirement, name);
    await run(f);
    await f.finish();
    traces.push(f.trace);
  }
  await scenario('empty retirement drains immediately', async f => {await f.drain(1);});
  await scenario('one work item holds drain', async f => {f.begin(1); const draining = f.drain(1); await f.resolve(1); await draining;});
  await scenario('rejected work does not invent a recorded teardown failure', async f => {f.begin(1); const draining = f.drain(1); await f.reject(1); await draining;});
  await scenario('synchronous hook return still publishes its promise first', async f => {f.begin(1, () => 'result'); await flush(); await f.drain(1);});
  await scenario('synchronous hook throw rejects the returned promise', async f => {f.begin(1, () => {throw Error('Controlled synchronous throw');}); await flush(); await f.drain(1);});
  await scenario('recorded failure rejects every later drain', async f => {f.recordFailure(); await f.drain(1).catch(() => {}); await f.drain(2).catch(() => {});});
  await scenario('failure while draining is retained', async f => {f.begin(1); const draining = f.drain(1).catch(() => {}); f.recordFailure(); await f.resolve(1); await draining;});
  await scenario('reentrant hook work is published and drained', async f => {
    f.begin(1, gate => {f.begin(2); return gate.promise;});
    const draining = f.drain(1);
    await f.resolve(1); assert.equal(f.drains.get(1), 'waiting');
    await f.resolve(2); await draining;
  });
  await scenario('completion callback can publish more work during drain', async f => {
    const first = f.begin(1); first.then(() => {f.begin(2);});
    const draining = f.drain(1);
    await f.resolve(1); assert.equal(f.drains.get(1), 'waiting');
    await f.resolve(2); await draining;
  });
  await scenario('concurrent drain callers observe the same pending work', async f => {f.begin(1); const a = f.drain(1), b = f.drain(2); await f.resolve(1); await Promise.all([a, b]);});
  await scenario('new work does not reopen an already completed drain', async f => {await f.drain(1); f.begin(1); assert.equal(f.drains.get(1), 'ok'); await f.resolve(1); await f.drain(2);});
  await scenario('two work items settle in reverse order', async f => {f.begin(1); f.begin(2); const draining = f.drain(1); await f.resolve(2); assert.equal(f.drains.get(1), 'waiting'); await f.resolve(1); await draining;});
  await scenario('multiple failure causes retain their count', async f => {f.recordFailure(null); f.recordFailure('Controlled text cause'); await f.drain(1).catch(() => {});});
  return checkTraces({model: 'CoreRuntimeRetirement', sources: module.sources, driverHashes: module.driverHashes,
    traces, scope: 'bounded-orchestration', assumptions: [
      'The real RuntimeRetirement class and ElizaError implementation execute. Read-only observation accesses the emitted TypeScript-private pending set and failure list.',
      'Three work identities, two drain callers and three recorded failures bound this model. Promise completion, rejection and reentrant work are controlled through public methods.',
      'Admission of new runtime work during shutdown and actual resource release belong to the service lifecycle and resource owners. A resolved drain does not prohibit future work.',
    ]});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const receipt = await runCoreRetirementRefinement();
  console.log(JSON.stringify({traces: receipt.traces, checkpoints: receipt.checkpoints, passed: receipt.passed}));
}
