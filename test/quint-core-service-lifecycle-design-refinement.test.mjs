import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkServiceLifecycleDesignRefinement} from '../specs/quint/legacy/core/check-service-lifecycle-refinement.mjs';

test('the original service lifecycle profiles match bounded startup, unload and teardown schedules', {timeout: scaledTimeout(120000)}, async () => {
  const {receipts, mismatch} = await checkServiceLifecycleDesignRefinement([fileURLToPath(import.meta.url)]);
  assert.deepEqual(receipts.map(receipt => receipt.model), ['CoreServiceLifecycleDesign', 'CoreServiceLifecycleDesignSiblings']);
  assert.deepEqual(receipts.map(receipt => receipt.traces), [5, 2]);
  assert.ok(receipts.every(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound));
  assert.equal(mismatch.passed, false);
  assert.equal(mismatch.results[0].kind, 'observation-mismatch');
});
