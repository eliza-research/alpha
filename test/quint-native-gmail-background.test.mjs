import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeGmailBackground} from '../specs/quint/refinement/native/gmail-background.mjs';

test('native Gmail worker refines selected scheduling, cursor and retirement boundaries', async () => {
  const {receipt}=await checkNativeGmailBackground();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,31);
  assert.equal(receipt.observedFields.length,48);
  assert.ok(receipt.actions.work>=3*2);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
