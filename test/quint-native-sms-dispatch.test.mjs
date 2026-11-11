import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeSmsDispatch, historicalSmsSourceTraces} from '../specs/quint/refinement/native/sms-dispatch.mjs';

test('native SMS review, radio admission and callback readback refine authenticated staged source', async () => {
  const {receipt} = await checkNativeSmsDispatch();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 27);
  assert.equal(receipt.observedFields.length, 30);
  assert.equal(verifyRefinementReceiptInputs(receipt), true);
});

test('historical SMS positive recovery reproduces the conflicting binding regression separately from the repaired current pin', () => {
  assert.throws(() => historicalSmsSourceTraces(['cross-dialog-binding']),
    /Conflicting reviewed tuple cannot receive the retained receipt or repeat radio dispatch/);
});
