import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkTaskSchedulingRefinement} from '../specs/quint/legacy/core/check-task-scheduling-refinement.mjs';

test('current scheduling utilities follow the translated semaphore and serial queue profiles', {timeout: scaledTimeout(120000)}, async () => {
  const receipts = await checkTaskSchedulingRefinement(undefined, [fileURLToPath(import.meta.url)]);
  assert.deepEqual(receipts.map(receipt => [receipt.model, receipt.traces, receipt.checkpoints]), [
    ['CoreSemaphore', 5, 41],
    ['CoreSemaphoreTwo', 3, 28],
    ['CoreSerialise', 24, 254],
  ]);
  assert.ok(receipts.every(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound));
});
