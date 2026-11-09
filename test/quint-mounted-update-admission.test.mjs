import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMountedUpdateAdmission} from '../specs/quint/refinement/application/mounted-update-admission.mjs';

test('mounted Android updates require the current renderer and exact native activation', {timeout: 60000}, async () => {
  const receipt = await checkMountedUpdateAdmission();
  assert.equal(receipt.traceInputs.length, 7);
  assert.equal(receipt.observedFields.length, 17);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
