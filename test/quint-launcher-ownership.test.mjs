import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkLauncherOwnership} from '../specs/quint/refinement/application/launcher-ownership.mjs';

test('shared launcher readbacks and native handoffs retain the current owner', {timeout: 120000}, async () => {
  const receipt = await checkLauncherOwnership([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 15);
  assert.equal(receipt.checkpoints, 120);
});
