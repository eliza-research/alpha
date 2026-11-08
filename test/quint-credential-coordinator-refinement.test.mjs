import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCredentialLeasePolicies} from '../specs/quint/refinement/native/credential-leases.mjs';
import {checkCredentialCoordinator} from '../specs/quint/refinement/native/credential-coordinator.mjs';

test('actual credential plugins refine shutdown and durable mutation', {timeout: 600000}, async () => {
  const result = await checkCredentialCoordinator(['test/quint-credential-coordinator-refinement.test.mjs']);
  assert.equal(result.receipts.length, 2);
  assert.equal(result.receipts.reduce((total, receipt) => total + receipt.traces, 0), 37);
  for (const receipt of result.receipts) {
    assert.equal(receipt.passed, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
  }
});

test('native request and shutdown leases preserve exact ownership', {timeout: 120000}, async () => {
  const receipt = await checkCredentialLeasePolicies(['test/quint-credential-coordinator-refinement.test.mjs']);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 13);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.inputsUnchanged, true);
});
