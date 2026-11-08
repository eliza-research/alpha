import assert from 'node:assert/strict';
import test from 'node:test';
import {checkNativeHostedInbox} from '../specs/quint/refinement/native/hosted-inbox.mjs';

test('hosted inbox source preserves scoped rows, exact acknowledgements and journal recovery', async () => {
  const {receipt} = await checkNativeHostedInbox();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 12);
  assert.equal(receipt.observedFields.length, 20);
});
