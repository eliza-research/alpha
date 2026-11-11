import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {mountedCalendarFixtureSources, startMountedCalendar} from '../../../../test/fixtures/calendar-mounted-editor.mjs';
import {checkTraces} from '../check-traces.mjs';
import {boundInputs, call, captureSources, checkpoint, trace} from './support.mjs';

const driver = fileURLToPath(import.meta.url);
const model = 'CanonicalCalendarEditorClose';
const events = ['Fixture Existing Event A', 'Fixture Existing Event B'];
const firstTitle = 'First retained edit', secondTitle = 'Second retained edit';
const oversized = 'x'.repeat(2049);
const titles = new Map([['', ''], [events[0], 'event-a'], [events[1], 'event-b'],
  [firstTitle, 'first'], [secondTitle, 'second'], [oversized, 'oversized']]);
const inputs = ['apps/app/src/prototype/canonical-calendar-drafts.ts', 'apps/app/src/prototype/template.html',
  'apps/app/src/prototype/model.js', 'apps/app/src/prototype/subview-accessibility.ts', 'apps/app/src/runtime/canonical-calendar-draft.ts',
  'apps/app/src/runtime/assistant-draft-store.ts', 'apps/app/src/prototype/assistant-draft-controller.ts',
  '.eliza/client-features/packages/ui/src/state/durable-draft-controller.ts'];
const empty = {id: 0, owner: 0, target: 0, title: ''};
function eventIndex(key) {
  if (!key) return 0;
  const parts = JSON.parse(key.replace(/^canonical-calendar:/, ''));
  assert.equal(parts[0], 'eliza');
  const index = ['fixture-event-0', 'fixture-event-1'].indexOf(parts.at(-1));
  assert.notEqual(index, -1, 'Known selected event');
  return index + 1;
}
function ownerIndex(name) {
  assert.ok(['owner-a', 'owner-b'].includes(name));
  return name === 'owner-a' ? 1 : 2;
}

