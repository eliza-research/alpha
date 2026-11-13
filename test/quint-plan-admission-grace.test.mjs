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
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkPlanAdmissionGrace} from '../specs/quint/refinement/services/plan-admission-grace.mjs';
test("partial source contract: real Alpha and shared admission enforce bounded credential-bound plan grace",async()=>{
 const {receipt,coverage}=await checkPlanAdmissionGrace([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.traces,33);assert.equal(receipt.observedFields.length,9);
 assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);assert.equal(verifyRefinementReceiptInputs(receipt),true);
 assert.equal(coverage.namedScenarios,9);assert.equal(coverage.witnesses.length,7);assert.equal(coverage.canaries.length,2);
});
