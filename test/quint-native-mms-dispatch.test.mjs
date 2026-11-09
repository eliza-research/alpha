import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeMmsDispatch, mmsSourceProbe} from '../specs/quint/refinement/native/mms-dispatch.mjs';

test('native MMS review, shared ID collisions and PDU custody refine authenticated staged source', async () => {
  const {receipt}=await checkNativeMmsDispatch();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,20);
  assert.equal(receipt.observedFields.length,25);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});

test('pinned MMS rejects conflicting attachments and cross-kind receipts without an overlay', async () => {
  for (const scenario of ['mms-attachment-conflict','sms-first-mms-receives-sms']) {
    assert.equal((await mmsSourceProbe([scenario],{pinnedProbe:true})).length,1);
  }
});
