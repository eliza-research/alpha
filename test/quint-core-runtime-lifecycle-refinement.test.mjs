import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkRuntimeLifecycleRefinement} from '../specs/quint/legacy/core/check-runtime-lifecycle-refinement.mjs';

test('the translated runtime lifecycle matches actual startup and queued-turn shutdown', {timeout: 60000}, async () => {
  const receipt = await checkRuntimeLifecycleRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 3);
  assert.equal(receipt.checkpoints, 17);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
