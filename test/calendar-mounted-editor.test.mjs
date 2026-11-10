import assert from 'node:assert/strict';
import test from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';

test('New event resumes the saved form without extra draft controls and retains the last valid edit', {timeout: 120_000}, async () => {
  const browser = await startMountedCalendar();
  try {
    const f = await browser.page();
    try {
      const title = f.page.getByRole('textbox', {name: 'Title', exact: true});
      await f.button('Calendar').click();
      await f.button('New event').click();
      await title.fill('Last valid draft');
      await f.page.waitForFunction(() => window.quintCalendar.snapshot().retainedForm?.title === 'Last valid draft');
      const first = await f.snapshot();
      await f.button('Back to calendar').click();
      await title.waitFor({state: 'detached'});
      assert.equal(await f.button('Resume event draft').count(), 0);
      assert.equal(await f.button('Discard event draft').count(), 0);
      await f.button('New event').click();
      assert.equal(await title.inputValue(), 'Last valid draft');
      assert.equal((await f.snapshot()).form.id, first.form.id);
      await title.fill('x'.repeat(2049));
      await f.page.getByRole('status', {name: 'Calendar form draft status'}).filter({hasText: 'Check this draft.'}).waitFor();
      await f.button('Back to calendar').click();
      await f.button('New event').click();
      assert.equal(await title.inputValue(), 'Last valid draft');
      assert.equal((await f.snapshot()).form.id, first.form.id);
    } finally {await f.close();}
  } finally {await browser.close();}
});
