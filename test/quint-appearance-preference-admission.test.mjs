import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkAppearancePreferenceAdmission} from '../specs/quint/refinement/application/appearance-preference-admission.mjs';

// Partial source contract regression. Original extracted member schedules and ports remain bounded.
// This does not establish whole-file refinement, installed behavior or acceptance.
test('partial source contract: AppearancePreferenceAdmission retains its original source schedules', {timeout: 240000}, async () => {
  const receipt = await checkAppearancePreferenceAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'AppearancePreferenceAdmission');
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
