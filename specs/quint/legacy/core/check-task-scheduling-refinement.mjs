import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../../refinement/check-traces.mjs';
import {bundleVendorCore, deferred, tick} from './source-support.mjs';

const driver = fileURLToPath(import.meta.url);
const call = (name, ...args) => ({name, args});
const startTrace = (name, expect) => ({name, init: {name: 'init'}, expect, steps: []});
const checkpoint = (trace, label, action, expect) => trace.steps.push({label, action, expect});
const ids = ['c1', 'c2', 'c3', 'c4'];
const callerMap = (callers, project) => qmap(callers.map(caller => [caller, project(caller)]));

function semaphoreFixture(Semaphore, capacity) {
  const semaphore = new Semaphore(capacity);
  const waiters = new Map();
  const callers = new Map(ids.map(id => [id, {controller: new AbortController(), phase: 'idle', ticket: 0, queuedAbort: false}]));
  let next = 1, reentrantRelease, abortedSnapshot, cancelAfterRelease = false;
  const signal = id => callers.get(id).controller.signal;
  const queue = () => semaphore.waiters.map(waiter => {
    assert.ok(waiters.has(waiter), 'Every real queue entry has an observed identity');
    return waiters.get(waiter);
  });
  const observe = () => ({
    'state.permits': semaphore.availablePermits,
    'state.waiters': queue(),
    'state.pc': callerMap(ids, id => callers.get(id).phase),
    'state.aborted': callerMap(ids, id => signal(id).aborted),
    'state.listener': callerMap(ids, id => signal(id).aborted && listeners(id).length > 0),
    'state.queuedAbort': callerMap(ids, id => callers.get(id).queuedAbort),
    'state.ticket': callerMap(ids, id => callers.get(id).ticket),
    'state.next': next,
  });
  const listeners = id => getEventListeners(signal(id), 'abort').filter(listener => listener !== callers.get(id).onAbort);
  function release(id) {
    const caller = callers.get(id);
    assert.equal(caller.phase, 'holding');
    semaphore.release();
    caller.phase = 'done';
  }
  for (const [id, caller] of callers) {
    caller.onAbort = () => {
      caller.queuedAbort = queue().includes(id);
      abortedSnapshot = observe();
      if (reentrantRelease) release(reentrantRelease);
      cancelAfterRelease = queue().includes(id);
    };
    signal(id).addEventListener('abort', caller.onAbort, {once: true});
  }
  return {
    observe, release,
    acquire(id) {
      const caller = callers.get(id), before = semaphore.queueLength;
      void semaphore.acquire(signal(id)).then(() => {caller.phase = 'holding';},
        error => {assert.equal(error, signal(id).reason); caller.phase = 'rejected';});
      if (semaphore.queueLength > before) {
        assert.equal(semaphore.queueLength, before + 1);
        waiters.set(semaphore.waiters.at(-1), id);
        caller.phase = 'waiting';
        caller.ticket = next++;
        assert.equal(listeners(id).length, 1, 'Each queued waiter installs a real cancellation listener');
      }
    },
    abort(id, releaseOwner) {
      abortedSnapshot = undefined;
      reentrantRelease = releaseOwner;
      callers.get(id).controller.abort(Error('Fixture abort ' + id));
      reentrantRelease = undefined;
      return {snapshot: abortedSnapshot, cancelAfterRelease};
    },
    assertDrained() {
      assert.equal(semaphore.availablePermits, capacity);
      assert.equal(semaphore.queueLength, 0);
      for (const id of ids) assert.equal(listeners(id).length, 0, 'No settled waiter keeps its cancellation listener');
    },
  };
}

