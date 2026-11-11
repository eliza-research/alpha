import test from 'node:test';
import assert from 'node:assert/strict';
import {replayNoteWebSourceDialog} from '../specs/quint/refinement/application/note-web-source-dialog.mjs';

test('the mounted web source review follows every NoteWebSourceDialog model step', {timeout: 240000}, async () => {
  const receipt = await replayNoteWebSourceDialog({traces: 300, maxSteps: 20});
  assert.equal(receipt.traces, 306);
  assert.ok(receipt.steps > 2500, JSON.stringify(receipt));
  for (const action of ['openDialog', 'closeDialog', 'hide', 'act', 'visitSettles', 'removeSettles']) assert.ok(receipt.actions[action] > 0, action);
});
test('a web source review that acts on a changed note is rejected by the replay', {timeout: 240000}, async () => {
  await assert.rejects(replayNoteWebSourceDialog({traces: 300, maxSteps: 20, rewrite: {'prototype/note-web-source-adapter.ts': text =>
    text.replace('if(busy||!current())return;busy=true;', 'if(busy||closed)return;busy=true;')}}), /trace \d+ step \d+ /);
});
test('a web source review that stays open on a hidden page is rejected by the replay', {timeout: 240000}, async () => {
  await assert.rejects(replayNoteWebSourceDialog({traces: 300, maxSteps: 20, rewrite: {'prototype/note-web-source-adapter.ts': text =>
    text.replace('visibility=()=>{if(document.hidden)close();}', 'visibility=()=>{}')}}), /trace \d+ step \d+ hide/);
});
