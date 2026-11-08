import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {modelStateInventory, unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';
import {runTurnControllerRefinement} from '../specs/quint/refinement/services/core-runtime/turns.mjs';

test('turn registries retain their own asynchronous context and cancellation authority', async () => {
  const receipt = await runTurnControllerRefinement();
  assert.equal(receipt.traces, 17);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  const state = modelStateInventory(resolve('specs/quint/services/CoreTurnControllers.qnt'), 'CoreTurnControllers');
  assert.deepEqual(unobservedStateFields(state, receipt.observedFields), []);
});
