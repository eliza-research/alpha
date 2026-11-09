import assert from 'node:assert/strict';
import test from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';

test('mounted Calendar Edit keeps the retained draft until explicit Resume or Discard', {timeout: 240_000}, async t => {
  const browser = await startMountedCalendar();
  try {
    for (const [kind, nextTitle] of [['same', 'Fixture Existing Event A'], ['different', 'Fixture Existing Event B']]) {
      await t.test(kind + ' event', async () => {
        const f = await browser.page({eventTitles: ['Fixture Existing Event A', 'Fixture Existing Event B']});
        const back = () => f.page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
        const open = title => f.page.getByRole('button', {name: new RegExp('^' + title + ',')}).click();
        const title = f.page.getByRole('textbox', {name: 'Title', exact: true});
        const detail = f.page.locator('[data-alpha-subview="calendar-detail"]:not([inert])');
        const edit = async () => { await detail.locator('summary[aria-label="Event actions"]').click(); await f.button('Edit event').click(); };
        try {
          await f.button('Calendar').click();
          await open('Fixture Existing Event A');
          await edit();
          await title.fill('Retained edit A');
          await f.page.waitForFunction(() => window.quintCalendar.snapshot().retainedForm?.title === 'Retained edit A');
          const old = await f.snapshot();
          await f.page.waitForFunction(async retained => await window.quintCalendar.saved('owner-a') === retained,
            old.retained, {polling: 100});
          const durable = await f.invoke('saved', 'owner-a');
          assert.equal(durable, old.retained);
          await back();
          await detail.waitFor();
          await back();
          await f.button('Resume event draft').waitFor();

          await open(nextTitle);
          await edit();
          const blocked = await f.snapshot();
          assert.equal(!!blocked.form, false, 'Edit must keep the existing durable draft until explicit action');
          assert.equal(blocked.notices.at(-1), 'Finish or discard your draft first.');
          assert.equal(blocked.retained, durable);
          assert.equal(await f.invoke('saved', 'owner-a'), durable);
          assert.ok(await detail.isVisible(), 'The current event remains open');
          assert.ok((await detail.innerText()).includes(nextTitle));

          await back();
          await f.button('Resume event draft').click();
          assert.equal(await title.inputValue(), 'Retained edit A');
          assert.equal((await f.snapshot()).form.id, old.form.id);
          await f.button('Back to calendar').click();
          f.page.once('dialog', dialog => dialog.accept());
          await f.button('Discard event draft').click();
          await f.button('Resume event draft').waitFor({state: 'detached'});
          await open(nextTitle);
          await edit();
          assert.equal(await title.inputValue(), nextTitle);
          assert.notEqual((await f.snapshot()).form.id, old.form.id);
        } finally {await f.close();}
      });
    }
  } finally {await browser.close();}
});
