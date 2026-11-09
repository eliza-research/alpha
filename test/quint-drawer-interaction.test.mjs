import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkDrawerInteraction} from '../specs/quint/refinement/application/drawer-interaction.mjs';

test('the mounted Apps drawer preserves current pointer, menu and exact App Info ownership', {timeout: 120000}, async () => {
  const receipt = await checkDrawerInteraction([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 22);
  assert.equal(receipt.checkpoints, 134);
});
