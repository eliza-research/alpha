import assert from 'node:assert/strict';
import test from 'node:test';
import {checkNativeHostedResultNotices} from '../specs/quint/refinement/native/hosted-result-notices.mjs';

test('hosted result ledger preserves exact routes, redaction and durable token behavior', async () => {
  const {receipt} = await checkNativeHostedResultNotices();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 13);
  assert.equal(receipt.observedFields.length, 15);
});
