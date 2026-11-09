import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkGoogleCalendarLinkFlow} from '../specs/quint/refinement/application/google-calendar-link-flow.mjs';

test('Google Calendar setup reports sync only from current destination readback', {timeout: 120000}, async () => {
  const receipt = await checkGoogleCalendarLinkFlow([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 42);
  assert.equal(receipt.checkpoints, 205);
});
