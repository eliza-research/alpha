import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {replayDeletionNoticeFence} from '../specs/quint/refinement/native/deletion-notice-fence.mjs';

const rewrite = change => ({rewrite: {'runtime/deletions.ts': change}});
test('the deletion notice policy follows every DeletionNoticeFence model step', {timeout: scaledTimeout(180000)}, async () => {
  const receipt = await replayDeletionNoticeFence({traces: 300, maxSteps: 24});
  assert.equal(receipt.traces, 305);
  assert.ok(receipt.steps > 3000, JSON.stringify(receipt));
  for (const action of ['ownerChanges', 'startCall', 'pendingAnswers', 'pendingFails', 'undoAnswers', 'dismissAnswers', 'explicitFails'])
    assert.ok(receipt.actions[action] > 0, action);
});
test('a policy that keeps the previous owner\'s rows is rejected by the replay', {timeout: scaledTimeout(180000)}, async () => {
  await assert.rejects(replayDeletionNoticeFence({traces: 300, maxSteps: 24, ...rewrite(text => text.replace('generation++; known.clear();', 'generation++;'))}), /trace \d+ step \d+ /);
});
test('a policy that lets a stale read set the known rows is rejected by the replay', {timeout: scaledTimeout(180000)}, async () => {
  await assert.rejects(replayDeletionNoticeFence({traces: 300, maxSteps: 24, ...rewrite(text =>
    text.replace('if (current() === admitted) known = new Set(', 'if (true) known = new Set('))}), /trace \d+ step \d+ /);
});
test('a policy that retires a row on an unconfirmed Undo is rejected by the replay', {timeout: scaledTimeout(180000)}, async () => {
  await assert.rejects(replayDeletionNoticeFence({traces: 300, maxSteps: 24, ...rewrite(text =>
    text.replace('current() === admitted && undoConfirmed(result)', 'current() === admitted'))}), /trace \d+ step \d+ /);
});
test('a policy that counts settled receipts as pending is rejected by the replay', {timeout: scaledTimeout(180000)}, async () => {
  await assert.rejects(replayDeletionNoticeFence({traces: 300, maxSteps: 24, ...rewrite(text =>
    text.replace('pendingDeletionNotices(result.deletions).map(key)', 'result.deletions.map(key)'))}), /trace \d+ step \d+ /);
});
