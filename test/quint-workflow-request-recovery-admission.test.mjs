import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkWorkflowRequestRecoveryAdmission} from '../specs/quint/refinement/application/workflow-request-recovery-admission.mjs';

test('workflow request recovery follows the exact admitted browser review', {timeout: 120000}, async () => {
  const receipt = await checkWorkflowRequestRecoveryAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 7);
});
