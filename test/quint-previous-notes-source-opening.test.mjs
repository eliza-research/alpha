import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkPreviousNotesSourceOpening} from '../specs/quint/refinement/application/previous-notes-source-opening.mjs';

// Partial source contract regression. Original extracted member schedules and ports remain bounded.
// This does not establish whole-file refinement, installed behavior or acceptance.
test('partial source contract: PreviousNotesSourceOpening retains its original source schedules', {timeout: 240000}, async () => {
  const receipt = await checkPreviousNotesSourceOpening([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'PreviousNotesSourceOpening');
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
