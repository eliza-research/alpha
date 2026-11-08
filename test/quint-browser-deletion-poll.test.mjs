import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkBrowserDeletionPoll} from '../specs/quint/refinement/application/browser-deletion-poll.mjs';

test('overlapping Calendar and Reminder polls preserve the committed deletion revision', async () => {
  const {receipt} = await checkBrowserDeletionPoll([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 6);
  assert.equal(receipt.checkpoints, 34);
});
