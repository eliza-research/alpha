import test from 'node:test';
import assert from 'node:assert/strict';
import {checkScreenFocusOwnership} from '../specs/quint/refinement/application/screen-focus-ownership.mjs';

test('the exact screen focus observer preserves navigation over resize and retires only its own installation', {timeout: 60000}, async () => {
  const receipt = await checkScreenFocusOwnership();
  assert.equal(receipt.traceInputs.length, 6);
  assert.equal(receipt.observedFields.length, 13);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
