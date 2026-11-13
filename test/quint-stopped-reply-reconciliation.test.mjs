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
import test from 'node:test';
import {checkStoppedReplyReconciliation} from '../specs/quint/refinement/application/stopped-reply-reconciliation.mjs';

test("partial source contract: stopped-reply model schedules match the current connection controller", {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkStoppedReplyReconciliation();
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.actions.busySendRefused, 1);
  assert.equal(receipt.actions.readSettles, 7);
  assert.ok(receipt.checkpoints > 50);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
});
