import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkCanonicalNotesView} from '../specs/quint/refinement/application/canonical-notes-view.mjs';

test('canonical Notes rows and navigation waiters refine actual view callbacks', {timeout:120000}, async () => {
  const receipt = await checkCanonicalNotesView([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 30);
});
