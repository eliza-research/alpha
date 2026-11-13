import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkRetainedReminderTapAdmission} from '../specs/quint/refinement/application/retained-reminder-tap-admission.mjs';

// Partial source contract regression. Original extracted member schedules and ports remain bounded.
// This does not establish whole-file refinement, installed behavior or acceptance.
test('partial source contract: RetainedReminderTapAdmission retains its original source schedules', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await checkRetainedReminderTapAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'RetainedReminderTapAdmission');
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
