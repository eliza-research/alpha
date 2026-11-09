import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {runTaskServiceRefinement} from '../specs/quint/refinement/services/task-service/index.mjs';

test('TaskService source traces refine counted execution, stop and persistent orphan state', {timeout: 300000}, async () => {
  const result=await runTaskServiceRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(result.receipts.length,1);
  const receipt=result.receipts[0];
  assert.equal(receipt.model,'TaskServiceLifecycle');
  assert.equal(receipt.invariant,'safety');
  assert.equal(receipt.passed,true);
  assert.equal(receipt.traces,13);
  assert.equal(receipt.checkpoints,85);
  assert.equal(receipt.sourceCapture,'before driver execution');
  assert.equal(receipt.driverInputsBound,true);
  assert.ok(receipt.observedFields.includes('s.tracked'));
  assert.ok(receipt.observedFields.includes('s.quarantined'));
  assert.ok(result.obligations.length>0);
});
