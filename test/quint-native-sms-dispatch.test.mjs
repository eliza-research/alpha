import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeSmsDispatch, smsSourceTraces} from '../specs/quint/refinement/native/sms-dispatch.mjs';
import {root} from './fixtures/jvm-tools.mjs';
import {join} from 'node:path';

test('native SMS review, radio admission and callback readback refine authenticated staged source', async () => {
  const {receipt} = await checkNativeSmsDispatch();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 26);
  assert.equal(receipt.observedFields.length, 30);
  assert.equal(verifyRefinementReceiptInputs(receipt), true);
});

test('pinned SMS rejects a conflicting retained binding without an overlay', () => {
  assert.equal(smsSourceTraces(['cross-dialog-binding'],join(root,'vendor/eliza')).length,1);
});