export async function checkCanonicalCalendarEditorClose(extraSources = []) {
  const sources = new Set([driver, ...mountedCalendarFixtureSources, ...inputs, ...extraSources]);
  captureSources([...sources]);
  const browser = await startMountedCalendar({onSource(path) {
    if (!sources.has(path)) {sources.add(path);captureSources([path]);}
  }});
  const traces = [];
  try {
    async function schedule(name, run) {
      const f = await browser.page({eventTitles: events});
      await f.invoke('bindDraftScope');
      const ids = new Map();
      const title = f.page.getByRole('textbox', {name: 'Title', exact: true});
      const form = f.page.locator('[data-alpha-subview="calendar-form"]:not([inert])');
      const detail = f.page.locator('[data-alpha-subview="calendar-detail"]:not([inert])');
      const mapForm = value => {
        if (!value) return empty;
        if (!ids.has(value.id)) ids.set(value.id, ids.size + 1);
        assert.ok(titles.has(value.title), 'Exact editor title remains known');
        return {id: ids.get(value.id), owner: ownerIndex(JSON.parse(value.owner)[1]),
          target: eventIndex(value.target), title: titles.get(value.title)};
      };
      async function observe() {
        const s = await f.snapshot();
        const current = mapForm(s.form), retained = mapForm(s.retainedForm);
        assert.equal(await form.isVisible(), s.view === 'calendar' && !!s.form);
        if (await form.isVisible()) assert.equal(await title.inputValue(), s.form.title);
        assert.equal(await f.button('Resume event draft').isVisible(), false);
        assert.equal(await f.button('Discard event draft').isVisible(), false);
        assert.equal(await f.button('Add people').isVisible(), false);
        assert.deepEqual(s.notices, [], 'Opening and closing retained drafts needs no blocking notice');
        return {'s.owner': ownerIndex(s.owner), 's.view': s.view, 's.detail': eventIndex(s.detail),
          's.form': current, 's.retained': retained, 's.invalid': s.invalid, 's.lastForm': ids.size,
          editorVisible: await form.isVisible(), detailVisible: await detail.isVisible(), controlsVisible: false,
          canConnect: await f.invoke('observeDraftScope')};
      }
      const t = trace(name, await observe());
      const mark = async (label, action) => checkpoint(t, label, action, await observe());
      const enter = async () => {
        await f.button('Calendar').click();await f.button('New event').waitFor();
        await mark('Open Calendar', call('enterCalendar'));
      };
      const newForm = async () => {
        await f.button('New event').click();await title.waitFor();
        await mark('Open or resume the new-event draft', call('newForm'));
      };
      const edit = async () => {
        await detail.locator('summary[aria-label="Event actions"]').click();
        await f.button('Edit event').click();await title.waitFor();
        await mark('Open or resume this exact event draft', call('editForm'));
      };
      const editTitle = async value => {
        await title.fill(value);await mark('Edit the current draft', call('editTitle', titles.get(value)));
      };
      const openDetail = async target => {
        await f.page.getByRole('button', {name: new RegExp('^' + events[target - 1] + ',')}).click();
        await detail.waitFor();await mark('Open the chosen event', call('openDetail', target));
      };
      const back = async () => {
        await f.page.evaluate(() => window.dispatchEvent(new Event('alpha-back', {cancelable: true})));
        await mark('Use Alpha Back', call('back'));
      };
      const headerClose = async () => {
        await f.button('Back to calendar').click();await title.waitFor({state: 'detached'});
        await mark('Close the editor and retain its draft', call('headerClose'));
      };
      const leave = async () => {
        await f.page.evaluate(() => window.dispatchEvent(new Event('launcher-home')));
        await mark('Leave Calendar', call('leaveCalendar'));
      };
      try {
        await run({f, enter, newForm, edit, editTitle, openDetail, back, headerClose, leave, mark, title});
        traces.push(t);
      } finally {await f.close();}
    }
    await schedule('Back and New event restore the same draft automatically', async c => {
      await c.enter();await c.newForm();await c.editTitle(firstTitle);await c.back();await c.newForm();await c.headerClose();
    });
    await schedule('Header close preserves the same new-event draft', async c => {
      await c.enter();await c.newForm();await c.editTitle(secondTitle);await c.headerClose();await c.newForm();await c.back();
    });
    await schedule('Invalid input retains the last valid copy for automatic reopen', async c => {
      await c.enter();await c.newForm();await c.editTitle(firstTitle);await c.editTitle(oversized);await c.headerClose();await c.newForm();
    });
    await schedule('Existing events retain independent edits', async c => {
      await c.enter();await c.openDetail(1);await c.edit();await c.editTitle(firstTitle);await c.back();await c.back();
      await c.openDetail(2);await c.edit();await c.editTitle(secondTitle);await c.back();await c.back();await c.openDetail(1);await c.edit();
    });
    await schedule('A new event and an existing event retain separate drafts', async c => {
      await c.enter();await c.newForm();await c.editTitle(firstTitle);await c.back();await c.openDetail(1);await c.edit();
      await c.editTitle(secondTitle);await c.back();await c.back();await c.newForm();
    });
    await schedule('Leaving Calendar retains the draft for the next visit', async c => {
      await c.enter();await c.newForm();await c.editTitle(firstTitle);await c.back();await c.leave();await c.enter();await c.newForm();
    });
    await schedule('Owner replacement retires the editor and preserves the original owner slot', async c => {
      await c.enter();await c.newForm();await c.editTitle(firstTitle);
      const prior = (await c.f.snapshot()).retained;
      await c.f.page.waitForFunction(async text => await window.quintCalendar.saved('owner-a') === text, prior);
      await c.f.invoke('switchPort', 'owner-b', 'session-b');await c.f.status('ready', 'session-b');
      await c.title.waitFor({state: 'detached'});await c.f.invoke('bindDraftScope');
      await c.mark('Replace the owner without restoring their predecessor draft', call('replaceOwner'));
      assert.equal(await c.f.invoke('saved', 'owner-a'), prior);
      await c.newForm();
    });
    await schedule('An untitled draft also resumes with its original identity', async c => {
      await c.enter();await c.newForm();await c.headerClose();await c.newForm();
    });
  } finally {await browser.close();}
  return checkTraces(boundInputs({model, scope: 'bounded-orchestration', sources: [...sources], traces,
    assumptions: ['Actual Chromium editor, Alpha Back, normal New/Edit entry points, draft controller and IndexedDB execute against a closed read-only event transport.',
      'Two event targets plus the new-event slot, two owners and up to six draft identities. Reopening validates persisted identity and text through the normal UI.',
      'Provider writes, deletion and conflict recovery are separate campaigns. Removed attendee and manual draft controls must remain absent.']}));
}
