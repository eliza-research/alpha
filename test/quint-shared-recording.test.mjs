import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSharedRecording,sharedRecordingScenarios} from '../specs/quint/refinement/native/shared-recording.mjs';

test('actual shared recording bridge fences permission epochs and cancellation barriers', {timeout:scaledTimeout(360000)}, async()=>{
  const receipt=await checkSharedRecording(['test/quint-shared-recording.test.mjs']);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,sharedRecordingScenarios.length);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.ok(receipt.actions.permissionReply>0);
  assert.ok(receipt.actions.finishBarrier>0);
  assert.ok(receipt.actions.timeout>0);
});
