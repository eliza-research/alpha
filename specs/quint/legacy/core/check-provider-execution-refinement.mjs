import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../../refinement/check-traces.mjs';
import {loadProviderStateComposer} from '../../refinement/services/core-runtime/module.mjs';

const callers = ['a', 'b', 'c'];
const executions = [1, 2, 3];
const action = (name, ...args) => ({name, args});
const flush = () => new Promise(setImmediate);

function fixture(module, name, oneoff) {
  const runtime = new module.AgentRuntime({
    agentId: '00000000-0000-4000-8000-000000000001',
    runtimeInstanceId: '00000000-0000-4000-8000-000000000002',
    character: {name: 'Quint provider fixture', bio: [], plugins: []},
    fetch: async () => {throw Error('The provider fixture forbids network requests');},
  });
  const signalled = oneoff ? ['a', 'c'] : ['a', 'b'];
  const signals = new Map(signalled.map(id => [id, new AbortController()]));
  const work = new Map();
  const records = new Map();
  const observedExecution = new Map();
  const outcomes = new Map();
  let stopping = false;
  let stopped = false;
  const composer = new module.ProviderStateComposer(runtime, {
    hasProviderSelectionHooks: () => false,
    ensureServiceStarted: async () => null,
    isStopping: () => stopping,
  });
  const message = {id: '00000000-0000-4000-8000-000000000003',
    roomId: '00000000-0000-4000-8000-000000000004',
    entityId: '00000000-0000-4000-8000-000000000005', content: {text: 'Fixture'}};
  runtime.registerProvider({
    name: 'CONTROLLED_PROVIDER',
    get(_runtime, _message, _state, {signal}) {
      assert.ok(!work.has(signal), 'A provider invocation starts once');
      const gate = Promise.withResolvers();
      work.set(signal, gate);
      return gate.promise;
    },
  });

  function identity(execution) {
    for (const [id, known] of observedExecution) if (execution === known) return id;
    assert.fail('A published execution must have a source identity');
  }
  function observe() {
    const entries = [...composer.providerExecutionsInFlight.values()];
    assert.ok(entries.length <= 1, 'The model covers one coalescing key');
    const field = (select, absent) => qmap(executions.map(id =>
      [id, observedExecution.has(id) ? select(observedExecution.get(id), id) : absent]));
    return {
      safety: true,
      'observed.map': entries.length ? identity(entries[0]) : 0,
      'observed.active': qset([...composer.providerExecutionsActive].map(identity)),
      'observed.created': qset(observedExecution.keys()),
      'observed.waiters': field(execution => execution.waiters, 0),
      'observed.cause': field(({controller}) => !controller.signal.aborted ? 'none'
        : controller.signal.reason.message === 'Runtime stopped' ? 'stop' : 'waiters', 'none'),
      'observed.settled': field((_execution, id) => outcomes.has(id), false),
      'observed.cleaned': field((execution, id) => outcomes.has(id)
        && !composer.providerExecutionsActive.has(execution)
        && !entries.includes(execution), false),
      'observed.exec': qmap(callers.map(id => [id, records.get(id)?.execution ?? 0])),
      'observed.pc': qmap(callers.map(id => {
        const record = records.get(id);
        return [id, !record ? 'idle' : record.result || signals.get(id)?.signal.aborted ? 'done' : 'attached'];
      })),
      'observed.sigAborted': qmap(callers.map(id => [id, signals.get(id)?.signal.aborted ?? false])),
      'observed.stopping': stopping,
      'observed.stopped': stopped,
    };
  }
  const trace = {name, expect: observe(), steps: []};
  const point = (label, transition) => trace.steps.push({label, action: transition, expect: observe()});
  return {
    trace,
    async attach(id) {
      const before = new Map([...composer.providerExecutionsActive].map(execution => [execution, execution.waiters]));
      const record = {execution: 0};
      records.set(id, record);
      const input = oneoff && id === 'c' ? {...message, id: undefined} : message;
      const compose = () => composer.composeState(input, ['CONTROLLED_PROVIDER'], true, true);
      const signal = signals.get(id)?.signal;
      const promise = signal ? module.runWithStreamingContext({abortSignal: signal}, compose) : compose();
      record.promise = promise.then(
        state => {record.result = {state};},
        error => {record.result = {error};},
      );
      await flush();
      const joined = [...composer.providerExecutionsActive].filter(execution =>
        execution.waiters === (before.get(execution) ?? 0) + 1);
      assert.equal(joined.length, 1, 'Source waiter accounting identifies its shared execution');
      const [execution] = joined;
      if (!before.has(execution)) {
        const executionId = observedExecution.size + 1;
        observedExecution.set(executionId, execution);
        execution.promise.then(
          () => {outcomes.set(executionId, 'ok');},
          () => {outcomes.set(executionId, 'failed');},
        );
        assert.ok(work.has(execution.controller.signal), 'The admitted source owns the provider signal');
      }
      record.execution = identity(execution);
      point('compose publishes or joins an execution and counts its waiter', action('Attach', id));
    },
    abort(id) {
      const record = records.get(id);
      const execution = record && observedExecution.get(record.execution);
      const waiting = execution?.waiters;
      signals.get(id).abort(Error('Controlled caller abort ' + id));
      if (execution && !record.result) assert.equal(execution.waiters, waiting - 1);
      point('caller cancellation releases one source waiter synchronously', action('AbortSignal', id));
    },
    async settle(ids, idsOfWaiters, cause = 'work', failed = false) {
      const transitions = [];
      for (const id of ids) {
        const execution = observedExecution.get(id);
        if (cause === 'work') {
          const gate = work.get(execution.controller.signal);
          if (failed) gate.reject(Error('Controlled provider failure'));
          else gate.resolve({text: 'completed'});
        }
        transitions.push(action(cause === 'work' ? 'SettleWork' : 'SettleAborted', id), action('Cleanup', id));
      }
      for (const id of idsOfWaiters) transitions.push(action('CallerSettle', id));
      await flush();
      for (const id of ids) assert.ok(outcomes.has(id), 'The exact work promise settled');
      for (const id of idsOfWaiters) {
        const result = records.get(id).result;
        assert.ok(result, 'The compose caller settled');
        if (cause === 'abort') assert.equal(result.error?.code, 'TURN_ABORTED');
        else if (failed) assert.equal(result.error?.code, 'PROVIDER_COMPOSITION_FAILED');
        else assert.equal(result.state?.text, 'completed');
      }
      point('promise settlement retires the execution and releases its waiters', transitions);
    },
    requestStop() {
      stopping = true;
      point('host supplies the stopping boundary', action('RequestStop'));
    },
    stop() {
      composer.stop();
      stopped = true;
      point('composer aborts active work and clears both registries', action('StopComposer'));
    },
    async finish() {
      for (const gate of work.values()) gate.resolve({text: 'detached'});
      await flush();
      assert.equal(composer.providerExecutionsActive.size, 0);
      assert.equal(composer.providerExecutionsInFlight.size, 0);
      for (const [id, record] of records) {
        assert.ok(record.result);
        if (signals.get(id)?.signal.aborted) assert.equal(record.result.error?.code, 'TURN_ABORTED');
      }
    },
  };
}

