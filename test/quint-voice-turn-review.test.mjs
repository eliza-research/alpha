import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {runVoiceTurnReviewReplay} from '../specs/quint/refinement/application/voice-turn-review.mjs';

// VoiceTurnReview model traces (scenarios, witnesses and random walks from the pinned Quint CLI)
// replayed step by step against the installed voice adapter in the voice view fixture: a spoken
// turn is held for review, edited, sent or discarded through the panel's own controls, and the
// reply decides whether voice listens again, pauses for the owner or stops for a phone action.
test('the voice transcript review follows every VoiceTurnReview model trace', {timeout: scaledTimeout(300000)}, async () => {
  const receipt = await runVoiceTurnReviewReplay();
  assert.equal(receipt.traces, 92);
  assert.ok(receipt.checkpoints > 2000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['start', 'transcriptReady', 'edit', 'sendReviewed', 'discard', 'currencyLost', 'currencyBack', 'replyArrives', 'recover', 'close'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
