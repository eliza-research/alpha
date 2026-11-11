import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkPlanAdmissionGrace} from '../specs/quint/refinement/services/plan-admission-grace.mjs';
test('real Alpha and shared admission enforce bounded credential-bound plan grace',async()=>{
 const {receipt,coverage}=await checkPlanAdmissionGrace([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.traces,30);assert.equal(receipt.observedFields.length,9);
 assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);assert.equal(verifyRefinementReceiptInputs(receipt),true);
 assert.equal(coverage.namedScenarios,8);assert.equal(coverage.witnesses.length,6);assert.equal(coverage.canaries.length,2);
});