export async function runProviderExecutionRefinement() {
  const modelPath = 'specs/quint/legacy/CoreProviderExecution.qnt';
  const loaded = await loadProviderStateComposer([fileURLToPath(import.meta.url), modelPath, 'test/quint-provider-execution-refinement.test.mjs']);
  const receipts = [];
  for (const oneoff of [false, true]) {
    const traces = [];
    async function scenario(name, run) {
      const f = fixture(loaded, name, oneoff);
      await run(f);
      await f.finish();
      traces.push(f.trace);
    }
    await scenario('signal-less caller survives a peer cancelling shared work', async f => {
      await f.attach('a');
      const other = oneoff ? 'b' : 'c';
      await f.attach(other);
      f.abort('a');
      await f.settle([1], [other]);
    });
    await scenario('cancelled execution is retired and the next keyed caller starts fresh work', async f => {
      await f.attach('a');
      f.abort('a');
      await f.settle([1], [], 'abort');
      const other = oneoff ? 'b' : 'c';
      await f.attach(other);
      await f.settle([2], [other], 'work', true);
    });
    await scenario('stop aborts all active work and releases interested callers', async f => {
      await f.attach('a'); await f.attach('c');
      f.requestStop(); f.stop();
      await f.settle(oneoff ? [1, 2] : [1], ['a', 'c'], 'abort');
    });
    if (!oneoff) await scenario('the first of two cancellations leaves one interested caller', async f => {
      await f.attach('a'); await f.attach('b');
      f.abort('a'); f.abort('b');
      await f.settle([1], [], 'abort');
    });
    const model = oneoff ? 'CoreProviderExecutionOneoff' : 'CoreProviderExecution';
    receipts.push(await checkTraces({model, modelPath, traces, sources: loaded.sources, driverHashes: loaded.driverHashes,
      scope: 'bounded-component', assumptions: [
        'The actual ProviderStateComposer, AgentRuntime provider registration, streaming context, AbortController and shared execution helpers execute.',
        'One provider, one keyed identity, three caller identities and independently controlled work promises. The stop request and external work settlement are fixture ports.',
        'Cleanup and caller settlement are grouped where they run in the same microtask sequence. The source observes actual retained execution identities, counters, result promises and cancellation signals.',
        'Provider authorization, cache publication, already-aborted admission and full host shutdown composition are separate obligations.',
      ]}));
  }
  return receipts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const receipt of await runProviderExecutionRefinement()) {
    console.log(receipt.model, receipt.traces, receipt.checkpoints, receipt.passed);
  }
}