const acquires = (...callers) => callers.map(caller => ['acquire', caller]);
const releases = (...callers) => callers.map(caller => ['release', caller]);
const enqueueAll = acquires(...ids);
const semaphoreSchedules = [
  ['CoreSemaphore', 1, [
    ['preaborted-and-repeated-abort', [['abort', 'c1'], ['acquire', 'c1'], ...acquires('c2'), ...releases('c2'), ['abort', 'c1']]],
    ['cancel-middle-of-fifo', [...enqueueAll, ['abort', 'c3'], ...releases('c1', 'c2', 'c4')]],
    ['earlier-abort-listener-releases-to-live-follower', [...enqueueAll, ['abort', 'c2', 'c1'], ...releases('c3', 'c4')]],
    ['earlier-abort-listener-releases-with-no-live-follower', [...acquires('c1', 'c2'), ['abort', 'c2', 'c1'], ...acquires('c3'), ...releases('c3')]],
    ['abort-of-holder-does-not-drop-permit', [...acquires('c1', 'c2', 'c3'), ['abort', 'c1'], ['release', 'c1'],
      ['abort', 'c2'], ...releases('c2', 'c3')]],
  ]],
  ['CoreSemaphoreTwo', 2, [
    ['skip-aborted-head-with-second-holder', [...enqueueAll, ['abort', 'c3', 'c2'], ...releases('c4', 'c1')]],
    ['cancel-tail-without-reentrant-release', [...enqueueAll, ['abort', 'c4'], ...releases('c2', 'c1', 'c3')]],
    ['earlier-release-grants-live-head-before-tail-cancels', [...enqueueAll, ['abort', 'c4', 'c1'], ...releases('c2', 'c3')]],
  ]],
];

async function semaphoreTraces(Semaphore, capacity, scenarios) {
  const traces = [];
  for (const [name, operations] of scenarios) {
    const f = semaphoreFixture(Semaphore, capacity), trace = startTrace(name, f.observe());
    for (const [operation, caller, releaseOwner] of operations) {
      if (operation !== 'abort') {
        f[operation](caller);
        await tick();
        checkpoint(trace, operation + ' ' + caller, call(operation, caller), f.observe());
      } else {
        const {snapshot, cancelAfterRelease} = f.abort(caller, releaseOwner);
        await tick();
        if (snapshot) {
          checkpoint(trace, 'native signal is aborted before its waiter listener', call('abort', caller), snapshot);
          const actions = [
            ...(releaseOwner ? [call('release', releaseOwner)] : []),
            ...(cancelAfterRelease ? [call('cancelListener', caller)] : []),
          ];
          if (actions.length) checkpoint(trace, 'abort dispatch settles actual callbacks', actions, f.observe());
          else assert.deepEqual(f.observe(), snapshot);
        } else checkpoint(trace, 'repeated native abort is inert', {...call('abort', caller), reject: true}, f.observe());
      }
    }
    f.assertDrained();
    traces.push(trace);
  }
  return traces;
}

