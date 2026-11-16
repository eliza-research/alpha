import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {observedReplay} from '../specs/quint/refinement/observed-replay.mjs';
import {replayPhotoLibraryAgentReview, replayPhotoLibraryAgentVisibility} from '../specs/quint/refinement/application/photo-library-agent-review.mjs';

const adapter = 'prototype/photo-library-adapter.ts';
test('the Photos agent bridge follows the sampled PhotoLibraryAgentReview steps', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await replayPhotoLibraryAgentReview({traces: 300, maxSteps: 24});
  assert.equal(receipt.traces, 308);
  assert.ok(receipt.steps > 2000, JSON.stringify(receipt));
  for (const action of ['request', 'validated', 'confirmPress', 'confirmValidated', 'androidSettles', 'leave', 'dispose']) assert.ok(receipt.actions[action] > 0, action);
});
test('a second confirm press that dispatches its review again is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayPhotoLibraryAgentReview({traces: 40, maxSteps: 24, rewrite: {[adapter]: text =>
    text.replace('if (review !== pending) return;', '')}}), /trace \d+ step \d+ confirmValidated|two changes handed to Android/);
});
test('a review opened after Photos was left during validation is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayPhotoLibraryAgentReview({traces: 40, maxSteps: 24, rewrite: {[adapter]: text =>
    text.replace("if (token !== epoch || disposed) throw new LibraryAgentRefusal('Open Photos, then ask again.');", '')}}), /trace \d+ step \d+ validated/);
});

test('the mounted Photos review follows the visibility schedules', {timeout:scaledTimeout(120000)}, async () => {
  const receipt = await observedReplay({
    model:'PhotoLibraryAgentReview', prefix:'s',
    projection:'Actual whole adapter review, validation, dispatch and settlement with fixture host/view inputs',
    assumptions:[
      'The mounted Photos adapter handles real document visibilitychange events. The Photos host visibility, its own album/share state, and native/provider IO are controlled ports.',
      'The directed traces compare retirement of a pending confirmation, continuation of a dispatched change, and provider responses while hidden or after returning.',
    ],
    extraSources:[fileURLToPath(import.meta.url)],
    out:'test-results/quint-refinement/PhotoLibraryAgentVisibility.json',
    run:() => replayPhotoLibraryAgentVisibility(),
  });
  assert.equal(receipt.traces, 4);
  assert.equal(receipt.checkpoints, 26);
  assert.equal(receipt.actions.hidePage, 4);
  assert.equal(receipt.actions.showPage, 3);
  assert.equal(receipt.driverInputsBound && receipt.inputsUnchanged && verifyRefinementReceiptInputs(receipt), true);
});

test('a hidden Photos review that keeps its old confirmation is rejected', {timeout:scaledTimeout(120000)}, async () => {
  await assert.rejects(replayPhotoLibraryAgentVisibility({rewrite:{[adapter]: text =>
    text.replace("if (document.hidden && review) { review = undefined; status = ''; changed(); }",
      "if (document.hidden && review) { status = ''; changed(); }")}}), /trace 0 step 4 hidePage/);
});
