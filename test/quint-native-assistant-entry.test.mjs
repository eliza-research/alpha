import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeAssistantEntry} from '../specs/quint/refinement/native/assistant-entry.mjs';

test('native assistant Activities and tile refine the exact closed-source entry paths', async () => {
  const {receipt}=await checkNativeAssistantEntry();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,69);
  assert.equal(receipt.observedFields.length,16);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
