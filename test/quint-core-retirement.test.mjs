import test from 'node:test';
import assert from 'node:assert/strict';
import {runCoreRetirementRefinement} from '../specs/quint/refinement/services/core-runtime/retirement.mjs';

test('shared runtime retirement publishes and drains real lifecycle work', async () => {
  const receipt = await runCoreRetirementRefinement();
  assert.equal(receipt.traces, 13);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
});
