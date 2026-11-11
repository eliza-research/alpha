import assert from 'node:assert/strict';
import test from 'node:test';
import {checkBrowserJournalRetention} from '../specs/quint/refinement/application/browser-journal-retention.mjs';

test('browser retention and Calendar/Reminder mutation checkpoints match the exact-bound model', {timeout: 2_400_000}, async () => {
  const {receipt, obligations} = await checkBrowserJournalRetention();
  assert.equal(receipt.traces, 16);
  assert.equal(receipt.driverInputsBound, true);
  assert.ok(receipt.actions.appendReceipt > 0 && receipt.actions.appendDeletion > 0);
  assert.ok(obligations.length > 0);
});
