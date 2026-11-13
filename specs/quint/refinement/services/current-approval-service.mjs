import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fileURLToPath} from 'node:url';
import {checkTraces, qmap, qset} from '../check-traces.mjs';
import {bundleVendorCore, deferred, observeFile, tick} from '../../legacy/core/source-support.mjs';

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
  let worker, task, timer, result, stopped = false, stable = true;
  const errors = [], workerErrors = [], unavailable = new Set(), blocked = new Set();
  let stopDone = false, stopping, missingTimeoutTask;
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
  function assertMissingTimeoutTask(error) {
    assert.equal(error.code, 'APPROVAL_TASK_UNAVAILABLE');
    assert.equal(error.message, 'Approval task is no longer available for timeout');
    assert.deepEqual(error.context, {taskId});
    assert.equal(task, undefined);
    assert.equal(timer.status, 'fired');
    assert.equal(reads.get('timeout')?.settled, true);
    assert.equal(callbacks.has('timeout'), false);
    assert.equal(deletions.has('timeout'), false);
  }
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
    if (error.code === 'APPROVAL_TASK_UNAVAILABLE') {
      assertMissingTimeoutTask(error);
      missingTimeoutTask = error;
    } else assert.match(error.message, /Injected approval callback failure/);
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
    'state.cpc': phase('cancel'), 'state.stopped': stopped, 'state.stopDone': stopDone, settlementStable: stable,
    'state.unavailable': qset([...unavailable]), 'state.blocked': qset([...blocked]),
    'state.deleteCalls': qset([...deletions.keys()].filter(owner => typeof owner === 'number')),
    pendingWork: service.operations.pending.size,
  });
  function execute(owner, operation) {
    void context.run(owner, operation).then(
      () => completed.add(owner),
      error => {workerErrors.push(error); completed.add(owner);
        if (error.code === 'APPROVAL_CALLBACK_UNAVAILABLE') unavailable.add(owner);
        if (error.code === 'APPROVAL_SERVICE_STOPPED') blocked.add(owner);},
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
    read(owner) {settle(reads, owner, task ?? null);},
    callback(owner, fails = false) {settle(callbacks, owner, undefined, fails);},
    delete(owner) {
      task = undefined;
      settle(deletions, owner);
      if (owner === 'timeout') completed.add(owner);
    },
    noDelete(owner) {
      assert.equal(owner, 'timeout');
      assertMissingTimeoutTask(missingTimeoutTask);
      assert.equal(result, 'rejected');
      assert.equal(errors.length, 1);
      assert.equal(errors[0].error, missingTimeoutTask);
      assert.equal(service.operations.pending.size, 0);
    },
    cancel() {execute('cancel', () => service.cancelApproval(taskId));},
    stop() {stopped = true; stopping = service.stop().then(() => {stopDone = true;});
      void stopping.catch(() => {});},
    async outcome() {
      assert.ok(result, 'The original request settles');
      await outcome;
      for (const error of workerErrors) assert.ok(/Injected approval callback failure/.test(error.message) ||
        ['APPROVAL_CALLBACK_UNAVAILABLE', 'APPROVAL_SERVICE_STOPPED'].includes(error.code), error.message);
      for (const owner of unavailable) {assert.equal(callbacks.has(owner), false); assert.equal(deletions.has(owner), false);}
      for (const owner of blocked) {assert.equal(reads.has(owner), false); assert.equal(deletions.has(owner), false);}
      if (stopping) {await stopping; assert.equal(service.operations.pending.size, 0);}
      for (const {scope, error, details} of errors) {
        assert.equal(scope, 'ApprovalService.timeout');
        assert.deepEqual(details, {taskId});
        if (error.code === 'APPROVAL_TASK_UNAVAILABLE') {
          assertMissingTimeoutTask(error);
          assert.equal(error, missingTimeoutTask);
        } else assert.match(error.message, /Injected approval callback failure/);
      }
      assert.ok(![...reads.values(), ...callbacks.values(), ...deletions.values()].some(value => !value.settled), 'Every observed port is settled');
    },
  };
}

