import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkApprovalServiceRefinement} from '../specs/quint/legacy/core/check-approval-service-refinement.mjs';

test('the current approval service preserves the claimed callback and drains admitted work', {timeout: 120000}, async () => {
  const receipt = await checkApprovalServiceRefinement(undefined, [fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 13);
  assert.equal(receipt.checkpoints, 77);
});
