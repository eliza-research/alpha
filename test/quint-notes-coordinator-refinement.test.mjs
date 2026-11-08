import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkNotesCoordinator} from '../specs/quint/refinement/application/notes-coordinator.mjs';

test('real Notes coordinator preserves queued edits across unknown commits and restart', {timeout:60000}, async () => {
  const receipt=await checkNotesCoordinator([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces,2);
  assert.equal(receipt.checkpoints,10);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.equal(receipt.driverInputsBound,true);
});
