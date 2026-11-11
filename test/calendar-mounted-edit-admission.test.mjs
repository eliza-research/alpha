import assert from 'node:assert/strict';
import test from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';

test('mounted Calendar keeps each event edit and opens a separate new-event draft', {timeout: 240_000}, async t => {
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
          await f.page.waitForFunction(async ({retained, target}) => await window.quintCalendar.saved('owner-a', target) === retained,
            {retained: old.retained, target: old.form.target}, {polling: 100});
          const durable = await f.invoke('saved', 'owner-a', old.form.target);
          assert.equal(durable, old.retained);
          await back();
          await detail.waitFor();
          await back();
          assert.equal(await f.button('Resume event draft').count(),0);

          await open(nextTitle);
          await edit();
          await title.waitFor();
          assert.equal(await title.inputValue(), kind === 'same' ? 'Retained edit A' : nextTitle);
          assert.equal(await f.invoke('saved', 'owner-a', old.form.target), durable);
          await back();
          await detail.waitFor();
          await back();
          await f.button('New event').click();
          await title.waitFor();
          assert.equal(await title.inputValue(), '', 'New event has its own draft');
          assert.equal(await f.invoke('saved', 'owner-a', old.form.target), durable);
          assert.equal((await f.snapshot()).requests.filter(row => row.method !== 'GET').length, 0);

        } finally {await f.close();}
      });
    }
  } finally {await browser.close();}
});
