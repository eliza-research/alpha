import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDockClearanceOwnership} from '../specs/quint/refinement/application/dock-clearance-ownership.mjs';

test('the exact layout observers publish current header clearance and retain the last dock footprint', {timeout: 60000}, async () => {
  const receipt = await checkDockClearanceOwnership();
  assert.equal(receipt.traceInputs.length, 5);
  assert.equal(receipt.observedFields.length, 12);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
