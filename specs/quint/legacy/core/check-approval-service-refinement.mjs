import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap} from '../../refinement/check-traces.mjs';
import {bundleVendorCore, deferred, observeFile, tick} from './source-support.mjs';

const driver = fileURLToPath(import.meta.url);
const call = (name, ...args) => ({name, args});
const taskId = 'task-fixture', actorId = 'actor-fixture';
const timerPorts = {name: 'approval-service-timer-ports', setup(builder) {
  observeFile(builder, 'approval.ts', [
    ['import { logger } from "../logger.ts";',
      'import { logger } from "../logger.ts";\nconst {setTimeout, clearTimeout} = __quint;'],
  ]);
}};

async function fixture(bundle) {
  const context = new AsyncLocalStorage();
  const reads = new Map(), callbacks = new Map(), deletions = new Map(), completed = new Set();
  let worker, task, timer, result, stopRequest, stopped = false, stopSettled = false, stable = true;
  const errors = [], workerErrors = new Map(), refusedSelectors = new Set();
  const {ApprovalService} = bundle.instantiate({
    setTimeout(callback, delay) {
      assert.equal(timer, undefined);
      assert.equal(delay, 1000);
      timer = {callback, status: 'armed'};
      return timer;
    },
    clearTimeout(handle) {
      assert.equal(handle, timer);
      if (handle.status === 'armed') handle.status = 'cleared';
    },
  });
  function request(port, name) {
    const owner = context.getStore();
    assert.ok(owner, name + ' has an invocation owner');
    assert.equal(port.has(owner), false, name + ' occurs once per invocation');
    const reply = {...deferred(), settled: false};
    port.set(owner, reply);
    return reply.promise;
  }
  function settle(port, owner, value, fails = false) {
    const reply = port.get(owner);
    assert.ok(reply && !reply.settled, owner + ' has one pending port reply');
    reply.settled = true;
    if (fails) reply.reject(Error('Injected approval callback failure'));
    else reply.resolve(value);
  }
  const runtime = {
    agentId: 'fixture-agent',
    registerTaskWorker(value) {assert.equal(worker, undefined); worker = value;},
    async createTask(value) {assert.equal(task, undefined); task = {...value, id: taskId}; return taskId;},
    getTask(id) {assert.equal(id, taskId); return request(reads, 'getTask');},
    deleteTask(id) {assert.equal(id, taskId); return request(deletions, 'deleteTask');},
    reportError(scope, error, details) {errors.push({scope, error, details});},
  };
  const service = await ApprovalService.start(runtime);
  const approval = service.requestApproval({name: 'APPROVE_FIXTURE', description: 'Approval fixture', roomId: 'fixture-room',
    options: [{name: 'approve'}, {name: 'decline', isCancel: true}], timeoutMs: 1000, timeoutDefault: 'decline',
    onSelect(option, received) {assert.equal(received.id, taskId); assert.ok(['approve', 'decline'].includes(option)); return request(callbacks, 'onSelect');},
    onTimeout(received) {assert.equal(received.id, taskId); return request(callbacks, 'onTimeout');},
  });
  const outcome = approval.then(value => {
    const status = value.timedOut ? 'timedOut' : value.resolvedBy === actorId ? 'selected' : 'cancelled';
    stable &&= result === undefined || result === status;
    result = status;
    if (value.timedOut) {
      assert.equal(value.selectedOption, 'decline');
      assert.equal(value.cancelled, true);
      assert.equal(value.success, false);
    } else if (status === 'selected') {
      assert.equal(value.success, value.selectedOption === 'approve');
      assert.equal(value.cancelled, value.selectedOption === 'decline');
    }
  }, error => {
    assert.match(error.message, /Injected approval callback failure/);
    stable &&= result === undefined || result === 'rejected';
    result = 'rejected';
  });
  void outcome.catch(() => {});
  await tick();
  assert.equal(worker.name, 'APPROVE_FIXTURE');
  assert.deepEqual(task.tags, ['AWAITING_CHOICE', 'APPROVAL']);
  assert.equal(service.listPendingUserActions()[0].id, taskId);
  const pending = (port, owner) => port.has(owner) && !port.get(owner).settled;
  const phase = owner => {
    if (completed.has(owner) || owner === 'timeout' && errors.length) return 'done';
    if (pending(deletions, owner)) return 'deleteTask';
    if (pending(callbacks, owner)) return owner === 'timeout' ? 'onTimeout' : 'onSelect';
    if (pending(reads, owner)) return 'getTask';
    return 'idle';
  };
  const observe = () => ({
    'state.inMap': service.listPendingUserActions().some(value => value.id === taskId),
    'state.timer': timer.status, 'state.taskExists': task !== undefined, 'state.result': result ?? 'none',
    'state.selRuns': [1, 2].filter(owner => callbacks.has(owner)).length, 'state.toRuns': Number(callbacks.has('timeout')),
    'state.tpc': phase('timeout'), 'state.tHas': reads.has('timeout'),
    'state.spc': qmap([1, 2].map(owner => [owner, phase(owner)])),
    'state.sHas': qmap([1, 2].map(owner => [owner, callbacks.has(owner)])),
    'state.cpc': phase('cancel'), 'state.stopped': stopped, settlementStable: stable,
  });
  function execute(owner, operation) {
    void context.run(owner, operation).then(
      () => completed.add(owner),
      error => {workerErrors.set(owner, error); completed.add(owner);},
    );
  }
  return {
    observe,
    deliver(owner, option = 'approve') {
      assert.ok(task, 'The registered worker was delivered a real task');
      const delivered = task;
      execute(owner, () => worker.execute(runtime, {option, resolvedBy: actorId}, delivered));
    },
    fire() {assert.equal(timer.status, 'armed'); timer.status = 'fired'; context.run('timeout', timer.callback);},
    read(owner) {
      if ((owner === 1 || owner === 2) && task && !stopped && service.listPendingUserActions().length === 0)
        refusedSelectors.add(owner);
      settle(reads, owner, task ?? null);
    },
    callback(owner, fails = false) {settle(callbacks, owner, undefined, fails);},
    delete(owner) {
      task = undefined;
      settle(deletions, owner);
      if (owner === 'timeout') completed.add(owner);
    },
    cancel() {execute('cancel', () => service.cancelApproval(taskId));},
    stop() {
      stopped = true;
      stopRequest = service.stop().then(() => {stopSettled = true;});
      void stopRequest.catch(() => {});
    },
    stopSettled: () => stopSettled,
    async outcome() {
      assert.ok(result, 'The original request settles');
      await outcome;
      await stopRequest;
      for (const owner of refusedSelectors)
        assert.equal(workerErrors.get(owner)?.code, 'APPROVAL_CALLBACK_UNAVAILABLE');
      for (const [owner, error] of workerErrors)
        if (!refusedSelectors.has(owner)) assert.match(error.message, /Injected approval callback failure/);
      for (const {scope, error} of errors) {
        assert.equal(scope, 'ApprovalService.timeout');
        assert.match(error.message, /Injected approval callback failure/);
      }
      assert.ok(![...reads.values(), ...callbacks.values(), ...deletions.values()].some(value => !value.settled), 'Every observed port is settled');
    },
  };
}

