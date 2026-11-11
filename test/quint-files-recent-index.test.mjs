import test from 'node:test';
import assert from 'node:assert/strict';
import {replayFilesRecentIndex} from '../specs/quint/refinement/application/files-recent-index.mjs';

test('Files Recent and scan export follow every FilesRecentIndex model step', {timeout: 180000}, async () => {
  const receipt = await replayFilesRecentIndex({traces: 200, maxSteps: 14});
  assert.equal(receipt.traces, 200);
  assert.ok(receipt.steps > 1000, JSON.stringify(receipt));
  for (const action of ['accept', 'savedPdf', 'close', 'treeSessionEnds']) assert.ok(receipt.actions[action] > 0, action);
});
test('a scan export that releases the open document is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayFilesRecentIndex({traces: 200, maxSteps: 14, rewrite: {'prototype/scan-pdf.ts': text =>
    text.replace('if(evicted!==filesIndex.open())', 'if(true)')}}), /trace \d+ step \d+ savedPdf/);
});
test('a scan export that keeps an evicted grant is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayFilesRecentIndex({traces: 200, maxSteps: 14, rewrite: {'prototype/scan-pdf.ts': text =>
    text.replace('if(evicted!==filesIndex.open())', 'if(false)')}}), /trace \d+ step \d+ savedPdf/);
});
