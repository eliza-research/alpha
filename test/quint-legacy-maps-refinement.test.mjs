import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkMapsRefinement} from '../specs/quint/legacy/maps/check-maps-refinement.mjs';

test('historical Maps compares against the current mounted browser and Cloud provider', {timeout: 240000}, async () => {
  const {receipts: [receipt], mismatches} = await checkMapsRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'MapsReplay');
  assert.equal(receipt.traces, 4);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.deepEqual(mismatches.map(row => row.id), [
    'MapsHistoricalPassiveOfflineNotice', 'MapsHistoricalOfflinePrompt', 'MapsHistoricalDirectionsBeforeOrigin', 'MapsHistoricalChatInterruption',
    'MapsHistoricalArrivalClearsRoute', 'MapsHistoricalFailedRerouteKeepsRoute',
  ]);
  assert.ok(mismatches.every(row => row.driverInputsBound && row.results[0].kind === 'observation-mismatch'));
});
