import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runFactWriteScopeRefinement} from '../specs/quint/refinement/services/fact-write-scope.mjs';

test('real fact writes refine room lanes, exact lookup eviction and known rejection', async () => {
  const {receipts: [receipt]} = await runFactWriteScopeRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 6);
  assert.ok(receipt.observedFields.includes('ranks'));
});
