// The composer draft and suggested-reply rules of an open SMS thread (MessageThreads.qnt), as pure
// state transitions. Nothing here sends: sending is the owner's tap and the native review.
import {test} from 'node:test';
import assert from 'node:assert/strict';
const D = await import('../apps/app/src/runtime/message-draft.ts');

const suggested = (latest = 'sms:1', text = 'Yes, see you at 7') =>
  D.suggestionReplied(D.suggestionRequested(D.emptyDraft(), latest, true), latest, latest, true, text);

test('a suggestion lands only in an empty composer for the newest inbound message', () => {
  const state = suggested();
  assert.deepEqual({draft: state.draft, text: state.text, base: state.base, suggest: state.suggest}, {draft: 'agent', text: 'Yes, see you at 7', base: 'sms:1', suggest: 'idle'});
  assert.equal(D.canSuggest(D.emptyDraft(), null, true), false, 'nothing to answer');
  assert.equal(D.canSuggest(D.emptyDraft(), 'sms:1', false), false, 'not ready');
  assert.equal(D.canSuggest(D.typed(D.emptyDraft(), 'hi'), 'sms:1', true), false, 'the owner is typing');
});
test('a newer inbound message retires an untouched suggestion', () => {
  const next = D.threadChanged(suggested(), 'sms:2');
  assert.deepEqual({draft: next.draft, text: next.text}, {draft: 'none', text: ''});
  assert.equal(D.canSuggest(next, 'sms:2', true), true);
});
test('a reply that arrives after a newer message is dropped', () => {
  const running = D.threadChanged(D.suggestionRequested(D.emptyDraft(), 'sms:1', true), 'sms:2');
  assert.equal(running.suggest, 'idle');
  assert.equal(D.suggestionReplied(running, 'sms:1', 'sms:2', true, 'late').draft, 'none');
  const stale = D.suggestionReplied(D.suggestionRequested(D.emptyDraft(), 'sms:1', true), 'sms:1', 'sms:2', true, 'late');
  assert.deepEqual({draft: stale.draft, suggest: stale.suggest}, {draft: 'none', suggest: 'idle'});
});
test('typing takes ownership and a running suggestion can no longer land', () => {
  const typing = D.typed(D.suggestionRequested(D.emptyDraft(), 'sms:1', true), 'On my way');
  assert.equal(D.suggestionReplied(typing, 'sms:1', 'sms:1', true, 'Yes').text, 'On my way');
  // An owner draft survives new inbound messages.
  assert.deepEqual(D.threadChanged(typing, 'sms:2'), typing);
  // Editing a suggestion makes it the owner's, and it is not suggested again for that message.
  const edited = D.typed(suggested(), 'Yes, see you at 7:30');
  assert.deepEqual({draft: edited.draft, base: edited.base, declined: edited.declined}, {draft: 'owner', base: null, declined: 'sms:1'});
  assert.equal(D.canSuggest(D.typed(edited, ''), 'sms:1', true), false);
});
test('a dismissed suggestion is not offered again for the same message', () => {
  const dismissed = D.suggestionDismissed(suggested());
  assert.deepEqual({draft: dismissed.draft, text: dismissed.text, declined: dismissed.declined}, {draft: 'none', text: '', declined: 'sms:1'});
  assert.equal(D.canSuggest(dismissed, 'sms:1', true), false);
  assert.equal(D.canSuggest(D.threadChanged(dismissed, 'sms:2'), 'sms:2', true), true);
});
test('a failed suggestion is not retried until the thread changes', () => {
  const failed = D.suggestionReplied(D.suggestionRequested(D.emptyDraft(), 'sms:1', true), 'sms:1', 'sms:1', true, null);
  assert.equal(failed.suggest, 'failed');
  assert.equal(D.canSuggest(failed, 'sms:1', true), false);
  assert.equal(D.canSuggest(D.threadChanged(failed, 'sms:2'), 'sms:2', true), true);
});
test('a failed or unknown send keeps the draft; an accepted send clears it', () => {
  const draft = D.typed(D.emptyDraft(), 'On my way');
  assert.deepEqual(D.reviewFinished(draft, 'failed'), draft);
  assert.deepEqual(D.reviewFinished(draft, 'sent'), D.emptyDraft());
  assert.equal(D.reviewFinished(D.typed(D.suggestionDismissed(D.suggestionReplied(D.suggestionRequested(D.emptyDraft(), 'sms:1', true), 'sms:1', 'sms:1', true, 'Yes')), 'No'), 'sent').declined, 'sms:1', 'a dismissal is remembered past a send');
  assert.deepEqual(D.reviewFinished(draft, 'unknown'), draft);
});
test('losing readiness stops a running suggestion and keeps the text', () => {
  const lost = D.readinessLost(D.suggestionRequested(D.emptyDraft(), 'sms:1', true));
  assert.deepEqual({suggest: lost.suggest, ticket: lost.ticket}, {suggest: 'idle', ticket: null});
  const draft = D.typed(D.emptyDraft(), 'On my way');
  assert.deepEqual(D.readinessLost(draft), draft);
  assert.equal(D.suggestionReplied(D.suggestionRequested(D.emptyDraft(), 'sms:1', true), 'sms:1', 'sms:1', false, 'Yes').draft, 'none');
});

