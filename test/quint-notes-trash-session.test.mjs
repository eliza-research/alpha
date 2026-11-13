import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {replayNotesTrashSession} from '../specs/quint/refinement/application/notes-trash-session.mjs';

const adapter = 'prototype/notes-trash-adapter.ts';
test('the installed Notes Trash adapter follows every NotesTrashSession model step', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await replayNotesTrashSession({traces: 300, maxSteps: 24});
  assert.equal(receipt.traces, 306);
  assert.ok(receipt.steps > 5000, JSON.stringify(receipt));
  for (const action of ['backgroundPass', 'maintenanceDone', 'trashRefusesNote', 'confirmGo', 'restore', 'operationDone']) assert.ok(receipt.actions[action] > 0, action);
});
test('a background pass that always re-reads Trash is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayNotesTrashSession({traces: 120, maxSteps: 24, rewrite: {[adapter]: text =>
    text.replace('if(!background||result.removed.length)await load(shell);', 'await load(shell);')}}), /trace \d+ step \d+ maintenanceDone/);
});
test('a foreground caller that joins a pass without re-reading Trash is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayNotesTrashSession({traces: 120, maxSteps: 24, rewrite: {[adapter]: text =>
    text.replace('return background?maintaining:maintaining.then(()=>load(shell));', 'return maintaining;')}}), /trace \d+ step \d+ maintenanceDone/);
});
test('a full-Trash choice that outlives its closed note is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayNotesTrashSession({traces: 120, maxSteps: 24, rewrite: {[adapter]: text =>
    text.replace('if(state.trashFull&&!full)queueMicrotask(()=>{trash.forget();api.set({trashFull:null});});', '')}}), /trace \d+ step \d+ (noteLeaves|openTrash)/);
});
