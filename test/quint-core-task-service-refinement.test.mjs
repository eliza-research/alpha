import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkTaskServiceRefinement} from '../specs/quint/legacy/core/check-task-service-refinement.mjs';

test('original TaskService profiles match actual claims, timers and wake revisions', {timeout: 120000}, async () => {
  const {receipts, mismatch} = await checkTaskServiceRefinement([fileURLToPath(import.meta.url)]);
  assert.deepEqual(receipts.map(receipt => receipt.model),
    ['CoreTaskService', 'CoreTaskServiceDaemonRepeat', 'CoreTaskServiceLocalOneshot', 'CoreTaskServiceLocalRepeat']);
  assert.deepEqual(receipts.map(receipt => receipt.traces), [2, 2, 2, 1]);
  assert.ok(receipts.every(receipt => receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged));
  assert.equal(mismatch.passed, false);
  assert.equal(mismatch.results[0].kind, 'observation-mismatch');
});
