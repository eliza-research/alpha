import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkNotesRecorderMediaAdmission} from '../specs/quint/refinement/application/notes-recorder-media-admission.mjs';

test('mounted Notes recorder admission refines the saved audio shutdown boundary', {timeout: 240_000}, async () => {
  const receipt = await checkNotesRecorderMediaAdmission();
  assert.equal(receipt.traces, 5);
});
