import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkHistoricalCalendarNavigation} from '../specs/quint/refinement/legacy/calendar-navigation.mjs';

test('current mounted Calendar matches selected original proposed navigation', {timeout: 240_000}, async () => {
  const {receipts: [receipt], obligations} = await checkHistoricalCalendarNavigation([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 4);
  assert.equal(receipt.checkpoints, 16);
  assert.equal(obligations.length, 2);
});
