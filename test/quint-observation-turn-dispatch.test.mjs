import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkObservationTurnDispatch} from '../specs/quint/refinement/application/observation-turn-dispatch.mjs';

test('actual turn dispatch serializes optional observation only after exact peer admission', {timeout: 120000}, async () => {
  const receipt = await checkObservationTurnDispatch([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 20);
});
