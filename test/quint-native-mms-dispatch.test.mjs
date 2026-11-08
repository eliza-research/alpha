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

test('pinned MMS recovery reproduces the conflicting attachment and cross-kind receipts', async () => {
  await assert.rejects(mmsSourceProbe(['mms-attachment-conflict'],{pinnedProbe:true}),
    /Conflicting MMS approval must reject: submitted\/mms-send\/1/);
  await assert.rejects(mmsSourceProbe(['sms-first-mms-receives-sms'],{pinnedProbe:true}),
    /Cross-kind MMS approval must reject: submitted\/sms-send\/3/);
});
