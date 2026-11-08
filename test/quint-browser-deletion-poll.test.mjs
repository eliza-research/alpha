import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {runBrowserDeletionPollRefinement} from '../specs/quint/refinement/application/browser-deletion-poll.mjs';

test('overlapping Calendar and Reminder polls preserve the committed deletion revision', async () => {
  const {receipts} = await runBrowserDeletionPollRefinement([fileURLToPath(import.meta.url)]);
  assert.equal(receipts[0].passed, true);
  assert.equal(receipts[0].traces, 6);
  assert.equal(receipts[0].checkpoints, 34);
});
