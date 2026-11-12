import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRendererCoordinator} from '../specs/quint/refinement/native/renderer-coordinator.mjs';

test('actual MainActivity recovery and handoff refine the native model', {timeout: scaledTimeout(300000)}, async () => {
  const receipt = await checkRendererCoordinator();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 27);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.inputsUnchanged, true);
});
