import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkLiveCapture,liveCaptureScenarios} from '../specs/quint/refinement/native/live-capture.mjs';

test('actual shared live capture fences late admission and preserves cancellation cleanup', {timeout:scaledTimeout(360000)}, async()=>{
  const receipt=await checkLiveCapture(['test/quint-live-capture.test.mjs']);
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,liveCaptureScenarios.length);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
  assert.ok(receipt.actions.finishOpen>0);
  assert.ok(receipt.actions.stop>0);
  assert.ok(receipt.actions.closeHost>0);
});
