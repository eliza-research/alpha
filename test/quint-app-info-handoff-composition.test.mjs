import assert from 'node:assert/strict';
import test from 'node:test';
import {checkAppInfoHandoffComposition} from '../specs/quint/refinement/application/app-info-handoff-composition.mjs';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';

test('mounted App info hands the exact selection to native and settles the resulting reply', async () => {
  const {receipt} = await checkAppInfoHandoffComposition();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,10);
  assert.equal(receipt.observedFields.length,11);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
