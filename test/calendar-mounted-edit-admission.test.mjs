import assert from 'node:assert/strict';
import test from 'node:test';
import {startMountedCalendar} from './fixtures/calendar-mounted-editor.mjs';

test('mounted Calendar Edit restores each event separately and New event opens its own form', {timeout: 240_000}, async t => {
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
          await f.page.waitForFunction(async retained => await window.quintCalendar.savedForCurrent() === retained,
            old.retained, {polling: 100});
          const durable = await f.invoke('savedForCurrent');
          assert.equal(durable, old.retained);
          await back();
          await detail.waitFor();
          await back();
          assert.equal(await f.button('Resume event draft').count(),0);

          await open(nextTitle);
          await edit();
          await title.waitFor();
          assert.equal(await title.inputValue(),kind==='same'?'Retained edit A':nextTitle);
          assert.equal(await f.button('Resume event draft').count(),0);
          const opened=await f.snapshot();
          assert.ok(opened.form);
          if(kind==='different')assert.notEqual(opened.form.target,old.form.target);
          await back();
          await back();
          await open('Fixture Existing Event A');
          await edit();
          await title.waitFor();
          assert.equal(await title.inputValue(),'Retained edit A');
          assert.equal(await f.invoke('savedForCurrent'),durable);
          await back();
          await back();
          await f.button('New event').click();
          await title.waitFor();
          assert.notEqual(await title.inputValue(),'Retained edit A');
          assert.notEqual((await f.snapshot()).form.id,old.form.id);
          assert.equal(opened.requests.filter(row => row.method !== 'GET').length,0);
        } finally {await f.close();}
      });
    }
  } finally {await browser.close();}
});
