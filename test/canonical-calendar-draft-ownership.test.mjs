import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCalendarDraftFixture, calendarDraftFixture} from './fixtures/canonical-calendar-draft-owner.mjs';

const compiled = await buildCalendarDraftFixture();
const withDraft = async run => {
  const f = calendarDraftFixture(compiled);
  try {await run(f);}
  finally {await f.close();}
};

test('a retired Calendar draft stays in the original account and clears the visible editor', () => withDraft(async f => {
  await f.bind('A');
  await f.edit('A', 'First draft');
  const original = f.raw('A'), form = f.host.calendar.form;
  const controls = f.render();
  f.setOwner('');
  assert.equal(f.render().renderedForm, '', 'owner loss hides the editor even before the update hook');
  controls.recoverFormDraft();
  assert.equal(f.recoveries.length, 0, 'old recovery callback is fenced');
  f.update();
  assert.equal(f.observe().bound, '');
  assert.equal(f.observe().form, '');
  assert.equal(f.observe().resumeOffered, false);
  await f.bind('B');
  await f.commit(form);
  assert.equal(f.raw('A'), original);
  assert.equal(f.raw('B'), null, 'old owner bytes cannot enter the new empty slot');
  assert.equal(f.toasts.length, 0);
  await f.bind('A');
  assert.equal(f.observe().resumeOffered, true);
  await f.resume();
  assert.equal(f.observe().renderedForm, 'First draft');
}));

test('a delayed old read cannot fill the next Calendar editor', () => withDraft(async f => {
  f.seed('A', 'A', 'Saved A');
  f.seed('B', 'B', 'Saved B');
  f.holdRead('A');
  await f.bind('A');
  assert.deepEqual(f.observe().readPending, ['A']);
  await f.bind('B');
  assert.equal(f.observe().text.title, 'Saved B');
  await f.releaseRead('A');
  assert.equal(f.observe().text.title, 'Saved B');
  assert.equal(f.saved('A').title, 'Saved A');
}));

test('queued Calendar writes stay with their captured owner after rebinding', () => withDraft(async f => {
  await f.bind('A');
  f.holdWrite('A');
  await f.edit('A', 'Queued A');
  assert.deepEqual(f.observe().writePending, ['A']);
  await f.bind('B');
  await f.edit('B', 'Current B');
  await f.releaseWrite('A');
  assert.deepEqual(f.saved('A'), {owner: 'A', title: 'Queued A'});
  assert.deepEqual(f.saved('B'), {owner: 'B', title: 'Current B'});
  assert.equal(f.observe().renderedForm, 'Current B');
}));

test('a delayed clear restores only its retired Calendar slot and does not notify the new account', () => withDraft(async f => {
  await f.bind('A');
  await f.edit('A', 'Draft A');
  const form = f.host.calendar.form;
  await f.closeForm();
  f.holdWrite('A');
  await f.commit(form);
  assert.deepEqual(f.observe().writePending, ['A']);
  await f.bind('B');
  await f.edit('B', 'Draft B');
  await f.releaseWrite('A');
  assert.deepEqual(f.saved('A'), {owner: 'A', title: 'Draft A'});
  assert.deepEqual(f.saved('B'), {owner: 'B', title: 'Draft B'});
  assert.equal(f.toasts.length, 0);
}));

test('a saved Calendar row from another account is neither resumed nor exported', () => withDraft(async f => {
  f.seed('B', 'A', 'Misbound draft');
  const original = f.raw('B');
  await f.bind('B');
  await f.awaitReadFailure();
  assert.equal(f.observe().resumeOffered, false);
  assert.equal(f.observe().storageError, true);
  assert.equal(f.observe().recovery, false);
  await f.openRecovery();
  assert.equal(f.recoveries.length, 0);
  assert.equal(f.raw('B'), original);
}));

test('an earlier binding cannot discard a newer Calendar draft after the same account reopens', () => withDraft(async f => {
  await f.bind('A');
  await f.edit('A', 'Earlier A');
  await f.closeForm();
  const stale = f.render().discardFormDraft;
  await f.bind('B');
  await f.bind('A');
  await f.edit('A', 'New A');
  await f.closeForm();
  const current = f.raw('A');
  stale();
  await f.settle();
  assert.equal(f.raw('A'), current);
  assert.equal(f.observe().resumeOffered, true);
  await f.discard();
  assert.equal(f.saved('A').title, '');
}));


test('opening another event preserves every edit and restores the matching event without draft prompts', () => withDraft(async f => {
  await f.bind('A'); await f.edit('A', 'Unfinished new event'); await f.closeForm();
  await f.begin('A', 'Event one', 'event-one');
  assert.equal(f.observe().form, 'Event one');
  f.host.calendar.form.title = 'Edited event one'; f.update(); await f.settle(); await f.closeForm();
  await f.begin('A', 'Event two', 'event-two');
  f.host.calendar.form.title = 'Edited event two'; f.update(); await f.settle(); await f.closeForm();
  await f.begin('A', 'Event one', 'event-one');
  assert.equal(f.observe().form, 'Edited event one');
  assert.equal(f.observe().resumeOffered, false);
  await f.closeForm(); await f.begin('A', 'New event');
  assert.equal(f.observe().form, 'Unfinished new event');
  assert.deepEqual(f.allSaved().map(row => row.title).sort(), ['Edited event one','Edited event two','Unfinished new event']);
  assert.equal(f.toasts.length, 0);
}));

test('a late event draft read cannot open after changing owners', () => withDraft(async f => {
  await f.bind('A'); f.holdRead('A');
  const opening = f.begin('A', 'Event A', 'event-a'); await f.settle();
  await f.bind('B'); await f.releaseRead('A'); await opening;
  assert.equal(f.observe().owner, 'B');
  assert.equal(f.observe().form, '');
  assert.equal(f.toasts.length, 0);
}));
