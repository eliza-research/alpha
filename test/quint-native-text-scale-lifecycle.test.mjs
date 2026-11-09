import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeTextScaleLifecycle} from '../specs/quint/refinement/native/text-scale-lifecycle.mjs';

test('native text zoom and timeout readback refine actual Activity and bridge source', async () => {
  const {receipt}=await checkNativeTextScaleLifecycle();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,8);
  assert.equal(receipt.observedFields.length,7);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
