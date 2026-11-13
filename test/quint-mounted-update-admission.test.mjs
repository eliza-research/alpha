// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMountedUpdateAdmission} from '../specs/quint/refinement/application/mounted-update-admission.mjs';

test("partial source contract: mounted Android updates require the current renderer and exact native activation", {timeout: scaledTimeout(60000)}, async () => {
  const receipt = await checkMountedUpdateAdmission();
  assert.equal(receipt.traceInputs.length, 12);
  assert.equal(receipt.observedFields.length, 17);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
