import assert from 'node:assert/strict';
import test from 'node:test';
import {checkApprovalRoutes} from '../specs/quint/refinement/application/approval-routes.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

test('mounted live and recovered approval routes match ApprovalRoutes', {timeout:scaledTimeout(600_000)}, async () => {
  const receipt = await checkApprovalRoutes([import.meta.filename]);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
