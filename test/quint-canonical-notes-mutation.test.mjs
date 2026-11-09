import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkCanonicalNotesMutation} from '../specs/quint/refinement/application/canonical-notes-mutation.mjs';

test('canonical Notes delete and restore preserve actual save and owner continuations', {timeout:180000}, async () => {
  const receipt = await checkCanonicalNotesMutation([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 37);
  assert.equal(new Set(receipt.traceInputs.map(trace => trace.name)).size, 37);
  for (const name of ['delete-dirty-queued', 'delete-dirty-replaced', 'delete-owner-save', 'restore-current-revision',
    'delete-codec-target', 'delete-valid-unchanged-membership', 'save-during-restore']) {
    assert.ok(receipt.traceInputs.some(trace => trace.name === name), name);
  }
});
