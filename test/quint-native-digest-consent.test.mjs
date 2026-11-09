import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeDigestConsent} from '../specs/quint/refinement/native/native-digest.mjs';

test('native digest consent and readback refine the exact selected-source host', async () => {
  const {receipt}=await checkNativeDigestConsent();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,18);
  assert.equal(receipt.observedFields.length,24);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
