import assert from 'node:assert/strict';
import test from 'node:test';
import {checkCalendarEditorDraft, checkCalendarEditorWithSharedController} from '../specs/quint/refinement/application/calendar-editor-draft.mjs';

test('the modal calendar editor and its retained edits follow every CalendarEditorDraft model step', {timeout: 280000}, async () => {
  const result = await checkCalendarEditorDraft();
  assert.equal(result.traces, 41);
  for (const action of ['openDone', 'edit', 'reportConflict', 'reportError', 'restore', 'replace', 'discard', 'discardDone', 'retry',
    'retryDone', 'save', 'commitDone', 'clearDone', 'close', 'stutter']) assert.ok(result.actions[action] > 0, action);
  for (const source of ['apps/app/src/browser/calendar-editor.ts', 'apps/app/src/browser/calendar-editor-draft.ts'])
    assert.ok(result.sources.includes(source), source);
});

test('saving retained edits typed against an older revision of the event is rejected by the replay', {timeout: 280000}, async () => {
  const guard = 'if (revision !== identity.revision) throw Error("These edits belong to an older event revision. Discard them and reopen the current event.");';
  await assert.rejects(checkCalendarEditorDraft(code => {
    assert.ok(code.includes(guard));
    return code.replace(guard, '');
  }), /save/);
});

test('with the shared draft controller, retained edits are offered, saved and cleared, and older-revision edits refused', async () => {
  const result = await checkCalendarEditorWithSharedController();
  assert.ok(result.sources.includes('apps/app/src/browser/calendar-editor-draft.ts'));
});
