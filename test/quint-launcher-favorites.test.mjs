import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkLauncherFavorites} from '../specs/quint/refinement/application/launcher-favorites.mjs';

test('shared launcher favorites preserve canonical identities and storage choices', {timeout: 120000}, async () => {
  const receipt = await checkLauncherFavorites([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 21);
  assert.equal(receipt.checkpoints, 126);
});
