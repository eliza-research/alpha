import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkMapsEventReturn} from '../specs/quint/refinement/application/maps-event-return.mjs';

test('Maps retains only the exact current visit ownership while Calendar return reads settle', {timeout: 120000}, async () => {
  const receipt = await checkMapsEventReturn([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 18);
  assert.equal(receipt.checkpoints, 129);
});
