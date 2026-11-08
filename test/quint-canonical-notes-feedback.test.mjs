import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkCanonicalNotesFeedback} from '../specs/quint/refinement/application/canonical-notes-feedback.mjs';

test('current Notes feedback preserves uncertain mutations across later reads', {timeout:120000}, async () => {
  const receipt = await checkCanonicalNotesFeedback([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 16);
  assert.equal(receipt.observedFields.length, 4);
  for (const name of ['uncertain-delete', 'uncertain-restore', 'uncertain-update', 'discard-failure',
    'commit-after-uncertain', 'card-after-uncertain', 'retire-read', 'owner-read']) {
    assert.ok(receipt.traceInputs.some(trace => trace.name === name), name);
  }
});
