import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBrowserReviews} from '../specs/quint/refinement/application/browser-reviews.mjs';

test('the browser review dialogs follow every BrowserReviews trace', {timeout: 240000}, async () => {
  const receipt = await checkBrowserReviews();
  assert.equal(receipt.traces, 49);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['confirm', 'approve', 'dismiss', 'hide', 'show', 'lockScreen', 'unlockScreen'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
