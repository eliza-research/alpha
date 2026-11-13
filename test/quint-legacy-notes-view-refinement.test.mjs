import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkNotesViewRefinement} from '../specs/quint/legacy/notes-view/check-notes-view-refinement.mjs';

test('historical Notes profiles compare with mounted canonical, retained and recording routes', {timeout: scaledTimeout(240000)}, async () => {
  const {receipts: [receipt], mismatches} = await checkNotesViewRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'NotesViewReplay');
  assert.equal(receipt.traces, 5);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.deepEqual(mismatches.map(row => row.id), [
    'NotesViewCanonicalCollectionRevision', 'NotesViewHistoricalRestoreFolder',
    'NotesViewHistoricalRecordingCap', 'NotesViewHistoricalLiveDurability',
  ]);
  assert.ok(mismatches.every(row => row.driverInputsBound && row.results[0].kind === 'observation-mismatch'));
});
