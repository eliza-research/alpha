import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {mountedCalendarFixtureSources, startMountedCalendar} from '../../../../test/fixtures/calendar-mounted-editor.mjs';
import {captureInputs, checkTraces, qset} from '../check-traces.mjs';

const model = 'Calendar';
const driver = fileURLToPath(import.meta.url);
const events = ['Historical replay event A', 'Historical replay event B'];
const call = (name, ...args) => ({name, args});
const inputs = ['specs/quint/legacy/Calendar.qnt', 'apps/app/src/prototype/model.js',
  'apps/app/src/prototype/template.html', 'apps/app/src/prototype/subview-accessibility.ts',
  'apps/app/src/prototype/canonical-calendar-drafts.ts', 'apps/app/src/runtime/agent-calendar.ts'];

function eventIndex(value) {
  const key = JSON.parse(value.replace(/^canonical-calendar:/, ''));
  assert.equal(key[0], 'eliza');
  if (key.at(-1) === 'fixture-event-0') return 1;
  if (key.at(-1) === 'fixture-event-1') return 2;
  throw Error('Unexpected fixture event ' + value);
}

export async function checkHistoricalCalendarNavigation(extraSources = []) {
  const sources = new Set([driver, ...mountedCalendarFixtureSources, ...inputs, ...extraSources]);
  const driverHashes = captureInputs([...sources]);
  const browser = await startMountedCalendar({onSource(path) {
    if (sources.has(path)) return;
    sources.add(path);
    driverHashes[path] ??= createHash('sha256').update(readFileSync(path)).digest('hex');
  }});
  const traces = [];
  try {
    async function schedule(name, run) {
      const f = await browser.page({eventTitles: events});
      const detail = f.page.locator('[data-alpha-subview="calendar-detail"]:not([inert])');
      const editor = f.page.locator('[data-alpha-subview="calendar-form"]:not([inert])');
      const title = f.page.getByRole('textbox', {name: 'Title', exact: true});
      const backToCalendar = f.button('Back to calendar');
      const resume = f.button('Resume event draft');
      await f.button('Calendar').click();
      await f.button('New event').waitFor();
      const month = f.page.locator('button[aria-label="Month view"]');
      async function observe() {
        const s = await f.snapshot();
        assert.equal(s.view, 'calendar');
        const monthOpen = await month.getAttribute('aria-expanded') === 'true';
        assert.equal(monthOpen, s.month != null);
        const top = monthOpen ? 'Month' : 'Day';
        const formVisible = await editor.isVisible(), detailVisible = await detail.isVisible();
        assert.equal(formVisible, !!s.form);
        assert.ok(!(formVisible && detailVisible));
        const view = formVisible ? 'Editor' : detailVisible ? 'Event' : top;
        const focus = formVisible ? s.form.target ? eventIndex(s.form.target) : 3 : detailVisible ? eventIndex(s.detail) : 0;
        const displayed = s.feed.map(title => {
          assert.ok(events.includes(title), 'The selected historical projection contains only fixture rows');
          return events.indexOf(title) + 1;
        });
        return {'s.view': view, 's.top': top, 's.focus': focus, Displayed: qset(displayed),
          BackEnabled: await backToCalendar.isVisible(), EditEnabled: await f.button('Edit event').isVisible()};
      }
      const t = {name, init: call('StartState', 'proposed', 'write', 'up', false), expect: await observe(), steps: []};
      const mark = async (label, action) => t.steps.push({label, action, expect: await observe()});
      const back = async () => {
        await f.page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
        await mark('Dispatch Alpha Back', call('Back'));
      };
      const open = async (id) => {
        await f.page.getByRole('button', {name: new RegExp('^' + events[id - 1] + ',')}).click();
        await detail.waitFor();
        await mark('Open the actual Calendar event detail', call('OpenEvent', id));
      };
      try {
        await run({f, month, editor, detail, title, resume, backToCalendar, mark, open, back});
        traces.push(t);
      } finally {await f.close();}
    }
    await schedule('current day and month navigation matches historical switch', async c => {
      await c.month.click();
      await c.mark('Switch the mounted renderer to Month', call('Switch', 'Month'));
      await c.f.page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
      await c.mark('Alpha Back leaves the mounted Month view', call('Switch', 'Day'));
    });
    await schedule('mounted creation draft exits to the prior Calendar list', async c => {
      await c.f.button('New event').click();await c.editor.waitFor();
      await c.mark('Open a new canonical Calendar editor', call('NewEvent'));
      await c.title.fill('Historical comparison dirty creation');
      await c.mark('Current retained draft bytes are outside the historical state', null);
      await c.back();
      await c.resume.waitFor();
    });
    await schedule('mounted edit Back returns the exact existing event', async c => {
      await c.open(1);
      await c.f.button('Edit event').click();await c.editor.waitFor();
      await c.mark('Enter the existing writable event editor', call('Edit'));
      await c.title.fill('Historical comparison dirty edit');
      await c.mark('Current retained edit bytes are outside the historical state', null);
      await c.backToCalendar.click();await c.detail.waitFor();
      await c.mark('Header Back restores the same event detail', call('Back'));
      await c.back();
      await c.resume.waitFor();
    });
    await schedule('current Calendar can open and close the second loaded event', async c => {
      await c.open(2);await c.back();
    });
  } finally {await browser.close();}
  const receipt = await checkTraces({id: 'historical-calendar-navigation', model, scope: 'bounded-orchestration',
    sources: [...sources], driverHashes, traces,
    assumptions: ['The original proposed Calendar model is unchanged. A mounted Chromium renderer executes selected navigation over two read-only fixture responses from a writable canonical source.',
      'Writable Eliza event fixtures supply the historical write-capability input for this navigation projection. The source does not exercise historical Google grants, provider state or a local event outbox.',
      'The loaded feed rows are the selected projection of Displayed. The current durable form text, independent picker, and explicit Resume/Discard are outside this historical state.',
      'The original Week, Schedule, Search, RSVP, offline enqueue, conflict resolution, and delete undo assumptions are not covered by this replay.']});
  return {receipts: [receipt], obligations: [
    {model, obligation: 'Compare historical Calendar write, sync and recovery transitions',
      reason: 'The current canonical renderer calls CalendarService under scoped ownership. Its mounted navigation does not execute the historical optimistic local-event outbox, RSVP, malformed-feed isolation or delete-undo sequence.'},
    {model, obligation: 'Map historical Calendar surfaces and connection admission',
      reason: 'This comparison covers Day, Month, Event and Editor. Historical Week, Schedule, Search and the opt-in Google Calendar variant are outside the current mounted fixture.'},
  ]};
}
