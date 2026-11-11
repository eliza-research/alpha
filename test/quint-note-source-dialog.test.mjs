import test from 'node:test';
import assert from 'node:assert/strict';
import {replayNoteSourceDialog} from '../specs/quint/refinement/application/note-source-dialog.mjs';

test('the mounted note source review follows every NoteSourceDialog model step', {timeout: 240000}, async () => {
  const receipt = await replayNoteSourceDialog({traces: 300, maxSteps: 30});
  assert.equal(receipt.traces, 307);
  assert.ok(receipt.steps > 3000, JSON.stringify(receipt));
  for (const action of ['choose', 'pickSettles', 'readSettles', 'retainSettles', 'saveSettles', 'viewSettles', 'releaseSettles', 'remove', 'openLinked', 'maintain'])
    assert.ok(receipt.actions[action] > 0, action);
});
test('a source review that keeps its picker selection is rejected by the replay', {timeout: 240000}, async () => {
  await assert.rejects(replayNoteSourceDialog({traces: 300, maxSteps: 30, rewrite: {'prototype/note-source-adapter.ts': text =>
    text.replace('finally{if(selectionId)await DailyApps.forgetSelected({selectionId})', 'finally{if(false)await DailyApps.forgetSelected({selectionId})')}}), /trace \d+ step \d+ /);
});
test('a source review that links into a changed note is rejected by the replay', {timeout: 240000}, async () => {
  await assert.rejects(replayNoteSourceDialog({traces: 300, maxSteps: 30, rewrite: {'prototype/note-source-adapter.ts': text =>
    text.replace("&&JSON.stringify(api.get('notes').list.find((n:Bag)=>n.id===note.id))===expected;", ';')}}), /trace \d+ step \d+ /);
});