test('a draft the owner asked Alpha for replaces the slot, keeps one Undo, and is never retired by a newer message', async () => {
  const empty = D.emptyDraft();
  const asked = D.askedDraftPlaced(empty, 'Ten minutes away', true);
  assert.deepEqual(asked, {draft: 'asked', text: 'Ten minutes away', base: null, suggest: 'idle', ticket: null, declined: null, undo: null});
  assert.equal(D.askedDraftPlaced(empty, 'x', false), empty, 'nothing lands while the phone is not ready');
  assert.equal(D.askedDraftPlaced(empty, '', true), empty, 'an empty draft is not a draft');
  assert.equal(D.threadChanged(asked, 'm2'), asked, 'a newer message keeps what the owner asked for');
  assert.equal(D.canSuggest(asked, 'm2', true), false, 'no suggestion is requested over it');
  assert.deepEqual(D.suggestionDismissed(asked), empty);
  assert.equal(D.typed(asked, 'Edited').draft, 'owner');
  // AC-14: the owner's own text is replaced, and comes back with one Undo as the owner's.
  const owner = D.typed(empty, 'My own words');
  const replaced = D.askedDraftPlaced(owner, 'Alpha words', true);
  assert.deepEqual({draft: replaced.draft, text: replaced.text, undo: replaced.undo}, {draft: 'asked', text: 'Alpha words', undo: {draft: 'owner', text: 'My own words'}});
  const undone = D.draftUndone(replaced);
  assert.deepEqual({draft: undone.draft, text: undone.text, undo: undone.undo}, {draft: 'owner', text: 'My own words', undo: null});
  assert.equal(D.draftUndone(undone), undone, 'only one Undo');
  // A second Alpha draft keeps only the text it replaced.
  const second = D.askedDraftPlaced(replaced, 'Shorter', true);
  assert.deepEqual(second.undo, {draft: 'asked', text: 'Alpha words'});
  // Typing, an accepted send and a dismissal end the Undo.
  assert.equal(D.typed(second, 'Mine again').undo, null);
  assert.equal(D.reviewFinished(second, 'sent').undo, null);
  assert.equal(D.suggestionDismissed(second).undo, null);
  // Replacing an automatic suggestion remembers the message it answered; Undo offers it again for that message.
  const suggestedReply = D.suggestionReplied(D.suggestionRequested(empty, 'm1', true), 'm1', 'm1', true, 'Sure');
  const overSuggestion = D.askedDraftPlaced(suggestedReply, 'Ten minutes away', true);
  assert.deepEqual({draft: overSuggestion.draft, declined: overSuggestion.declined}, {draft: 'asked', declined: 'm1'});
  assert.equal(D.canSuggest(D.suggestionDismissed(overSuggestion), 'm1', true), false);
  const back = D.draftUndone(overSuggestion);
  assert.deepEqual({draft: back.draft, text: back.text, base: back.base}, {draft: 'agent', text: 'Sure', base: 'm1'});
  assert.deepEqual(D.reviewFinished(asked, 'sent'), empty);
  assert.equal(D.reviewFinished(asked, 'unknown'), asked);
});
test('Edit and an accepted suggestion make the text the owner\'s', () => {
  const adopted = D.draftAdopted(D.askedDraftPlaced(D.typed(D.emptyDraft(), 'Mine'), 'Alpha words', true));
  assert.deepEqual({draft: adopted.draft, text: adopted.text, undo: adopted.undo}, {draft: 'owner', text: 'Alpha words', undo: null});
  // A suggestion is accepted by typing its text: it is not offered again for that message.
  const accepted = D.typed(suggested(), suggested().text);
  assert.deepEqual({draft: accepted.draft, text: accepted.text, declined: accepted.declined}, {draft: 'owner', text: 'Yes, see you at 7', declined: 'sms:1'});
});
test('the saved SMS slot reads only its exact shape', async () => {
  const S = await import('../apps/app/src/runtime/sms-draft-store.ts');
  const slot = D.askedDraftPlaced(D.typed(D.emptyDraft(), 'Mine'), 'Alpha words', true);
  const saved = S.smsDraftText(slot);
  assert.deepEqual(JSON.parse(saved), {v: 1, draft: 'asked', text: 'Alpha words', undo: {draft: 'owner', text: 'Mine'}});
  assert.deepEqual(S.readSmsDraftText(saved), {...D.emptyDraft(), draft: 'asked', text: 'Alpha words', undo: {draft: 'owner', text: 'Mine'}});
  // An untouched suggestion is for the visit only.
  assert.deepEqual(S.readSmsDraftText(S.smsDraftText(suggested())), D.emptyDraft());
  for (const raw of ['', 'not json', 'null', '[]', '{"v":2,"draft":"owner","text":"x","undo":null}', '{"v":1,"draft":"owner","text":"x"}',
    '{"v":1,"draft":"owner","text":"x","undo":null,"extra":1}', '{"v":1,"draft":"agent","text":"x","undo":null}', '{"v":1,"draft":"none","text":"x","undo":null}',
    '{"v":1,"draft":"owner","text":"","undo":null}', '{"v":1,"draft":"owner","text":"x","undo":{"draft":"none","text":"y"}}',
    '{"v":1,"draft":"owner","text":"x","undo":{"draft":"owner","text":"y","by":"z"}}', JSON.stringify({v: 1, draft: 'owner', text: 'x'.repeat(1601), undo: null})])
    assert.deepEqual(S.readSmsDraftText(raw), D.emptyDraft(), raw.slice(0, 60));
});
test('saved SMS slots are read before they are written and written in order', async () => {
  const S = await import('../apps/app/src/runtime/sms-draft-store.ts');
  const rows = new Map(), log = [];
  const open = async threadId => ({
    read: async () => { log.push(['read', threadId]); return rows.get(threadId) ?? null; },
    save: async (expected, text) => { log.push(['save', threadId, text]); if ((rows.get(threadId) ?? null) !== expected) throw Error('conflict'); const row = {version: 1, binding: threadId, revision: String(log.length), text}; rows.set(threadId, row); return row; },
  });
  const slots = S.smsDraftSlots(open);
  assert.deepEqual(await slots.load('t1'), D.emptyDraft());
  await slots.save('t1', D.emptyDraft());
  assert.equal(log.filter(row => row[0] === 'save').length, 0, 'an empty slot is not written');
  const owner = D.typed(D.emptyDraft(), 'On my way');
  await Promise.all([slots.save('t1', owner), slots.save('t1', owner)]);
  assert.equal(log.filter(row => row[0] === 'save').length, 1, 'an unchanged slot is not written again');
  // Another writer's row is read again before writing.
  rows.set('t1', {version: 1, binding: 't1', revision: 'other', text: S.smsDraftText(D.typed(D.emptyDraft(), 'Elsewhere'))});
  await slots.save('t1', D.typed(D.emptyDraft(), 'Final'));
  assert.equal((await S.smsDraftSlots(open).load('t1')).text, 'Final');
});
