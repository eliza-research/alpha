import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkResidentCoordinator} from '../specs/quint/refinement/native/resident-coordinator.mjs';

test('actual resident coordinator refines admission, cancellation and teardown', {timeout:scaledTimeout(600000)}, async()=>{
  const receipt=await checkResidentCoordinator();
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,10);
  assert.equal(receipt.driverInputsBound,true);
  assert.equal(receipt.inputsUnchanged,true);
});
