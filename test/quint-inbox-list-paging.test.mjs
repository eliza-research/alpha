import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkInboxListPaging} from '../specs/quint/refinement/services/inbox-list-paging.mjs';
test('real Inbox list paging retains cursor and selection guards with actual prefetch',async()=>{
 const {receipt,coverage}=await checkInboxListPaging([fileURLToPath(import.meta.url)]);
 assert.equal(receipt.passed,true);assert.equal(receipt.traces,15);assert.equal(receipt.observedFields.length,14);
 assert.equal(receipt.inputsUnchanged,true);assert.equal(receipt.driverInputsBound,true);assert.equal(verifyRefinementReceiptInputs(receipt),true);
 assert.ok(coverage.providerRequests>20);assert.equal(coverage.witnesses.length,3);assert.equal(coverage.canaries.length,2);
 assert.equal(coverage.selectedNamedScenarios.length,6);
});
