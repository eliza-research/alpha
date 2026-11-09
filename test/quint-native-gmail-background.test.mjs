import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeGmailBackground} from '../specs/quint/refinement/native/gmail-background.mjs';

test('native Gmail worker refines selected scheduling, cursor and retirement boundaries', async () => {
  const {receipt}=await checkNativeGmailBackground();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,14);
  assert.equal(receipt.observedFields.length,38);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
