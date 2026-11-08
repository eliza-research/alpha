import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {coreStateBuildPlugin} from '../scripts/core-state-patch.mjs';

async function taskClass(patched) {
  const core = patched ? coreStateBuildPlugin(process.cwd(), process.cwd()+'/vendor/eliza') : null;
  const built = await build({stdin: {contents: "export {TaskService} from './vendor/eliza/packages/core/src/services/task.ts';", resolveDir: process.cwd()},
    bundle: true, write: false, format: 'esm', platform: 'node', plugins: core ? [core.plugin] : []});
  return (await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'))).TaskService;
}
const classes = Promise.all([taskClass(false), taskClass(true)]);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function fixture(TaskService, holdWorker = false) {
  const intervals = new Set(), entered = deferred(), released = deferred();
  const state = {calls: 0, queries: 0};
  const task = {id: '00000000-0000-4000-8000-000000000002', name: 'CONTROLLED_WORKER', tags: ['queue', 'repeat'], metadata: {updatedAt: 0, updateInterval: 1}};
  const worker = {async execute() { state.calls++; entered.resolve(); if (holdWorker) await released.promise; return {preserveTask: true}; }};
  const runtime = {agentId: '00000000-0000-4000-8000-000000000001',
    logger: {debug() {}, info() {}, warn() {}, error() {}}, reportError() {}, getSetting() {}, getService() { return null; },
    async getTask() { return task; }, async getTasks() { state.queries++; return [task]; }, getTaskWorker() { return worker; }};
  const service = new TaskService(runtime, {now: () => 100000, setInterval(callback) { intervals.add(callback); return callback; }, clearInterval(callback) { intervals.delete(callback); }});
  return {service, runtime, state, task, intervals, entered, released};
}

test('patched stop refuses manual execution and leaves the stopped timer mode retired', async () => {
  const [Original, Patched] = await classes;
  const old = fixture(Original); await old.service.stop(); await old.service.executeTaskById(old.task.id); old.service.startTimer();
  assert.equal(old.state.calls, 1); assert.equal(old.intervals.size, 0); assert.equal(old.service.localTimer, true); await old.service.stop();
  const current = fixture(Patched); await current.service.stop();
  await assert.rejects(current.service.executeTaskById(current.task.id), error => error.code === 'TASK_SERVICE_STOPPED');
  current.service.startTimer(); assert.equal(current.state.calls, 0); assert.equal(current.intervals.size, 0); assert.equal(current.service.localTimer, false);
});

test('stop while the public task read is held fences later worker admission', async () => {
  const [Original, Patched] = await classes;
  for (const [TaskService, expectedCalls] of [[Original, 1], [Patched, 0]]) {
    const f = fixture(TaskService), read = deferred(), entered = deferred();
    f.runtime.getTask = async () => { entered.resolve(); await read.promise; return f.task; };
    const execution = f.service.executeTaskById(f.task.id).then(() => null, error => error);
    await entered.promise; await f.service.stop(); read.resolve(); const error = await execution;
    assert.equal(f.state.calls, expectedCalls);
    if (TaskService === Patched) assert.equal(error?.code, 'TASK_SERVICE_STOPPED'); else assert.equal(error, null);
  }
});

test('stop drains already-admitted work and suppresses a queued due-task read', async () => {
  const [Original, Patched] = await classes;
  for (const [TaskService, expectedQueries] of [[Original, 2], [Patched, 1]]) {
    const f = fixture(TaskService, true); f.service.startTimer();
    const first = f.service.runDueTasks(); await f.entered.promise;
    const queued = f.service.runDueTasks(); let stopped = false;
    const stop = f.service.stop().then(() => { stopped = true; });
    await Promise.resolve(); assert.equal(stopped, false); assert.equal(f.intervals.size, 0);
    f.released.resolve(); await Promise.all([first, queued, stop]);
    assert.equal(stopped, true); assert.equal(f.state.calls, 1); assert.equal(f.state.queries, expectedQueries);
    assert.equal(f.service.executingTasks.size, 0); assert.equal(f.service.executingTaskPromises.size, 0);
  }
});

test('every concurrent manual owner retains the blocking marker until its own completion', async () => {
  const [Original, Patched] = await classes;
  for (const [TaskService, corrected] of [[Original, false], [Patched, true]]) {
    for (const firstIndex of [0, 1]) {
      for (const failFirst of [false, true]) {
        const f = fixture(TaskService), finish = [], pending = [];
        f.task.metadata.blocking = false;
        const reached = async count => {
          for (let n=0; n<100 && finish.length<count; n++) await new Promise(resolve=>setImmediate(resolve));
          assert.equal(finish.length, count);
        };
        f.runtime.patchTaskMetadata = async () => 'updated';
        f.runtime.getTaskWorker = () => ({async execute() {
          f.state.calls++;
          await new Promise((resolve, reject) => finish.push({resolve, reject}));
          return {preserveTask: true};
        }});
        try {
          for (let i=0; i<2; i++) {
            pending.push(f.service.executeTaskById(f.task.id).then(() => null, error => error));
            await reached(i+1);
          }
          if (failFirst) finish[firstIndex].reject(Error('controlled worker failure'));
          else finish[firstIndex].resolve();
          await pending[firstIndex];
          assert.equal((await f.service.getTaskStatus(f.task.id)).executing, corrected);
          f.task.metadata.blocking = true;
          const tick = f.service.runDueTasks(); pending.push(tick.then(() => null, error => error));
          for (let n=0; n<10; n++) await new Promise(resolve=>setImmediate(resolve));
          assert.equal(f.state.calls, corrected ? 2 : 3);
          if (corrected) assert.equal(f.service.executingTasks.get(f.task.id), 1);
          let stopped = false; const stop = f.service.stop().then(() => { stopped = true; });
          await Promise.resolve(); assert.equal(stopped, false);
          for (const gate of finish) gate.resolve();
          await Promise.all(pending); await stop;
          assert.equal(f.service.executingTasks.size, 0);
          assert.equal((await f.service.getTaskStatus(f.task.id)).executing, false);
        } finally {
          for (const gate of finish) gate.resolve();
          await Promise.all(pending); await f.service.stop();
        }
      }
    }
  }
});

test('nonblocking scheduled execution retains every manual and automatic owner', async () => {
  const [, Patched] = await classes;
  const f = fixture(Patched), finish = [], pending = [];
  f.task.metadata.blocking = false;
  f.runtime.getTaskWorker = () => ({async execute() {
    f.state.calls++; await new Promise(resolve => finish.push(resolve)); return {preserveTask: true};
  }});
  const reached = async count => {
    for (let n=0; n<100 && finish.length<count; n++) await new Promise(resolve=>setImmediate(resolve));
    assert.equal(finish.length, count);
  };
  try {
    pending.push(f.service.executeTaskById(f.task.id)); await reached(1);
    pending.push(f.service.executeTaskById(f.task.id)); await reached(2);
    pending.push(f.service.runDueTasks()); await reached(3);
    assert.equal(f.service.executingTasks.get(f.task.id), 3);
    finish[1](); await pending[1]; assert.equal(f.service.executingTasks.get(f.task.id), 2);
    finish[2](); await pending[2]; assert.equal(f.service.executingTasks.get(f.task.id), 1);
    assert.equal((await f.service.getTaskStatus(f.task.id)).executing, true);
    finish[0](); await pending[0]; assert.equal((await f.service.getTaskStatus(f.task.id)).executing, false);
  } finally { for (const release of finish) release(); await Promise.all(pending); await f.service.stop(); }
});


test('a one-shot reread held across stop drains without entering its worker', async () => {
  const [Original, Patched] = await classes;
  for (const [TaskService, expectedCalls] of [[Original, 1], [Patched, 0]]) {
    const f = fixture(TaskService), read = deferred(), entered = deferred();
    f.task.tags = ['queue'];
    let reads = 0;
    f.runtime.getTask = async () => {
      if (++reads === 2) { entered.resolve(); await read.promise; }
      return f.task;
    };
    const running = f.service.executeTaskById(f.task.id);
    await entered.promise;
    const stop = f.service.stop();
    read.resolve();
    await Promise.all([running, stop]);
    assert.equal(f.state.calls, expectedCalls);
    assert.equal(f.service.executingTasks.size, 0);
  }
});

test('blocking repeats exclude second manual invocation in both source versions', async () => {
  for (const TaskService of await classes) {
    const f = fixture(TaskService, true);
    const first = f.service.executeTaskById(f.task.id);
    try {
      await f.entered.promise;
      await f.service.executeTaskById(f.task.id);
      assert.equal(f.state.calls, 1);
    } finally { f.released.resolve(); await first; await f.service.stop(); }
  }
});
