import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mountedCalendarFixtureSources, reviewCalendarAction, startMountedCalendar} from '../../../../test/fixtures/calendar-mounted-editor.mjs';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'CanonicalCalendarEditorClose';
const firstEvent = 'Fixture Existing Event A', secondEvent = 'Fixture Existing Event B';
const firstTitle = 'First retained edit', secondTitle = 'Second retained edit';
const oversized = 'x'.repeat(2049);
const titles = new Map([['', ''], [firstEvent, 'event-a'], [secondEvent, 'event-b'],
  [firstTitle, 'first'], [secondTitle, 'second'], [oversized, 'oversized']]);
const notices = new Map([['Finish or discard your draft first.', 'finish-draft'],
  ['Opening your draft. Try again in a moment.', 'draft-busy'], ['This draft changed. Try again.', 'draft-changed']]);
const inputs = ['apps/app/src/prototype/canonical-calendar-drafts.ts', 'apps/app/src/prototype/template.html',
  'apps/app/src/prototype/model.js', 'apps/app/src/prototype/subview-accessibility.ts', 'apps/app/src/runtime/canonical-calendar-draft.ts',
  'apps/app/src/runtime/assistant-draft-store.ts', 'apps/app/src/prototype/assistant-draft-controller.ts',
  '.eliza/client-features/packages/ui/src/state/durable-draft-controller.ts'];
const empty = {id: 0, owner: 0, target: 0, title: ''};

function eventIndex(key) {
  if (!key) return 0;
  const parts = JSON.parse(key.replace(/^canonical-calendar:/, ''));
  assert.equal(parts[0], 'eliza');
  if (parts.at(-1) === 'fixture-event-0') return 1;
  if (parts.at(-1) === 'fixture-event-1') return 2;
  throw Error('Unexpected fixture event key ' + key);
}
function ownerIndex(name) {
  assert.ok(['owner-a', 'owner-b'].includes(name));
  return name === 'owner-a' ? 1 : 2;
}

