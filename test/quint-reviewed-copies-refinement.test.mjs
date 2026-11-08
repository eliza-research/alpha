import assert from 'node:assert/strict';
import test from 'node:test';
import {checkReviewedCopies} from '../specs/quint/refinement/native/reviewed-copies.mjs';

test('real reviewed attachment cache and provider observations match the bounded model', async () => {
  const receipt = await checkReviewedCopies();
  assert.equal(receipt.traces, 7);
  assert.equal(receipt.driverInputsBound, true);
  assert.ok(receipt.actions.providerOpen > 0);
  assert.ok(receipt.observedFields.includes('s.owners'));
});
