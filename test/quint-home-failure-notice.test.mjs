import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkHomeFailureNotice} from '../specs/quint/refinement/application/home-failure-notice.mjs';

test('Home notices follow the actual installed launcher and current surface', {timeout: 120000}, async () => {
  const receipt = await checkHomeFailureNotice([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 9);
  assert.equal(receipt.checkpoints, 71);
});
