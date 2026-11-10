import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPreparedWorkflowWorker} from '../specs/quint/refinement/services/prepared-workflow-worker.mjs';

test('prepared worker reuse and interrupted builds refine exact provenance admission', async () => {
  const receipt = await checkPreparedWorkflowWorker([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.observedFields.length, 10);
});
