import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserOwnerReminderRead} from '../specs/quint/refinement/application/browser-owner-reminder-read.mjs';

test('browser owner-reminder passive reads refine real owner retirement, caching and budget', {timeout: 120000}, async () => {
  const {receipt} = await checkBrowserOwnerReminderRead([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.observedFields.length, 16);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
