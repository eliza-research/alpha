import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkFilesBrowserController} from '../specs/quint/refinement/application/files-browser-coordinator.mjs';

test('Files readback and listings retain the current request across late native completions', {timeout:120000}, async () => {
  const receipt = await checkFilesBrowserController([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 14);
});