const letters = ['a', 'b', 'c', 'd'];
function permutations(values) {
  return values.length === 0 ? [[]] : values.flatMap(value => permutations(values.filter(other => other !== value)).map(tail => [value, ...tail]));
}
async function serialiseTrace(createSerialise, order, index) {
  const serialise = createSerialise();
  const chain = [], events = [], finished = [];
  const calls = new Map(letters.map(id => [id, {phase: 'idle', outcome: 'none', task: deferred(), failure: Error('Fixture rejection ' + id)}]));
  const observe = () => ({
    'state.chain': [...chain],
    'state.pc': callerMap(letters, id => calls.get(id).phase),
    'state.outcome': callerMap(letters, id => calls.get(id).outcome),
  });
  const trace = startTrace('order-' + order.join('') + (index % 2 === 0 ? '-batch' : '-staggered'), observe());
  const event = (name, ...args) => events.push(call(name, ...args));
  function invoke(id, synchronousFailure = false) {
    const value = calls.get(id);
    chain.push(id);
    value.phase = 'queued';
    function finish(outcome) {
      value.phase = 'done';
      value.outcome = outcome;
      event('finish', id, outcome);
    }
    finished.push(serialise(() => {
      value.phase = 'running';
      event('start', id);
      if (synchronousFailure) {
        finish('threw');
        throw value.failure;
      }
      return value.task.promise.then(
        result => {finish('ok'); return result;},
        error => {finish('threw'); throw error;},
      );
    }).then(
      result => {assert.equal(result, id); assert.equal(value.outcome, 'ok');},
      error => {assert.equal(error, value.failure); assert.equal(value.outcome, 'threw');},
    ));
    checkpoint(trace, 'actual invocation ' + id, call('invoke', id), observe());
  }
  async function flush(label) {
    await tick();
    const actions = events.splice(0);
    checkpoint(trace, label, actions.length ? actions : null, observe());
  }
  async function finish(id, position) {
    const value = calls.get(id);
    if (value.phase === 'done') return; // Synchronous callback failure already settled.
    assert.equal(value.phase, 'running');
    if (((index + position) % 3) === 0) value.task.reject(value.failure);
    else value.task.resolve(id);
    await flush('settled operation body ' + id);
  }
  if (index % 2 === 0) {
    for (const id of order) invoke(id, index % 4 === 0 && id === order[1]);
    await flush('first callback starts after same-turn invocations');
    for (const [position, id] of order.entries()) await finish(id, position);
  } else {
    invoke(order[0]);
    await flush('first callback starts before the next invocation');
    invoke(order[1], index % 3 === 0);
    await flush('second callback waits while first is held');
    await finish(order[0], 0);
    await finish(order[1], 1);
    for (const id of order.slice(2)) invoke(id);
    await flush('new callbacks start after the earlier queue drained');
    await finish(order[2], 2);
    await finish(order[3], 3);
  }
  await Promise.all(finished);
  return trace;
}

export async function checkTaskSchedulingRefinement(vendorPath, extraSources = []) {
  const bundle = await bundleVendorCore(vendorPath,
    'export {Semaphore, createSerialise} from "./packages/core/src/utils/task-scheduling.ts";', [driver, ...extraSources]);
  const {Semaphore, createSerialise} = bundle.instantiate({});
  const receipts = [];
  for (const [model, capacity, cases] of semaphoreSchedules) {
    receipts.push(await checkTraces({model, modelPath: 'specs/quint/legacy/CoreSemaphore.qnt',
      id: model + '-source', sources: bundle.sources, driverHashes: bundle.driverHashes,
      traces: await semaphoreTraces(Semaphore, capacity, cases), scope: 'bounded-component', assumptions: [
        `Actual upstream Semaphore at ${bundle.revision} with one or two permits and native AbortController signals.`,
        'The driver observes the actual FIFO queue, available permits, promise outcomes and registered cancellation callbacks. Ticket and queued-abort fields record actual enqueue and native abort events. An earlier real abort listener can release a permit before the semaphore cancellation callback.',
        'Each caller acquires at most once and releases only a held permit. Arbitrary permit counts and unmatched releases are outside the original profiles.',
      ]}));
  }
  const traces = [];
  for (const [index, order] of permutations(letters).entries()) traces.push(await serialiseTrace(createSerialise, order, index));
  receipts.push(await checkTraces({model: 'CoreSerialise', id: 'CoreSerialise-source', sources: bundle.sources,
    driverHashes: bundle.driverHashes, traces, scope: 'bounded-component', assumptions: [
      `Actual upstream createSerialise at ${bundle.revision} receives real async operations and synchronous throws.`,
      'Every permutation of four distinct invocations appears once in a same-turn or staggered schedule. Deferred operation bodies exercise successful values and exact rejection identity. Checkpoints group observed promise microtasks and compare the full finite state.',
      'The campaign samples success/failure assignments and timing within each order. Arbitrary call counts and a running operation awaiting a nested invocation on its own queue remain outside the original profile.',
    ]}));
  return receipts;
}

if (process.argv[1] === driver) {
  for (const receipt of await checkTaskSchedulingRefinement(process.argv[2]?.replace(/^--vendor-dir=/, ''))) {
    console.log(receipt.model, receipt.traces, receipt.checkpoints, receipt.passed);
  }
}
