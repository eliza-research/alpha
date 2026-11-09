import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkInteractiveTaskTraces} from '../specs/quint/legacy/core/check-interactive-task-traces.mjs';

test('the original interactive task model matches selected real reducer traces', {timeout: 60000}, async () => {
  const {receipts: [receipt], mismatch} = await checkInteractiveTaskTraces([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'CoreInteractiveTask');
  assert.equal(receipt.traces, 5);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(mismatch.passed, false);
  assert.equal(mismatch.results[0].kind, 'observation-mismatch');
});
