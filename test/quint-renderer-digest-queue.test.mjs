import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkRendererDigestQueue} from '../specs/quint/refinement/application/renderer-digest-queue.mjs';

test('renderer digest sync queues by exact scope and retires queued callers', {timeout: 120000}, async () => {
  const receipt = await checkRendererDigestQueue([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 6);
  assert.deepEqual(receipt.observedFields, ['s.lastOrder', 's.requests']);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
