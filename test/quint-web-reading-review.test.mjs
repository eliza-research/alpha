import test from 'node:test';
import assert from 'node:assert/strict';
import {checkWebReadingReview} from '../specs/quint/refinement/services/web-reading-review.mjs';

test('the read-aloud review follows every WebReadingReview trace', {timeout: 240000}, async () => {
  const receipt = await checkWebReadingReview();
  assert.equal(receipt.traces, 47);
  assert.ok(receipt.checkpoints > 1000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['typeText', 'sourceSettles', 'read', 'stop', 'speechSettles', 'finish'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
