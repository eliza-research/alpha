import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkAndroidBuildInputReadiness} from '../specs/quint/refinement/services/android-build-input-readiness.mjs';

test('native Android prerequisite reports and early/full refusals refine the readiness model', {timeout: 120000}, async () => {
  const receipt = await checkAndroidBuildInputReadiness([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.observedFields.length, 6);
});
