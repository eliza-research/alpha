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

test('a draft the owner asked Alpha for lands only where the owner has not typed, and is never retired by a newer message', async () => {
  const D = await import('../apps/app/src/runtime/message-draft.ts');
  const empty = D.emptyDraft();
  const asked = D.askedDraftPlaced(empty, 'Ten minutes away', true);
  assert.deepEqual(asked, {draft: 'asked', text: 'Ten minutes away', base: null, suggest: 'idle', ticket: null, declined: null});
  assert.equal(D.askedDraftPlaced(empty, 'x', false), empty, 'nothing lands while the phone is not ready');
  assert.equal(D.askedDraftPlaced(empty, '', true), empty, 'an empty draft is not a draft');
  const owner = D.typed(empty, 'My own words');
  assert.equal(D.askedDraftPlaced(owner, 'x', true), owner, 'the owner text is never replaced');
  assert.equal(D.threadChanged(asked, 'm2'), asked, 'a newer message keeps what the owner asked for');
  assert.equal(D.canSuggest(asked, 'm2', true), false, 'no suggestion is requested over it');
  assert.deepEqual(D.suggestionDismissed(asked), empty);
  assert.equal(D.typed(asked, 'Edited').draft, 'owner');
  // Replacing an automatic suggestion remembers the message it answered, so it is not suggested again.
  const suggested = D.suggestionReplied(D.suggestionRequested(empty, 'm1', true), 'm1', 'm1', true, 'Sure');
  const replaced = D.askedDraftPlaced(suggested, 'Ten minutes away', true);
  assert.equal(replaced.draft, 'asked');
  assert.equal(replaced.declined, 'm1');
  assert.equal(D.canSuggest(D.suggestionDismissed(replaced), 'm1', true), false);
  assert.deepEqual(D.reviewFinished(asked, 'sent'), empty);
  assert.equal(D.reviewFinished(asked, 'unknown'), asked);
});
