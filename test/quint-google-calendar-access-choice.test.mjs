import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkGoogleCalendarAccessChoice} from '../specs/quint/refinement/application/google-calendar-access-choice.mjs';

test('Calendar access choice belongs to the exact verified account read and current intent', {timeout: 120000}, async () => {
  const receipt = await checkGoogleCalendarAccessChoice([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 17);
  assert.equal(receipt.checkpoints, 118);
});
