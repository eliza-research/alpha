import test from 'node:test';
import assert from 'node:assert/strict';
import {runProviderExecutionRefinement} from '../specs/quint/legacy/core/check-provider-execution-refinement.mjs';

test('current provider composition refines keyed and one-off execution schedules', async () => {
  const receipts = await runProviderExecutionRefinement();
  assert.deepEqual(receipts.map(receipt => receipt.traces), [4, 3]);
  for (const receipt of receipts) {
    assert.equal(receipt.passed, true);
    assert.equal(receipt.inputsUnchanged, true);
    assert.equal(receipt.driverInputsBound, true);
    assert.deepEqual(receipt.observedFields, [
      'observed.active', 'observed.cause', 'observed.cleaned', 'observed.created',
      'observed.exec', 'observed.map', 'observed.pc', 'observed.settled',
      'observed.sigAborted', 'observed.stopped', 'observed.stopping',
      'observed.waiters', 'safety',
    ]);
  }
});
