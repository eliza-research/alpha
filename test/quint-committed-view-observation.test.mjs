import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkCommittedViewObservation} from '../specs/quint/refinement/application/committed-view-observation.mjs';

test('the committed view observer refines exact host settlement and cache ownership', {timeout: 120000}, async () => {
  const receipt = await checkCommittedViewObservation([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 18);
});
