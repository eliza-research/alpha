import assert from 'node:assert/strict';
import test from 'node:test';
import {checkVoiceSurfaceRetirement} from '../specs/quint/refinement/application/voice-surface-retirement.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

test('whole voice adapter retires media with the exact shown panel owner', {
  timeout: scaledTimeout(120000),
}, async () => {
  const receipt = await checkVoiceSurfaceRetirement(import.meta.filename);
  assert.equal(receipt.traces, 9);
  assert.equal(receipt.checkpoints, 45);
  assert.deepEqual(receipt.observedFields, ['s.panel', 's.retirement', 's.surface']);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
});
