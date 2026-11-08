import assert from 'node:assert/strict';
import test from 'node:test';
import {checkNativeSmsDispatch} from '../specs/quint/refinement/native/sms-dispatch.mjs';

test('native SMS review, radio admission and callback readback refine the as-built source', async () => {
  const {receipt} = await checkNativeSmsDispatch();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 24);
  assert.equal(receipt.observedFields.length, 29);
});
