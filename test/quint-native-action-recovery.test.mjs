import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeActionRecovery} from '../specs/quint/refinement/native/action-recovery.mjs';

test('partial source contract: native action recovery and passive history refine exact journal and receipt source', async () => {
  const {receipt}=await checkNativeActionRecovery();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,35);
  assert.equal(receipt.observedFields.length,22);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