export async function checkCanonicalCalendarEditorClose(extraSources = []) {
  const sources = new Set([driver, ...mountedCalendarFixtureSources, ...inputs, ...extraSources]);
  captureSources([...sources]);
  const browser = await startMountedCalendar({onSource(path) {
    if (sources.has(path)) return;
    sources.add(path);
    captureSources([path]);
  }});
  const traces = [];
  try {
    async function schedule(name, run) {
      const f = await browser.page({eventTitles: [firstEvent, secondEvent]});
      await f.invoke('bindDraftScope');
      const ids = new Map();
      const title = f.page.getByRole('textbox', {name: 'Title', exact: true});
      const picker = f.page.getByRole('textbox', {name: 'Name or email', exact: true});
      const form = f.page.locator('[data-alpha-subview="calendar-form"]:not([inert])');
      const detail = f.page.locator('[data-alpha-subview="calendar-detail"]:not([inert])');
      const resume = f.button('Resume event draft'), discard = f.button('Discard event draft');
      const mapForm = value => {
        if (!value) return empty;
        if (!ids.has(value.id)) ids.set(value.id, ids.size + 1);
        assert.ok(titles.has(value.title), 'Unexpected exact editor title');
        return {id: ids.get(value.id), owner: ownerIndex(JSON.parse(value.owner)[1]),
          target: eventIndex(value.target), title: titles.get(value.title)};
      };
      async function observe() {
        const s = await f.snapshot();
        const actualForm = mapForm(s.form), retained = mapForm(s.retainedForm), discarding = mapForm(s.discarding);
        const notice = s.notices.length ? notices.get(s.notices.at(-1)) : '';
        assert.ok(notice !== undefined, 'Unexpected Calendar editor notice');
        assert.equal(await form.isVisible(), s.view === 'calendar' && !!s.form);
        if (await form.isVisible()) assert.equal(await title.inputValue(), s.form.title);
        const visible = await resume.isVisible();
        assert.equal(await discard.isVisible(), visible);
        if (visible) assert.equal(await discard.isEnabled(), await resume.isEnabled());
        return {'s.owner': ownerIndex(s.owner), 's.view': s.view, 's.detail': eventIndex(s.detail),
          's.form': actualForm, 's.retained': retained, 's.picker': !!s.form?.picker, 's.invalid': s.invalid,
          's.discarding': discarding, 's.lastForm': ids.size, 's.notice': notice,
          editorVisible: await form.isVisible(), pickerVisible: await picker.isVisible(), detailVisible: await detail.isVisible(),
          controlsVisible: visible, controlsEnabled: visible && await resume.isEnabled(), canConnect: await f.invoke('observeDraftScope')};
      }
      const t = trace(name, await observe());
      const mark = async (label, action) => checkpoint(t, label, action, await observe());
      const back = async () => {
        await f.page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
        await mark('Dispatch Alpha Back through the real shell', call('back'));
      };
      const newForm = async (expected) => {
        await f.button('New event').click();
        if (expected) await title.waitFor();
        await mark('Click the Calendar list New event action', call('newForm'));
      };
      const edit = async (expected) => {
        await detail.locator('summary[aria-label="Event actions"]').click();
        await f.button('Edit event').click();
        if (expected) await title.waitFor();
        await mark('Click the exact event detail Edit action', call('editForm'));
      };
      const editTitle = async value => {
        await title.fill(value);
        await mark('Change the mounted editor title', call('editTitle', titles.get(value)));
      };
      const openDetail = async target => {
        await f.page.getByRole('button', {name: new RegExp('^' + (target === 1 ? firstEvent : secondEvent) + ',')}).click();
        await detail.waitFor();
        await mark('Open the selected service event detail', call('openDetail', target));
      };
      const headerClose = async () => {
        await f.button('Back to calendar').click();await title.waitFor({state: 'detached'});
        await mark('Tap the editor header close', call('headerClose'));
      };
      const enter = async () => {
        await f.button('Calendar').click();
        await f.button('New event').waitFor();
        await mark('Open mounted Calendar', call('enterCalendar'));
      };
      const restore = async () => {
        await resume.click();await title.waitFor();
        await mark('Resume the exact retained form', call('resume'));
      };
      const decide = async accept => {
        await reviewCalendarAction(f.page, async () => {
          await discard.click();
          const review = f.page.getByRole('dialog', {name: 'Discard draft?', exact: true});
          await review.getByText('Saved events won’t change.', {exact: true}).waitFor();
          await review.getByRole('button', {name: 'Discard draft', exact: true}).waitFor();
        }, accept);
      };
      const holdDiscard = async (error) => {
        const gate = await f.invoke('hold', 'draft-clear', error);
        await decide(true);
        await f.page.waitForFunction(gate => window.quintCalendar.held(gate), gate);
        await mark('Confirm the exact retained draft, holding storage', call('discard', true));
        return gate;
      };
      const finishDiscard = async (gate, success) => {
        await f.invoke('release', gate);
        if (success) await resume.waitFor({state: 'detached'});
        else await f.page.waitForFunction(() => window.quintCalendar.snapshot().notices.at(-1) === 'This draft changed. Try again.');
        await mark('Settle the exact retained draft storage', call('finishDiscard', success));
      };
      const openPicker = async () => {
        await f.button('Add people').click();await picker.waitFor();
        await mark('Open the attendee picker above the editor', call('openPicker'));
      };
      try {
        await run({f, title, picker, detail, resume, discard, mark, back, newForm, edit, editTitle, openDetail,
          headerClose, enter, restore, decide, holdDiscard, finishDiscard, openPicker});
        traces.push(t);
      } finally {await f.close();}
    }
    await schedule('shell Back closes picker, then keeps exact draft for Resume', async c => {
      await c.enter();await c.newForm(true);await c.editTitle(firstTitle);await c.openPicker();
      await c.picker.fill('Transient attendee query');
      await c.mark('Transient attendee query does not replace retained form bytes', null);
      await c.back();await c.back();await c.restore();await c.headerClose();
    });
    await schedule('header close leaves picker and form together', async c => {
      await c.enter();await c.newForm(true);await c.editTitle(firstTitle);await c.openPicker();await c.headerClose();
      await c.restore();
    });
    await schedule('invalid draft close preserves the last valid exact revision', async c => {
      await c.enter();await c.newForm(true);await c.editTitle(firstTitle);await c.editTitle(oversized);
      await c.headerClose();await c.restore();
    });
    await schedule('decline preserves invalid draft while accepted durable discard clears latch', async c => {
      await c.enter();await c.newForm(true);await c.editTitle(firstTitle);await c.editTitle(oversized);
      await c.headerClose();await c.decide(false);
      await c.mark('Decline the actual discard confirmation', call('discard', false));
      const gate = await c.holdDiscard();
      await c.newForm(false);
      await c.finishDiscard(gate, true);
      await c.f.page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
      await c.mark('Leave Calendar for the apps surface', call('leaveCalendar'));
      await c.f.settings();
      await c.mark('Open mounted Calendar Settings', call('settings'));
      await c.f.button('Google Calendar').click();
      await c.f.page.getByRole('dialog', {name: 'Google accounts', exact: true}).waitFor();
      await c.mark('Calendar connection admission no longer sees the discarded form', null);
    });
    await schedule('failed durable discard keeps the last valid retained form', async c => {
      await c.enter();await c.newForm(true);await c.editTitle(firstTitle);await c.editTitle(oversized);await c.headerClose();
      const gate = await c.holdDiscard('Fixture Calendar draft storage failed');
      await c.finishDiscard(gate, false);await c.restore();
    });
    await schedule('fresh edit Back returns detail, retained Resume keeps the original target', async c => {
      await c.enter();await c.openDetail(1);await c.edit(true);await c.editTitle(secondTitle);
      await c.back();await c.back();await c.restore();await c.headerClose();
    });
    await schedule('retained edit blocks same and different event entry until explicit discard', async c => {
      await c.enter();await c.openDetail(1);await c.edit(true);await c.editTitle(firstTitle);
      await c.back();await c.back();await c.newForm(false);
      await c.openDetail(1);await c.edit(false);await c.back();await c.openDetail(2);await c.edit(false);await c.back();
      const gate = await c.holdDiscard();await c.finishDiscard(gate, true);
      await c.openDetail(2);await c.edit(true);
    });
    await schedule('owner replacement retires visible draft and preserves its original slot', async c => {
      await c.enter();await c.newForm(true);await c.editTitle(firstTitle);await c.openPicker();
      const prior = (await c.f.snapshot()).retained;
      await c.f.page.waitForFunction(async text => await window.quintCalendar.saved('owner-a') === text, prior, {polling: 100});
      await c.f.invoke('switchPort', 'owner-b', 'session-b');await c.f.status('ready', 'session-b');
      await c.title.waitFor({state: 'detached'});
      await c.f.invoke('bindDraftScope');
      await c.mark('Replacement owner cannot reopen the old editor', call('replaceOwner'));
      assert.equal(await c.f.invoke('saved', 'owner-a'), prior);
      assert.equal(await c.f.invoke('saved', 'owner-b'), '');
      await c.newForm(true);
    });
  } finally {await browser.close();}
  return checkTraces(boundInputs({model, scope: 'bounded-orchestration', sources: [...sources], traces,
    assumptions: ['Actual Chromium renderer, Alpha Back and header controls, live draft controller, and real IndexedDB through a closed Calendar record transport.',
      'Two source event targets, two owners, and four bounded exact form identities. Titles use equality classes for the exercised valid and overlong values.',
      'Provider saves, other destination adapters, and arbitrary document recovery are separate. Checkpoints group committed renderer state and selected durable receipts.']}));
}
