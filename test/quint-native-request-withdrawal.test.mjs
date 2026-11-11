import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkNativeRequestWithdrawal} from '../specs/quint/refinement/native/request-withdrawal.mjs';

test('real renderer withdrawal and three native requests refine the two-worker model',async()=>{
 const {receipt,coverage}=await checkNativeRequestWithdrawal([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,42); // five named scenarios, 32 random traces and five witnesses
 assert.ok(receipt.checkpoints>500);
 assert.deepEqual(receipt.observedFields,['answers','call','outcome','phase','renderer','sent','withdrawable','withdrawnAt'].map(field=>'s.'+field).sort());
 assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);
 assert.equal(verifyRefinementReceiptInputs(receipt),true);
 assert.equal(coverage.namedScenarios,5);assert.equal(coverage.witnesses.length,5);
 assert.deepEqual(coverage.canaries,['duplicate-answer','duplicate-dispatch','state-mismatch']);
 for(const action of ['request','take','dispatch','transportAnswers','abort','cancelRequest','supersede'])assert.ok(receipt.actions[action]>0,action);
});
