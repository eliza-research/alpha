import test from 'node:test';
import assert from 'node:assert/strict';
import {runSingleFlightRefinement} from '../specs/quint/legacy/core/check-single-flight-refinement.mjs';

test('current memo shares actual room reads and fences invalidated results', async () => {
  const receipts = await runSingleFlightRefinement();
  assert.deepEqual(receipts.map(receipt => receipt.traces), [4, 5]);
  for (const receipt of receipts) {
    assert.equal(receipt.passed, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.equal(receipt.observedFields.length, 12);
  }
});
