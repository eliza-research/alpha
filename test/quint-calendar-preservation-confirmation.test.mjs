import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkCalendarPreservationConfirmation} from '../specs/quint/refinement/application/calendar-preservation-confirmation.mjs';

test('mounted Calendar preservation matches exact review and owner-keyed marker traces', {timeout: 420_000}, async () => {
  const receipt = await checkCalendarPreservationConfirmation([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.checkpoints, 69);
});
