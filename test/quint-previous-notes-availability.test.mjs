import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkPreviousNotesAvailability} from '../specs/quint/refinement/application/previous-notes-availability.mjs';

test('Previous Notes presence follows the exact owner and visible probe', {timeout: 120000}, async () => {
  const receipt = await checkPreviousNotesAvailability([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 8);
});
