import assert from 'node:assert/strict';
import test from 'node:test';
import {checkDayAnchor} from '../specs/quint/refinement/application/day-anchor.mjs';
import {buildCalendarAdapter, calendarAdapterFixture} from '../specs/quint/refinement/application/calendar-adapter-fixture.mjs';

test('the calendar adapters follow every DayAnchor model step', {timeout: 280000}, async () => {
  const result = await checkDayAnchor();
  assert.equal(result.traces, 40);
  for (const action of ['openForm', 'closeForm', 'midnight', 'refresh', 'render', 'save', 'unmount', 'mount', 'stutter'])
    assert.ok(result.actions[action] > 0, action);
  for (const source of ['apps/app/src/prototype/calendar-adapter.ts', 'apps/app/src/prototype/calendar-form-draft-adapter.ts',
    'apps/app/src/prototype/calendar-edit-draft-adapter.ts']) assert.ok(result.sources.includes(source), source);
});

test('an editor that keeps a closed form\'s anchor is rejected by the replay', {timeout: 280000}, async () => {
  const forget = 'this.calendarEditDraftIdentity = void 0;\n      return;';
  await assert.rejects(checkDayAnchor(code => {
    assert.ok(code.includes(forget));
    return code.replace(forget, 'return;');
  }), /openForm/);
});

test('an editor closed before midnight and reopened after it shows the event on its own day', async () => {
  const f = calendarAdapterFixture(await buildCalendarAdapter(), {drafts: true});
  const begin = new Date(2027, 0, 16, 15).getTime();
  f.handlers.list = () => ({status: 'ready', calendars: [], events: []});
  f.handlers.pendingCreations = () => ({status: 'ready', creations: []});
  const shell = new f.Shell();
  shell.componentDidMount();
  await f.idle();
  const editor = off => ({id: `calendar:1:${begin}`, alphaCalendarId: '1', title: 'Event', off, t: 15, d: 1, cal: 'native:local',
    expected: {revision: 'unchanged'}});
  const show = form => { f.calendar.form = form; shell.componentDidUpdate({}); shell.componentDidUpdate({}); };
  show(editor(1));
  assert.equal(f.calendar.form.off, 1);
  show(null);
  f.state.now += 2 * 86400000;
  // The rows were read again after the date changed, so the fresh editor already counts from today.
  show(editor(-1));
  assert.equal(f.calendar.form.off, -1);
  // The same editor left open across the next midnight still moves with the date.
  f.state.now += 86400000;
  shell.componentDidUpdate({});
  assert.equal(f.calendar.form.off, -2);
});
