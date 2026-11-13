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

import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkNotesCoordinator} from '../specs/quint/refinement/application/notes-coordinator.mjs';

test("partial source contract: real Notes coordinator preserves queued edits across unknown commits and restart", {timeout:scaledTimeout(60000)}, async () => {
  const receipt=await checkNotesCoordinator([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces,2);
  assert.equal(receipt.checkpoints,10);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.equal(receipt.driverInputsBound,true);
});
