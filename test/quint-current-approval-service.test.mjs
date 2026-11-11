import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {modelStateInventory, unobservedStateFields} from '../specs/quint/refinement/model-state.mjs';
import {checkCoreApprovalServiceCurrentRefinement} from '../specs/quint/refinement/services/current-approval-service.mjs';

test('current approvals refuse orphan callbacks and drain admitted work before stop settles', {timeout:120000}, async () => {
  const receipt = await checkCoreApprovalServiceCurrentRefinement(undefined, [fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 15);
  const inventory = modelStateInventory(resolve('specs/quint/services/CoreApprovalServiceCurrent.qnt'), 'CoreApprovalServiceCurrent');
  assert.deepEqual(unobservedStateFields(inventory, receipt.observedFields), []);
  for (const name of ['pendingWork', 'state.stopDone', 'state.unavailable', 'state.blocked', 'state.deleteCalls'])
    assert.ok(receipt.observedFields.includes(name), name);
});
