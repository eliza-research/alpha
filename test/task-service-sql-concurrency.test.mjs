import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTaskService} from '../specs/quint/refinement/services/task-service/module.mjs';
const loaded = loadTaskService();
const waitFor = async predicate => {
  for (let n=0; n<1000 && !predicate(); n++) await new Promise(resolve=>setImmediate(resolve));
  assert.ok(predicate(), 'controlled source boundary was reached');
};

test('actual runtime and SQL preserve overlapping execution ownership through completion and stop', async () => {
  const {TaskService, createIsolatedTestDatabase} = await loaded;
  const fixture = await createIsolatedTestDatabase('quint-task-sql-ownership', [], {postgresUrl: null});
  let service;
  try {
    for (const firstIndex of [0, 1]) {
      for (const failFirst of [false, true]) {
        const gates = [], pending = [];
        fixture.runtime.registerTaskWorker({name: 'SQL_OWNERSHIP', async execute() {
          await new Promise((resolve, reject) => gates.push({resolve, reject})); return {preserveTask: true};
        }});
        const id = await fixture.runtime.createTask({name: 'SQL_OWNERSHIP', tags: ['queue','repeat'],
          metadata: {updatedAt: 0, updateInterval: 1, blocking: false}});
        service = new TaskService(fixture.runtime, {now: () => 100000, setInterval: () => 0, clearInterval() {}});
        try {
          for (let i=0; i<2; i++) {
            pending.push(service.executeTaskById(id).then(() => null, error => error));
            await waitFor(() => gates.length === i+1);
          }
          if (failFirst) gates[firstIndex].reject(Error('controlled source worker failure'));
          else gates[firstIndex].resolve();
          const first = await pending[firstIndex];
          assert.equal(Boolean(first), failFirst);
          assert.equal((await service.getTaskStatus(id)).executing, true);
          assert.equal(service.executingTasks.get(id), 1);
          await fixture.runtime.patchTaskMetadata(id, {set: {blocking: true}, unset: []});
          await service.runDueTasks(); assert.equal(gates.length, 2);
          let stopped = false; const stop = service.stop().then(() => { stopped = true; });
          await Promise.resolve(); assert.equal(stopped, false);
          gates[1-firstIndex].resolve(); await Promise.all(pending); await stop;
          assert.equal((await service.getTaskStatus(id)).executing, false);
          const row = await fixture.runtime.getTask(id);
          assert.equal(row.metadata.failureCount ?? 0, failFirst ? 1 : 0);
          assert.equal(Boolean(row.metadata.paused), false);
        } finally {
          for (const gate of gates) gate.resolve(); await Promise.all(pending);
          await service.stop(); await fixture.runtime.deleteTask(id);
        }
      }
    }
  } finally { if (service) await service.stop(); await fixture.cleanup(); }
});
