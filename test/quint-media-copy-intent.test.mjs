import test from 'node:test';
import assert from 'node:assert/strict';
import {replayMediaCopyIntent} from '../specs/quint/refinement/application/media-copy-intent.mjs';

test('saved-copy request storage follows every MediaCopyIntent model step on both platforms', {timeout: 180000}, async () => {
  const receipt = await replayMediaCopyIntent({traces: 400, maxSteps: 20});
  assert.equal(receipt.traces, 400);
  assert.ok(receipt.steps > 2000, JSON.stringify(receipt));
  for (const action of ['admit', 'acknowledge', 'restart', 'recover']) assert.ok(receipt.actions[action] > 0, action);
});

test('a saved-copy store without the compare step is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayMediaCopyIntent({traces: 400, maxSteps: 20, rewrite: {'runtime/media-copy-intent.ts': text =>
    text.replace("if(JSON.stringify(decode(archive))!==JSON.stringify(expected))throw", 'if(false)throw')}}), /trace \d+ step \d+ (admit|acknowledge)/);
});
