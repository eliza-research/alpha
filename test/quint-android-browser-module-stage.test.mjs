import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkAndroidBrowserModuleStage} from '../specs/quint/refinement/services/android-browser-module-stage.mjs';

test('authenticated browser module and Android host generation refine staged provenance', {timeout: 120000}, async () => {
  const receipt = await checkAndroidBrowserModuleStage([fileURLToPath(import.meta.url)]);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.checkpoints, 43);
  assert.equal(receipt.observedFields.length, 9);
});
