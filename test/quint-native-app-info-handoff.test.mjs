import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeAppInfoHandoff} from '../specs/quint/refinement/native/app-info-handoff.mjs';

test('native App info refines exact package and profile handoff without fallback', async () => {
  const {receipt} = await checkNativeAppInfoHandoff();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 12);
  assert.equal(receipt.checkpoints, 79);
  assert.equal(receipt.observedFields.length, 15);
  assert.equal(verifyRefinementReceiptInputs(receipt), true);
});
