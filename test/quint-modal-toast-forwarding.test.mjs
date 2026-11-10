import test from 'node:test';
import assert from 'node:assert/strict';
import {checkModalToastForwarding} from '../specs/quint/refinement/application/modal-toast-forwarding.mjs';

test('actual dialog toast forwarding follows modal order and exact installation ownership', {timeout: 60000}, async () => {
  const receipt = await checkModalToastForwarding();
  assert.equal(receipt.traceInputs.length, 8);
  assert.equal(receipt.observedFields.length, 10);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
