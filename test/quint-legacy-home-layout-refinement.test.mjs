import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkHomeLayoutRefinement} from '../specs/quint/legacy/home-layout/check-home-layout-refinement.mjs';

test('historical Home layouts replay mounted content and preserve deliberate differences', {timeout: 240000}, async () => {
  const {receipts, mismatches} = await checkHomeLayoutRefinement([fileURLToPath(import.meta.url)]);
  assert.deepEqual(receipts.map(row => [row.model, row.traces]), [['HomeLayoutCurrentReplay', 1], ['HomeLayout', 1]]);
  assert.ok(receipts.every(row => row.passed && row.driverInputsBound && row.inputsUnchanged));
  assert.deepEqual(mismatches.map(row => row.id), [
    'HomeLayoutCurrentEmptyShells', 'HomeLayoutProposedDateLine', 'HomeLayoutProposedSetupLink', 'HomeLayoutCurrentGrid',
  ]);
  assert.ok(mismatches.every(row => row.driverInputsBound && row.results[0].kind === 'observation-mismatch'));
});
