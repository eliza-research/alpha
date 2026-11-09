import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkHomeGesture} from '../specs/quint/refinement/application/home-gesture.mjs';

test('Home pointer, timeout, keyboard and edit ownership follow the mounted source', {timeout: 120000}, async () => {
  const receipt = await checkHomeGesture([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 20);
  assert.equal(receipt.checkpoints, 114);
});
