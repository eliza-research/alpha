import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkRuntimeUpdatePause} from '../specs/quint/refinement/native/runtime-update-pause.mjs';

test('the durable native update pause and exact wrapper refine real JVM readback', async () => {
  const {receipt, skipped} = await checkRuntimeUpdatePause([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces + skipped.length, 12);
  if (skipped.length === 0) assert.equal(receipt.checkpoints, 106);
  assert.ok(receipt.observedFields.includes('LeaseRetained'));
});
