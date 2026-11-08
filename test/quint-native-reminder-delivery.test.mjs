import assert from 'node:assert/strict';
import test from 'node:test';
import {checkNativeReminderDelivery} from '../specs/quint/refinement/native/reminder-delivery.mjs';

test('native reminder ownership, notification ordering and reviewed alarm receipts refine the source', async () => {
  const {receipt} = await checkNativeReminderDelivery();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 17);
  assert.equal(receipt.observedFields.length, 29);
});
