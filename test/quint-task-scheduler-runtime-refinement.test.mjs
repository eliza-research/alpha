import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runTaskSchedulerRuntimeRefinement} from '../specs/quint/refinement/services/task-scheduler/runtime.mjs';

test('actual scheduler refines batched scope and independent process ownership', {timeout: 240000}, async () => {
  const result = await runTaskSchedulerRuntimeRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(result.receipts.length, 1);
  const [receipt] = result.receipts;
  assert.equal(receipt.model, 'TaskSchedulerRuntime');
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  for (const name of ['TickCohort', 'TickRows', 's.busy', 'ProcessActive', 'ProcessReturned']) {
    assert.ok(receipt.observedFields.includes(name));
  }
  assert.ok(result.obligations.length > 0);
});
