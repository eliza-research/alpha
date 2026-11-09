import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeSourceRenewal} from '../specs/quint/refinement/native/source-renewal.mjs';

test('native source renewal journal, alert, and tap custody refine actual app source', async () => {
  const {receipt}=await checkNativeSourceRenewal();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,11);
  assert.equal(receipt.observedFields.length,16);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
