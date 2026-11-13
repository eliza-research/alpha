import test from 'node:test';
import assert from 'node:assert/strict';
import {batchCaptureScenarios,checkBatchCaptureCompletion} from '../specs/quint/refinement/native/batch-capture-completion.mjs';

test('partial source contract: renderer batch capture rejects foreign or call-interrupted drafts and retains cleanup failure', {timeout:120000},async()=>{
 const receipt=await checkBatchCaptureCompletion(['test/quint-batch-capture-completion.test.mjs']);
 assert.equal(receipt.passed,true);
 assert.equal(receipt.traces,batchCaptureScenarios.length);
 assert.equal(receipt.driverInputsBound,true);
 assert.equal(receipt.inputsUnchanged,true);
 assert.equal(receipt.invariant,'safety');
 for(const action of ['stopped','acknowledge','refuseStart','metricsFailed','stop','abort','cancel'])
  assert.ok(receipt.actions[action]>0,action);
});
