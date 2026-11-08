import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserOwnerReminderAction} from '../specs/quint/refinement/application/browser-owner-reminder-action.mjs';

test('browser owner-reminder actions refine actual review, open and acknowledgement', {timeout: 120000}, async () => {
  const {receipt} = await checkBrowserOwnerReminderAction([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.observedFields.length, 20);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
