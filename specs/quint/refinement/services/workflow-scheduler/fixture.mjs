import {createEngineFixture} from '../workflow-engine/ports.mjs';
import {until} from '../support.mjs';
import {schedulerClock} from './clock.mjs';
import {taskStore} from './tasks.mjs';

export async function createSchedulerFixture() {
  const engine = await createEngineFixture();
  const clock = schedulerClock();
  const tasks = taskStore();
  const platform = {Date: globalThis.Date, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout};
  globalThis.Date = clock.Date;
  globalThis.setTimeout = clock.setTimeout;
  globalThis.clearTimeout = clock.clearTimeout;
  Object.assign(engine.runtime, tasks.port);
  return {
    ...engine, clock, tasks,
    get service() { return engine.service; },
    async settleWith(result) {
      await until(() => engine.pending.length > 0, 'worker entry');
      const pending = engine.pending.shift();
      pending.resolve({events: [], ...result});
      await until(() => !engine.service.running.has(pending.input.runId), 'persisted worker return');
    },
    async close() {
      // Real SQL cleanup must be able to advance its own timers.
      Object.assign(globalThis, platform);
      await engine.close();
    },
  };
}
