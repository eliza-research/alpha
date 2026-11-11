import assert from 'node:assert/strict';
import test from 'node:test';
import {checkNativeDeletionReviewAdmission} from '../specs/quint/refinement/native/deletion-review-admission.mjs';

test('actual native deletion review admission refines every four-call token history',async()=>{
 const receipt=await checkNativeDeletionReviewAdmission();
 assert.equal(receipt.passed,true);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.traces,81);
 assert.equal(receipt.checkpoints,405);
});
