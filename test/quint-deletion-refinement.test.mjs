import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDeletionCoordinator} from '../specs/quint/refinement/native/deletion-coordinator.mjs';
test('actual deletion coordinator refines durable dispatch and ownership', {timeout:600000}, async()=>{
 const result=await checkDeletionCoordinator();
 assert.equal(result.passed,true);assert.equal(result.traces,22);
 assert.equal(result.driverInputsBound,true);assert.equal(result.inputsUnchanged,true);
});
