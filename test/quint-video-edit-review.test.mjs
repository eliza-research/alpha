import test from 'node:test';
import assert from 'node:assert/strict';
import {replayVideoEditReview} from '../specs/quint/refinement/native/video-edit-review.mjs';

test('the mounted video editor follows every VideoEditReview model step', {timeout: 180000}, async () => {
  const receipt = await replayVideoEditReview({traces: 600, maxSteps: 16});
  assert.equal(receipt.traces, 600);
  assert.ok(receipt.steps > 3000, JSON.stringify(receipt));
  for (const action of ['sourceLoaded', 'sourceError', 'trim', 'rotate', 'toggleCrop', 'play', 'pause', 'commit', 'saveSettled', 'close', 'hide', 'show'])
    assert.ok(receipt.actions[action] > 0, action);
  assert.equal(receipt.framesLeftRunning, 0, 'a closed editor requests no more frames');
});
test('a source error during playback pauses the preview', {timeout: 180000}, async () => {
  await assert.rejects(replayVideoEditReview({traces: 600, maxSteps: 16, rewrite: {'prototype/video-edit-review.ts': text =>
    text.replace('loaded=false;video.pause();updateControls();', 'loaded=false;updateControls();')}}), /trace \d+ step \d+ sourceError/);
});
test('an editor that accepts a second save is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayVideoEditReview({traces: 600, maxSteps: 16, rewrite: {'prototype/video-edit-review.ts': text =>
    text.replace("busy=true;video.pause();updateControls();status.textContent='Saving video copy…';", "video.pause();status.textContent='Saving video copy…';")}}), /trace \d+ step \d+ /);
});
