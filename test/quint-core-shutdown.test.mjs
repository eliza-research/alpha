import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {modelStateInventory, unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';
import {runCoreRuntimeShutdownRefinement} from '../specs/quint/refinement/services/core-runtime/shutdown.mjs';

test('actual AgentRuntime shutdown owns admission and strict retirement', async () => {
  const receipt = await runCoreRuntimeShutdownRefinement();
  assert.equal(receipt.traces, 13);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  const inventory = modelStateInventory(resolve('specs/quint/services/CoreRuntimeShutdown.qnt'), 'CoreRuntimeShutdown');
  assert.deepEqual(unobservedStateFields(inventory, receipt.observedFields), []);
});
