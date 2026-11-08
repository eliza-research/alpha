import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkInteractionSessionRefinement} from '../specs/quint/legacy/core/check-interaction-session-refinement.mjs';

test('the current interaction authority and SQLite store follow both translated lease profiles', {timeout: 120000}, async () => {
  const receipts = await checkInteractionSessionRefinement(undefined, [fileURLToPath(import.meta.url)]);
  assert.deepEqual(receipts.map(receipt => [receipt.model, receipt.traces, receipt.checkpoints]), [
    ['CoreInteractionSession', 9, 85],
    ['CoreInteractionSessionRetries', 3, 36],
  ]);
  assert.ok(receipts.every(receipt => receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound));
});
