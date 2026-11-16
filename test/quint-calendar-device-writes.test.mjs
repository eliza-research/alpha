import assert from 'node:assert/strict';
import test from 'node:test';
import {checkCalendarDeviceWrites} from '../specs/quint/refinement/application/calendar-device-writes.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

test('Calendar receipt publication and saves have separate draft ownership', {
  timeout: scaledTimeout(120000),
}, async () => {
  const receipt = await checkCalendarDeviceWrites(import.meta.filename);
  assert.equal(receipt.traces, 3);
  assert.equal(receipt.checkpoints, 30);
  assert.equal(receipt.passed, true);
  assert.ok(receipt.observedFields.includes('s.draftEpoch'));
  assert.equal(receipt.driverInputsBound, true);
});
