import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {runNativeUpdateActivationRefinement} from '../specs/quint/refinement/native/update-barrier.mjs';

test('native update readiness and cancellation audiences match the activation model', {timeout: 120000}, async () => {
  const {receipts} = await runNativeUpdateActivationRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipts.length, 1);
  const [receipt] = receipts;
  assert.equal(receipt.model, 'NativeUpdateActivation');
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.passed, true);
});
