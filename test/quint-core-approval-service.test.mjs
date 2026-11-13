import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkApprovalServiceRefinement} from '../specs/quint/legacy/core/check-approval-service-refinement.mjs';

test('the historical approval service follows its translated settlement protocol', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkApprovalServiceRefinement(undefined, [fileURLToPath(import.meta.url)]);
  assert.equal(receipt.historicalRevision, '4787d51a142c63c98371c832997184c53f7218d3');
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 13);
  assert.equal(receipt.checkpoints, 81);
});
