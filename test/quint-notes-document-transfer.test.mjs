import test from 'node:test';
import assert from 'node:assert/strict';
import {replayNotesDocumentTransfer} from '../specs/quint/refinement/application/notes-document-transfer.mjs';

test('Notes import and export follow every NotesDocumentTransfer model step', {timeout: 180000}, async () => {
  const receipt = await replayNotesDocumentTransfer({traces: 300, maxSteps: 16});
  assert.equal(receipt.traces, 300);
  assert.ok(receipt.steps > 2000, JSON.stringify(receipt));
  for (const action of ['choose', 'settles', 'leaveNotes', 'enterNotes', 'hide', 'show']) assert.ok(receipt.actions[action] > 0, action);
});
test('a receipt shown in a later Notes visit is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayNotesDocumentTransfer({traces: 300, maxSteps: 16, rewrite: {'prototype/notes-document-adapter.ts': text =>
    text.replace('if(token===epoch&&api.isActive())api.toast(message);', 'if(api.isActive())api.toast(message);')}}), /trace \d+ step \d+ show/);
});
test('a second document operation started while one runs is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayNotesDocumentTransfer({traces: 300, maxSteps: 16, rewrite: {'prototype/notes-document-adapter.ts': text =>
    text.replace("if(busy){api.toast('Busy');return;}", '')}}), /trace \d+ step \d+ /);
});
