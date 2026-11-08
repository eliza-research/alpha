import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCredentialCoordinator} from '../specs/quint/refinement/native/credential-coordinator.mjs';

test('actual credential plugins refine shutdown and durable mutation', {timeout: 600000}, async () => {
  const result = await checkCredentialCoordinator();
  assert.equal(result.receipts.length, 2);
  assert.equal(result.receipts.reduce((total, receipt) => total + receipt.traces, 0), 33);
  for (const receipt of result.receipts) {
    assert.equal(receipt.passed, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.equal(receipt.inputsUnchanged, true);
  }
});
