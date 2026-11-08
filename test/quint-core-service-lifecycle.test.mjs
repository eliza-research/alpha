import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {modelStateInventory, unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';
import {runCoreServiceLifecycleRefinement} from '../specs/quint/refinement/services/core-runtime/lifecycle.mjs';

test('shared service lifecycle checks actual registry and hook settlement', async () => {
  const receipt = await runCoreServiceLifecycleRefinement();
  assert.equal(receipt.traces, 18);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  const inventory = modelStateInventory(resolve('specs/quint/services/CoreServiceLifecycle.qnt'), 'CoreServiceLifecycle');
  assert.deepEqual(unobservedStateFields(inventory, receipt.observedFields), []);
});
