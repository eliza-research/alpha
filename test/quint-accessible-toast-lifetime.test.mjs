import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {checkAccessibleToastLifetime} from '../specs/quint/refinement/application/accessible-toast-lifetime.mjs';

test('actual shell timers use the current Android accessibility timeout', {timeout: scaledTimeout(60000)}, async () => {
  const receipt = await checkAccessibleToastLifetime();
  assert.equal(receipt.traceInputs.length, 12);
  assert.equal(receipt.observedFields.length, 10);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
