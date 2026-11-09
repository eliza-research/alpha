import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkWorkflowWorkerStaging} from '../specs/quint/refinement/services/workflow-worker-staging.mjs';

test('workflow worker staging preserves exact targets and backups under source faults', async () => {
  const receipt = await checkWorkflowWorkerStaging([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.equal(receipt.traces, 14);
});
