import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkReminderOpenIntent} from '../specs/quint/refinement/application/reminder-open-intent.mjs';

// Partial source contract regression. Original extracted member schedules and ports remain bounded.
// This does not establish whole-file refinement, installed behavior or acceptance.
test('partial source contract: ReminderOpenIntent retains its original source schedules', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await checkReminderOpenIntent([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.model, 'ReminderOpenIntent');
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
