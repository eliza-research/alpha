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
import {checkAutomaticAppUpdateSchedule} from '../specs/quint/refinement/application/automatic-app-update-schedule.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

// Allow source authentication and replay in addition to the checker's two-minute subprocess budget.
test("partial source contract: foreground updates bind native offers, retire stale attempts, and retry without overlapping native calls",{timeout:scaledTimeout(180000)},async()=>{
  const receipt=await checkAutomaticAppUpdateSchedule();
  assert.equal(receipt.traceInputs.length,24);
  assert.equal(receipt.observedFields.length,20);
  assert.ok(receipt.passed&&receipt.inputsUnchanged&&receipt.driverInputsBound);
});
