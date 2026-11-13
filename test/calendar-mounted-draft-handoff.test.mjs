import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {discardCalendarDraft, fixtureNote, goHome, noteRefusal, noteTitle, openCameraReview, openNote,
  retainCalendarDraft, reviewNote, scanRefusal, scanTitle, startMountedCalendar, submitCameraReview, titleInput}
  from './fixtures/calendar-draft-handoff.mjs';

test('incoming canonical Calendar drafts preserve an earlier retained editor', {timeout: scaledTimeout(240_000)}, async t => {
  const browser = await startMountedCalendar();
  try {
    await t.test('mounted Note review stays on the exact note until explicit discard', async () => {
      const f = await browser.page({notes: [fixtureNote]});
      try {
        const old = await retainCalendarDraft(f);
        await goHome(f);await openNote(f);await reviewNote(f);
        await f.page.waitForFunction(refusal => {
          const s = window.quintCalendar.snapshot();
          return s.view === 'calendar' || s.notices.includes(refusal);
        }, noteRefusal);
        const refused = await f.snapshot();
        assert.equal(refused.view, 'notes', 'Refused canonical handoff keeps the initiating Note visible');
        assert.equal(await f.page.getByRole('textbox', {name: 'Note', exact: true}).inputValue(), fixtureNote.body);
        assert.equal(refused.retained, old);
        assert.equal(await f.invoke('saved', 'owner-a'), old);

        await reviewNote(f, 'reminder');
        await titleInput(f).waitFor();
        assert.equal(await titleInput(f).inputValue(), noteTitle);
        assert.equal((await f.snapshot()).form, null, 'Reminders use their separate draft authority');
        assert.equal(await f.invoke('saved', 'owner-a'), old);
        await f.button('Back to calendar').click();
        await discardCalendarDraft(f);
        await goHome(f);await openNote(f);await reviewNote(f);
        await titleInput(f).waitFor();
        assert.equal(await titleInput(f).inputValue(), noteTitle);
        assert.equal(await f.page.getByRole('textbox', {name: 'Notes', exact: true}).inputValue(), fixtureNote.body);
        assert.equal((await f.snapshot()).form.title, noteTitle);
      } finally {await f.close();}
    });
    await t.test('real scan event review stays open when the canonical handoff is refused', async () => {
      const f = await browser.page();
      try {
        const old = await retainCalendarDraft(f);
        await goHome(f);
        const dialog = await openCameraReview(f);
        await submitCameraReview(dialog);
        await f.page.waitForFunction(() => window.quintCalendar.snapshot().view === 'calendar' ||
          !!document.querySelector('[aria-label="Event draft status"]')?.textContent);
        const refused = await f.snapshot();
        assert.equal(refused.view, 'camera', 'Refused canonical handoff keeps the initiating Camera view');
        assert.ok(await dialog.isVisible());
        assert.equal(await dialog.getByRole('status', {name: 'Event draft status'}).textContent(), scanRefusal);
        assert.equal(await dialog.getByRole('textbox', {name: 'Event title'}).inputValue(), scanTitle);
        assert.equal(await f.invoke('saved', 'owner-a'), old);
        await dialog.getByRole('button', {name: 'Close scan', exact: true}).click();
        await goHome(f);await f.button('Calendar').click();await discardCalendarDraft(f);await goHome(f);
        const fresh = await openCameraReview(f);
        await submitCameraReview(fresh);
        await fresh.waitFor({state: 'detached'});
        await titleInput(f).waitFor();
        assert.equal(await titleInput(f).inputValue(), scanTitle);
        assert.equal((await f.snapshot()).form.title, scanTitle);
      } finally {await f.close();}
    });
  } finally {await browser.close();}
});