export async function checkCoreApprovalServiceCurrentRefinement(vendorPath, extraSources = []) {
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
    ['expired-task-read-skips-callback', [['fire'], ['cancel'], ['delete', 'cancel'], ['read', 'timeout'], ['noDelete', 'timeout']]],
    ['cancel-owns-settlement', [['deliver', 1], ['cancel'], ['delete', 'cancel'], ['read', 1], ['delete', 1]]],
    ['stop-owns-settlement', [['deliver', 1], ['stop'], ['read', 1], ['delete', 1]]],
    ['stop-cannot-steal-selection', [['deliver', 1], ['read', 1], ['stop'], ['callback', 1], ['delete', 1]]],
    ['stop-cannot-steal-timeout', [['fire'], ['read', 'timeout'], ['stop'], ['callback', 'timeout'], ['delete', 'timeout']]],
    ['stop-with-no-worker-drains', [['stop']]],
    ['delivery-after-stop-is-refused', [['stop'], ['deliver', 2]]],
    ['cancel-cannot-steal-selection', [['deliver', 1], ['read', 1], ['cancel'], ['delete', 'cancel'], ['callback', 1], ['delete', 1]]],
  ];
  for (const [name, operations] of scenarios) {
    const f = await fixture(bundle), trace = {name, init: {name: 'init'}, expect: f.observe(), steps: []};
    for (const [operation, owner, option] of operations) {
      const before = f.observe();
      await f[operation](owner, option);
      await tick();
      const after = f.observe();
      let action;
      switch (operation) {
        case 'deliver': action = call('deliver', owner); break;
        case 'fire': action = call('fire'); break;
        case 'cancel': action = call('cancel'); break;
        case 'stop': action = call('stop'); break;
        case 'read':
          action = owner === 'timeout' ? call('timeoutTask')
            : call('selectionTask', owner);
          break;
        case 'callback':
          action = owner === 'timeout' ? option ? call('timeoutCallbackFails') : [call('timeoutCallbackDone'), call('timeoutResolve')]
            : call(option ? 'selectionCallbackFails' : 'selectionCallbackDone', owner);
          break;
        case 'delete':
          action = owner === 'timeout' ? call('timeoutDelete') : owner === 'cancel' ? call('cancelDelete') : call('selectionDelete', owner);
          break;
        case 'noDelete': action = call('timeoutMissingTaskNoEffects'); break;
        default: assert.fail('Unmapped approval operation');
      }
      if (!before['state.stopDone'] && after['state.stopDone']) action = Array.isArray(action) ? [...action, call('finishStop')] : [action, call('finishStop')];
      trace.steps.push({label: [operation, owner, option].filter(value => value !== undefined).join(' '), action, expect: after});
    }
    await f.outcome();
    traces.push(trace);
  }
  return checkTraces({model: 'CoreApprovalServiceCurrent', id: 'CoreApprovalServiceCurrent-source', sources: bundle.sources,
    driverHashes: bundle.driverHashes, traces, scope: 'bounded-component', assumptions: [
      `Actual upstream ApprovalService at ${bundle.revision} executes requestApproval, the registered task worker, timeout, cancel and stop.`,
      'Current synchronous callback-bearing approvals: one installed task, one controllable timer and two selector identities. Task reads, deletions and callbacks are deferred ports. Task and result observations come from actual runtime requests and promise settlement.',
      'Stop is observed as requested and separately settled; the actual RuntimeRetirement pending-work map is compared with independently derived admitted program counters. Callback-unavailable and stopped-admission failures are observed with zero callback/delete effects. Atomic checkpoints drain promise microtasks. Worker phases and owner history are reconstructed from concrete getTask, callback and deleteTask requests. Timeout resolve and delete admission can share a checkpoint.',
      'Task creation timing, fire-and-forget approvals, role checks, worker restart, task-store rejection and arbitrary numbers of approvals remain outside these schedules.',
    ]});
}

if (process.argv[1] === driver) {
  const receipt = await checkCoreApprovalServiceCurrentRefinement(process.argv[2]?.replace(/^--vendor-dir=/, ''));
  console.log(receipt.model, receipt.traces, receipt.checkpoints, receipt.passed);
}
