import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {checkNotesRecorderMediaAdmission} from '../specs/quint/refinement/application/notes-recorder-media-admission.mjs';

test('mounted Notes recorder admission refines the saved audio shutdown boundary', {timeout: scaledTimeout(240_000)}, async () => {
  const receipt = await checkNotesRecorderMediaAdmission();
  assert.equal(receipt.traces, 5);
});
