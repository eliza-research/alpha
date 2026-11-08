import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeMmsDispatch} from '../specs/quint/refinement/native/mms-dispatch.mjs';

test('native MMS review, shared ID collisions and PDU custody refine as-built source', async () => {
  const {receipt}=await checkNativeMmsDispatch();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,17);
  assert.equal(receipt.observedFields.length,23);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
