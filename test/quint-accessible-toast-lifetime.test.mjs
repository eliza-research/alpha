// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {checkAccessibleToastLifetime} from '../specs/quint/refinement/application/accessible-toast-lifetime.mjs';

test("partial source contract: actual shell timers use the current Android accessibility timeout", {timeout: scaledTimeout(60000)}, async () => {
  const receipt = await checkAccessibleToastLifetime();
  assert.equal(receipt.traceInputs.length, 12);
  assert.equal(receipt.observedFields.length, 10);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
