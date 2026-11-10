import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserNoteRecordingJournal} from '../specs/quint/refinement/application/browser-note-recording-journal.mjs';

test('pending browser recording publication and retirement refine the journal model', {timeout: 120000}, async () => {
  const receipt = await checkBrowserNoteRecordingJournal([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 16);
  assert.equal(receipt.observedFields.length, 10);
});
