// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import assert from 'node:assert/strict';
import test from 'node:test';
import {checkAppInfoHandoffComposition} from '../specs/quint/refinement/application/app-info-handoff-composition.mjs';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';

test("partial source contract: mounted App info hands the exact selection to native and settles the resulting reply", async () => {
  const {receipt} = await checkAppInfoHandoffComposition();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,10);
  assert.equal(receipt.observedFields.length,11);
  assert.equal(verifyRefinementReceiptInputs(receipt),true);
});
