import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPhotosLibraryRefinement} from '../specs/quint/legacy/photos-library/check-photos-library-refinement.mjs';

test('historical Photos profiles compare against mounted browser Photos', {timeout: 240000}, async () => {
  const {receipts: [receipt], mismatches} = await checkPhotosLibraryRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'PhotosLibraryReplay');
  assert.equal(receipt.traces, 4);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.deepEqual(mismatches.map(row => row.id), [
    'PhotosLibraryHistoricalOldestWindow', 'PhotosLibraryMountedWindowWidth',
    'PhotosLibraryHistoricalSelectionCap', 'PhotosLibraryHistoricalFavoriteToggle',
    'PhotosLibraryHistoricalSelectionClear', 'PhotosLibraryCurrentEditCopy',
  ]);
  assert.ok(mismatches.every(row => row.driverInputsBound && row.results[0].kind === 'observation-mismatch'));
});
