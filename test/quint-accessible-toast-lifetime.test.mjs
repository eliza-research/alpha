import test from 'node:test';
import assert from 'node:assert/strict';
import {checkAccessibleToastLifetime} from '../specs/quint/refinement/application/accessible-toast-lifetime.mjs';

test('actual shell timers use the current Android accessibility timeout', {timeout: 60000}, async () => {
  const receipt = await checkAccessibleToastLifetime();
  assert.equal(receipt.traceInputs.length, 7);
  assert.equal(receipt.observedFields.length, 9);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
