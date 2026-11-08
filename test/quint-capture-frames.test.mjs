import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCaptureFrames,captureFrameScenarios} from '../specs/quint/refinement/native/capture-frames.mjs';

test('actual capture loop preserves pre-roll, packet order and terminal buffer zeroing', {timeout:360000}, async()=>{
  const result=await checkCaptureFrames(['test/quint-capture-frames.test.mjs']);
  assert.equal(result.passed,true);
  assert.equal(result.traces,captureFrameScenarios.length);
  assert.equal(result.driverInputsBound,true);
  assert.equal(result.inputsUnchanged,true);
  assert.ok(result.actions.readFailure>0);
  assert.ok(result.actions.stop>0);
});
