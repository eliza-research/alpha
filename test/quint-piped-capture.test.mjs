import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPipedCapture,pipedCaptureScenarios} from '../specs/quint/refinement/native/piped-capture.mjs';

test('actual capture waits for ASR warmup and retains exact pipe cleanup results', {timeout:360000}, async()=>{
  const result=await checkPipedCapture(['test/quint-piped-capture.test.mjs']);
  assert.equal(result.passed,true);
  assert.equal(result.traces,pipedCaptureScenarios.length);
  assert.equal(result.driverInputsBound,true);
  assert.equal(result.inputsUnchanged,true);
  assert.ok(result.actions.warmReply>0);
  assert.ok(result.actions.stopFinishedPipe>0);
  assert.ok(result.actions.destroy>0);
});
