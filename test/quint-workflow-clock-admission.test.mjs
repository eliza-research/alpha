import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {checkWorkflowClockAdmission} from '../specs/quint/refinement/application/workflow-clock-admission.mjs';

test('actual Workflows Clock actions refine route and handoff admission', {timeout: 30000}, async () => {
  const receipt = await checkWorkflowClockAdmission([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.checkpoints, 78);
  assert.equal(receipt.observedFields.length, 11);
});
