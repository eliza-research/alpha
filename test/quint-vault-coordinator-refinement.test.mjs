import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkVaultCoordinator} from '../specs/quint/refinement/application/vault-coordinator.mjs';

test('actual vault coordinator clears drafts and retires reset review on leave', {timeout:60000}, async () => {
  const receipt=await checkVaultCoordinator([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces,9);
  assert.ok(receipt.checkpoints>=50);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.equal(receipt.driverInputsBound,true);
});
