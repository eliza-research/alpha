import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runTaskSchedulerRefinement} from '../specs/quint/refinement/services/task-scheduler/index.mjs';

test('actual shared daemon and TaskService refine both original scheduler profiles', {timeout: 120000}, async () => {
  const result = await runTaskSchedulerRefinement([fileURLToPath(import.meta.url)]);
  assert.deepEqual(result.receipts.map(({model, traces}) => [model, traces]), [
    ['CoreTaskScheduler', 7], ['CoreTaskSchedulerRestart', 3],
  ]);
  for (const receipt of result.receipts) {
    assert.equal(receipt.passed, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.ok(receipt.observedFields.includes('observed.activeTick'));
    assert.ok(receipt.observedFields.includes('observed.busy'));
  }
  assert.ok(result.obligations.length > 0);
});
