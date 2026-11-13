import test from 'node:test';
import assert from 'node:assert/strict';
import {replayPhotoLibraryAgentReview} from '../specs/quint/refinement/application/photo-library-agent-review.mjs';

const adapter = 'prototype/photo-library-adapter.ts';
test('the Photos agent bridge follows every PhotoLibraryAgentReview model step', {timeout: 240000}, async () => {
  const receipt = await replayPhotoLibraryAgentReview({traces: 300, maxSteps: 24});
  assert.equal(receipt.traces, 308);
  assert.ok(receipt.steps > 2000, JSON.stringify(receipt));
  for (const action of ['request', 'validated', 'confirmPress', 'confirmValidated', 'androidSettles', 'leave', 'dispose']) assert.ok(receipt.actions[action] > 0, action);
});
test('a second confirm press that dispatches its review again is rejected by the replay', {timeout: 240000}, async () => {
  await assert.rejects(replayPhotoLibraryAgentReview({traces: 40, maxSteps: 24, rewrite: {[adapter]: text =>
    text.replace('if (review !== pending) return;', '')}}), /trace \d+ step \d+ confirmValidated|two changes handed to Android/);
});
test('a review opened after Photos was left during validation is rejected by the replay', {timeout: 240000}, async () => {
  await assert.rejects(replayPhotoLibraryAgentReview({traces: 40, maxSteps: 24, rewrite: {[adapter]: text =>
    text.replace("if (token !== epoch || disposed) throw new LibraryAgentRefusal('Open Photos, then ask again.');", '')}}), /trace \d+ step \d+ validated/);
});
