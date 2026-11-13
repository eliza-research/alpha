// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {checkCloudPlanRecheck} from '../specs/quint/refinement/application/cloud-plan-recheck.mjs';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';

test("partial source contract: actual Cloud return guards preserve minute limits, current scope and owner cancellation", {timeout: scaledTimeout(60_000)}, async () => {
  const receipt = await checkCloudPlanRecheck([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(receipt.traces, 7);
  assert.equal(receipt.observedFields.length, 9);
  assert.equal(Object.keys(receipt.generatedSourceSnapshots).length, 1);
  assert.ok(verifyRefinementReceiptInputs(receipt), 'Generated input remains independently revalidatable after cleanup');
  for (const action of ['network', 'visibility', 'replaceScope', 'minute', 'request', 'settle', 'cancelForOwnerAction'])
    assert.ok(receipt.actions[action] > 0, action);
});
