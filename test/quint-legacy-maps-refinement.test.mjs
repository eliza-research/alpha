import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkMapsRefinement} from '../specs/quint/legacy/maps/check-maps-refinement.mjs';

test('historical Maps compares against the current mounted browser and Cloud provider', {timeout: 420000}, async () => {
  const {receipts: [receipt], mismatches, portrait, landscape} = await checkMapsRefinement([fileURLToPath(import.meta.url)]);
  assert.deepEqual(portrait.map(({width, height, percent}) => [width, height, percent]),
    [[412, 915, 100], [360, 640, 100], [412, 915, 150], [360, 640, 150]]);
  assert.deepEqual(landscape.map(({width, height, percent}) => [width, height, percent]),
    [[915, 412, 100], [640, 360, 100], [915, 412, 150], [640, 360, 150]]);
  assert.equal(receipt.model, 'MapsReplay');
  assert.equal(receipt.traces, 4);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
  assert.deepEqual(mismatches.map(row => row.id), [
    'MapsHistoricalPassiveOfflineNotice', 'MapsHistoricalOfflinePrompt', 'MapsHistoricalDirectionsBeforeOrigin', 'MapsHistoricalChatInterruption',
    'MapsHistoricalArrivalClearsRoute', 'MapsHistoricalFailedRerouteKeepsRoute',
  ]);
  assert.ok(mismatches.every(row => row.driverInputsBound && row.results[0].kind === 'observation-mismatch'));
});
