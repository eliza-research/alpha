import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCameraPreviewRetirement} from '../specs/quint/refinement/application/camera-preview-retirement.mjs';

test('mounted Camera retirement matches preview ownership across the Home commit', {timeout: 240_000}, async () => {
  const receipt = await checkCameraPreviewRetirement([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 3);
  assert.ok(receipt.checkpoints >= 24);
});
