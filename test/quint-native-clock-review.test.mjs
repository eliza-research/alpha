import assert from 'node:assert/strict';
import test from 'node:test';
import {checkNativeClockReview} from '../specs/quint/refinement/native/clock-review.mjs';

test('partial source contract: native Clock review and journal settlement refine the product handoff source', async () => {
  const {receipt} = await checkNativeClockReview();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 27);
  assert.equal(receipt.observedFields.length, 19);
});
