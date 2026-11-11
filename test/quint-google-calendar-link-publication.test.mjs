import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkGoogleCalendarLinkPublication} from '../specs/quint/refinement/application/google-calendar-link-publication.mjs';

test('the mounted Google Calendar panel publishes only its current link result', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkGoogleCalendarLinkPublication([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 23);
  assert.equal(receipt.checkpoints, 181);
});
