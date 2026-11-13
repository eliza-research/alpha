import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkFilesBrowserRefinement} from '../specs/quint/legacy/files-browser/check-files-browser-refinement.mjs';

test('historical Files design and ablations compare against mounted current Files', {timeout: scaledTimeout(240000)}, async () => {
  const {receipts: [receipt], mismatches} = await checkFilesBrowserRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'FilesBrowserReplay');
  assert.equal(receipt.traces, 3);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.deepEqual(mismatches.map(row => row.id), [
    'FilesBrowserHistoricalDownloads', 'FilesBrowserHistoricalOverwrite', 'FilesBrowserHistoricalStaleReview',
  ]);
  assert.ok(mismatches.every(row => row.driverInputsBound && row.results[0].kind === 'observation-mismatch'));
});
