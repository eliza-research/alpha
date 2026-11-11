import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkGoogleCalendarDisconnect} from '../specs/quint/refinement/application/google-calendar-disconnect.mjs';

test('Calendar cleanup and callback retirement settle independently of Google revoke', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkGoogleCalendarDisconnect([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 59);
  assert.equal(receipt.checkpoints, 272);
});
