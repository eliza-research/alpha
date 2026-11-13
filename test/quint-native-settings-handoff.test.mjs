import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeSettingsHandoff} from '../specs/quint/refinement/native/settings-handoff.mjs';

test('partial source contract: native Settings handoff and fallback refine authenticated product source', async () => {
  const {receipt}=await checkNativeSettingsHandoff();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,6);
  assert.equal(receipt.observedFields.length,6);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
