import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkMobileBundleAdmission} from '../specs/quint/refinement/services/mobile-bundle-admission.mjs';

test('mobile bundle receipt admission matches reviewed inputs, transforms and exact readback', {timeout: 120000}, async () => {
  const receipt = await checkMobileBundleAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 11);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
});
