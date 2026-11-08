import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserReminderOrphan} from '../specs/quint/refinement/application/browser-reminder-orphan.mjs';

test('actual Reminder storage and Clock refine persisted orphan marker behavior', async () => {
  const {receipt} = await checkBrowserReminderOrphan([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.checkpoints, 70);
  assert.ok(receipt.observedFields.includes('ReceiptHasEntry'));
});
