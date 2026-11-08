import test from 'node:test';
import assert from 'node:assert/strict';
import {checkStartupUpdateAdmission} from '../specs/quint/refinement/application/startup-update-admission.mjs';

test('the Android startup gate holds mount through uncertain and foreign update readbacks', {timeout: 60000}, async () => {
  const receipt = await checkStartupUpdateAdmission();
  assert.equal(receipt.traceInputs.length, 4);
  assert.equal(receipt.observedFields.length, 9);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
