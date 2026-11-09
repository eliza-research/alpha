import assert from 'node:assert/strict';
import test from 'node:test';
import {lifeOpsScheduledTaskRouteFixture} from './fixtures/lifeops-scheduled-task-route.mjs';
import {checkLifeOpsScheduledTaskRoute} from '../specs/quint/refinement/services/lifeops-scheduled-task-route.mjs';

test('the generic SDK route exposes the unfenced occurrence change through closed ports', async () => {
  const f = await lifeOpsScheduledTaskRouteFixture();
  await f.fire(1);
  await f.claim(1);
  await f.control('complete');
  await f.control('reopen');
  f.advance();
  await f.fire(2);
  await f.claim(2);
  await f.enterEgress(1);
  await f.finish(1, 'ok');
  const stale = await f.observe();
  assert.deepEqual(stale.guards[0], {actor: 1, at: 1, currentAt: 2, allowed: true});
  assert.deepEqual(stale.writes.at(-1), {actor: 1, accepted: true, status: 'fired', at: 1,
    beforeAt: 2, expectedStatus: 'fired', expectedAt: 0});
  assert.equal(stale.at, 1);
  assert.equal(stale.completed, 0);
  await f.enterEgress(2);
  await f.finish(2, 'ok');
});

test('pinned SDK scheduled-task route and in-memory claim schedules refine the as-built model', {timeout: 60_000}, async () => {
  const {receipt, obligations} = await checkLifeOpsScheduledTaskRoute();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 13);
  assert.equal(obligations.length, 1);
});
