import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';
import {reviewCalendarDraftDiscard} from './fixtures/calendar-draft-handoff.mjs';

const back = page => page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));

test('mounted Calendar Back and Discard clear the validation latch after the retained draft is consumed', {timeout: scaledTimeout(180_000)}, async () => {
  const browser = await startMountedCalendar();
  try {
    const f = await browser.page();
    try {
      const title = f.page.getByRole('textbox', {name: 'Title', exact: true});
      const picker = f.page.getByRole('textbox', {name: 'Name or email', exact: true});
      const status = f.page.getByRole('status', {name: 'Calendar form draft status'}).filter({hasText: 'Check this draft.'});
      const resume = f.button('Resume event draft');
      await f.button('Calendar').click();
      await f.button('New event').click();
      await title.fill('Last valid draft');
      const first = await f.snapshot();
      await f.button('Add people').click();
      await picker.fill('Transient query');
      await back(f.page);
      await picker.waitFor({state: 'detached'});
      assert.equal(await title.inputValue(), 'Last valid draft');
      await back(f.page);
      await title.waitFor({state: 'detached'});
      await resume.click();
      assert.equal(await title.inputValue(), 'Last valid draft');
      assert.equal((await f.snapshot()).form.id, first.form.id);

      await title.fill('x'.repeat(2049));
      await status.waitFor();
      await f.button('Back to calendar').click();
      await resume.click();
      assert.equal(await title.inputValue(), 'Last valid draft');
      assert.equal((await f.snapshot()).form.id, first.form.id);

      await title.fill('x'.repeat(2049));
      await status.waitFor();
      await f.button('Back to calendar').click();
      await reviewCalendarDraftDiscard(f, false);
      assert.ok(await resume.isVisible());
      assert.equal((await f.snapshot()).retained, first.retained);
      assert.equal(await f.invoke('scope'), false);

      await reviewCalendarDraftDiscard(f, true);
      await resume.waitFor({state: 'detached'});
      const afterDiscard = await f.snapshot();
      const available = await f.invoke('scope');
      await f.page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
      await f.settings();
      await f.button('Google Calendar').click();
      const state = await f.snapshot();
      assert.equal(afterDiscard.form, null);
      assert.equal(afterDiscard.retained, '');
      assert.equal(afterDiscard.invalid, false, 'The discarded editor cannot retain an invalid flag');
      assert.equal(available, true, 'No retained draft blocks the Calendar scope');
      assert.ok(!state.notices.slice(afterDiscard.notices.length).includes('Save draft first'));
      await f.page.getByRole('dialog', {name: 'Google accounts', exact: true}).waitFor();
    } finally {await f.close();}
  } finally {await browser.close();}
});
