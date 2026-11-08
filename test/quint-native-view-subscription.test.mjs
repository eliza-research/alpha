import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeViewSubscription} from '../specs/quint/refinement/application/native-view-subscription.mjs';

test('native view subscriptions retire across delayed replies and cleanup failures', async () => {
  const receipt = await checkNativeViewSubscription();
  assert.equal(receipt.traces, 20);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.deepEqual(receipt.observedFields, ['s']);
});
