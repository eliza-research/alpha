import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkCanonicalNotesDraft} from '../specs/quint/refinement/application/canonical-notes-draft.mjs';

test('canonical Notes draft snapshots and queued edits refine actual editor operations', {timeout:120000}, async () => {
  const receipt = await checkCanonicalNotesDraft([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 29);
  for (const name of ['queued-edit', 'queued-clear', 'new-edit-held', 'close-held', 'replace-held', 'empty-link', 'rich-link', 'invalid-patch']) {
    assert.ok(receipt.traceInputs.some(trace => trace.name === name), name);
  }
});
