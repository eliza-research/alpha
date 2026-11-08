import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkHistoricalCameraSession} from '../specs/quint/refinement/legacy/camera-session.mjs';

test('current mounted Camera matches selected original Design session transitions', {timeout: 240_000}, async () => {
  const {receipts: [receipt], obligations} = await checkHistoricalCameraSession([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 4);
  assert.equal(receipt.checkpoints, 27);
  assert.equal(obligations.length, 2);
});