export async function checkApprovalServiceRefinement(vendorPath, extraSources = []) {
  const bundle = await bundleVendorCore(vendorPath,
    'export {ApprovalService} from "./packages/core/src/services/approval.ts";', [driver, ...extraSources], [timerPorts]);
  const traces = [];
  const selectionWins = (owner, fails = false) => {
    const other = 3 - owner;
    return [
      ['deliver', owner], ['deliver', other], ['read', owner], ['read', other],
      ['callback', owner, fails], ...(fails ? [] : [['delete', owner]]),
    ];
  };
  const scenarios = [
    ['first-selector-wins', selectionWins(1)], ['second-selector-wins', selectionWins(2)],
    ['winner-callback-rejects', selectionWins(2, true)],
    ['typed-selection-denial', [['deliver', 1, 'decline'], ['read', 1], ['callback', 1], ['delete', 1]]],
    ['timeout-default', [['fire'], ['read', 'timeout'], ['callback', 'timeout'], ['delete', 'timeout']]],
    ['timeout-callback-rejects', [['fire'], ['read', 'timeout'], ['callback', 'timeout', true]]],
    ['timeout-beats-delivered-selector', [['deliver', 1], ['fire'], ['read', 'timeout'], ['read', 1], ['callback', 'timeout'], ['delete', 'timeout']]],
    ['expired-task-read-skips-callback', [['fire'], ['cancel'], ['delete', 'cancel'], ['read', 'timeout'], ['delete', 'timeout']]],
    ['cancel-owns-settlement', [['deliver', 1], ['cancel'], ['delete', 'cancel'], ['read', 1], ['delete', 1]]],
    ['stop-owns-settlement', [['deliver', 1], ['stop'], ['read', 1], ['delete', 1]]],
    ['stop-cannot-steal-selection', [['deliver', 1], ['read', 1], ['stop'], ['callback', 1], ['delete', 1]]],
    ['stop-cannot-steal-timeout', [['fire'], ['read', 'timeout'], ['stop'], ['callback', 'timeout'], ['delete', 'timeout']]],
    ['cancel-cannot-steal-selection', [['deliver', 1], ['read', 1], ['cancel'], ['delete', 'cancel'], ['callback', 1], ['delete', 1]]],
  ];
  for (const [name, operations] of scenarios) {
    const f = await fixture(bundle), trace = {name, init: {name: 'init'}, expect: f.observe(), steps: []};
    for (const [operation, owner, option] of operations) {
      const before = f.observe();
      await f[operation](owner, option);
      await tick();
      if (operation === 'stop')
        assert.equal(f.stopSettled(), false, 'Stop waits for the already-admitted operation');
      const after = f.observe();
      let action;
      switch (operation) {
        case 'deliver': action = call('deliver', owner); break;
        case 'fire': action = call('fire'); break;
        case 'cancel': action = call('cancel'); break;
        case 'stop': action = call('stop'); break;
        case 'read':
          action = owner === 'timeout' ? [call('timeoutTask'), ...(before['state.taskExists'] ? [] : [call('timeoutResolve')])]
            : call('selectionTask', owner);
          break;
        case 'callback':
          action = owner === 'timeout' ? option ? call('timeoutCallbackFails') : [call('timeoutCallbackDone'), call('timeoutResolve')]
            : call(option ? 'selectionCallbackFails' : 'selectionCallbackDone', owner);
          break;
        case 'delete':
          action = owner === 'timeout' ? call('timeoutDelete') : owner === 'cancel' ? call('cancelDelete') : call('selectionDelete', owner);
          break;
        default: assert.fail('Unmapped approval operation');
      }
      trace.steps.push({label: [operation, owner, option].filter(value => value !== undefined).join(' '), action, expect: after});
    }
    await f.outcome();
    traces.push(trace);
  }
  return checkTraces({model: 'CoreApprovalServiceCurrent', id: 'CoreApprovalService-current-source', sources: bundle.sources,
    driverHashes: bundle.driverHashes, traces, scope: 'bounded-component', assumptions: [
      `Actual upstream ApprovalService at ${bundle.revision} executes requestApproval, the registered task worker, timeout, cancel and stop.`,
      'One installed task, one controllable timer and two selector identities. Task reads, deletions and callbacks are deferred ports. Task and result observations come from actual runtime requests and promise settlement.',
      'Atomic checkpoints drain promise microtasks. Worker phases and owner history are reconstructed from concrete getTask, callback and deleteTask requests. Timeout resolve and delete admission can share a checkpoint.',
      'Callback-bearing tasks with no pending owner refuse selection without deleting the task. Shutdown waits for admitted worker and timeout operations to drain.',
      'Task creation timing, fire-and-forget approvals, role checks, worker restart, task-store rejection and arbitrary numbers of approvals remain outside these schedules.',
    ]});
}

if (process.argv[1] === driver) {
  const receipt = await checkApprovalServiceRefinement(process.argv[2]?.replace(/^--vendor-dir=/, ''));
  console.log(receipt.model, receipt.traces, receipt.checkpoints, receipt.passed);
}
