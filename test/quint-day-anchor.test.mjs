import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCalendarAdapter, calendarAdapterFixture} from '../specs/quint/refinement/application/calendar-adapter-fixture.mjs';
import {actionCounts, modelTraces, sameState} from '../specs/quint/refinement/application/calendar-itf.mjs';

const model = {path: 'specs/quint/application/DayAnchor.qnt', module: 'DayAnchor',
  witnesses: ['StaleRowsAwaitingTimerWitness', 'ReanchoredFormWitness', 'PlainFormReanchoredWitness', 'SavedBeforeTimerWitness',
    'RowsHiddenAfterFailedReadWitness', 'ReopenedEditWitness'],
  goals: {
    creationSavedAfterTwoMidnights: 's.saved and s.savedRetained and s.savedIntended == 1 and s.savedDay == 1 and s.today == 2 and not(s.savedWhileDue)',
    editSavedAfterMidnight: 's.saved and s.savedRetained and s.savedIntended == 0 and s.savedDay == 0 and s.today == 1 and s.rowReadDay == 1',
    plainSavedAfterMidnight: 's.saved and not(s.savedRetained) and s.savedIntended == 1 and s.savedDay == 1 and s.today == 2 and not(s.savedWhileDue)',
    remountedAfterMidnight: 's.mounted and s.today == 2 and s.rowReadDay == 2 and not(s.refreshDue) and s.form == "plain"',
  }};
const DAY = 86400000;
const civil = instant => { const date = new Date(instant); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); };

async function replay(compiled, trace) {
  const f = calendarAdapterFixture(compiled, {drafts: true});
  const day0 = civil(f.state.now), begin = new Date(2027, 0, 16, 15).getTime(), row = `calendar:1:${begin}`;
  const dayOf = instant => (civil(instant) - day0) / DAY, today = () => dayOf(f.state.now);
  const reminders = [{id: 'r1', title: 'Reminder', body: '', at: begin, dueAt: begin, alertMinutes: 0, status: 'scheduled', occurrenceId: 'first'}];
  let listOk = true, shell, formIntended = 0, lastOff = 0, lastAnchor = 0, closedEditDay = -1;
  const saved = {saved: false, savedRetained: false, savedWhileDue: false, savedDay: 0, savedIntended: 0};
  Object.assign(f.handlers, {
    list() {
      if (!listOk) throw Error('Calendar provider unavailable');
      return {status: 'ready', calendars: [{id: 'local', local: true, writable: true, account: 'Alpha Phone', name: 'Phone'}],
        events: [{id: '1', calendarId: 'local', title: 'Event', body: '', location: '', begin, end: begin + 3600000}]};
    },
    pendingCreations: () => ({status: 'ready', creations: []}),
    requestAccess: () => ({status: 'granted'}),
    save: args => ({status: 'saved', creationId: args.creationId, id: args.id || '99'}),
    acknowledgeCreation: () => ({status: 'acknowledged'}),
    inspect: ({id}) => ({status: 'ready', eventId: id, revision: 'revision', sourceRevision: 'source'}),
  });
  // The reminder adapter's publication, through the real reminder row projection.
  f.Shell.prototype.refreshReminders = async function () {
    f.calendar.events = [...(this.nativeCalendarRows || []), ...f.exports.reminderEvents(reminders)];
  };
  // React re-renders after each state change until the adapters stop changing the form.
  const rerender = () => { for (let pass = 0; pass < 3; pass++) shell.componentDidUpdate({}); };
  const mount = async () => {
    Object.assign(f.calendar, {events: [], form: null, open: null, day: 0, month: null});
    shell = new f.Shell();
    shell.componentDidMount();
    await f.idle();
    rerender();
  };
  await mount();
  const due = () => f.timers.find(timer => !timer.cancelled && !timer.done && timer.at <= f.state.now);
  const kindOf = form => !form ? 'none' : form.id ? 'edit' : form.creationId ? 'creation' : 'plain';
  const observe = () => {
    const mounted = shell.live, form = mounted ? f.calendar.form : null, kind = kindOf(form);
    if (mounted) f.render();
    const shown = mounted ? f.state.rendered.events : [], device = shown.find(item => item.alphaCalendarId);
    if (device) assert.equal(device.off, shell.nativeCalendarRows[0].off);
    const anchor = kind === 'creation' ? shell.calendarDraftAnchor : kind === 'edit' ? shell.calendarEditDraftAnchor : shell.calendarPlainFormAnchor;
    if (form) { lastOff = form.off; lastAnchor = dayOf(anchor.getTime()); }
    return {today: today(), mounted, refreshDue: !!due(), rowsShown: !!device, rowReadDay: 1 - shell.nativeCalendarRows[0].off, rowDay: 1,
      // A closed form's last offset and anchor are no longer read by anything.
      form: kind, formOff: lastOff, formAnchor: lastAnchor, formIntended,
      // When this mount last closed an editor unsaved: the driver's record of that owner action.
      closedEditDay, ...saved};
  };
  const same = index => {
    const expected = {...trace.steps[index].state};
    if (expected.form === 'none') { lastOff = expected.formOff; lastAnchor = expected.formAnchor; }
    sameState(observe(), expected, trace, index);
  };
  same(0);
  for (let index = 1; index < trace.steps.length; index++) {
    const {action, picks} = trace.steps[index];
    if (action === 'openForm') {
      const base = {title: 'Draft', off: picks.off, t: 10, d: 1, where: '', video: false, who: [], repeat: 'none', notes: ''};
      f.calendar.form = picks.kind === 'creation' ? {...base, id: null, creationId: f.state.uuid++ + '-creation', separateCreation: false,
        cal: 'native:local', alert: null}
        : picks.kind === 'edit' ? {...base, id: row, alphaCalendarId: '1', cal: 'native:local', alert: null,
          expected: {title: 'Event', body: '', location: '', begin, end: begin + 3600000, revision: 'revision'}}
          : {...base, id: null, cal: 'alpha-reminders', alert: 0};
      formIntended = today() + picks.off;
      rerender();
    } else if (action === 'closeForm') {
      if (kindOf(f.calendar.form) === 'edit') closedEditDay = today();
      f.calendar.form = null; rerender();
    }
    else if (action === 'midnight') f.state.now += DAY;
    else if (action === 'refresh') {
      listOk = picks.ok;
      const timer = due();
      // The midnight timer when it is due, otherwise the app resuming.
      if (timer) { timer.done = true; timer.run(); } else f.listeners.get('appResumed')();
      await f.idle();
      listOk = true;
      if (timer) assert.equal(f.calendar.events.find(item => item.alphaReminderId).off, 1 - today(), 'the timer reads the reminders again too');
      rerender();
    } else if (action === 'render') rerender();
    else if (action === 'save') {
      const form = f.calendar.form;
      Object.assign(saved, {saved: true, savedRetained: f.exports.calendarFormRetained(form), savedWhileDue: !!due(), savedIntended: formIntended});
      if (kindOf(form) === 'plain') {
        // A reminder form resolves its day with the same wall-time function the reminder save uses.
        saved.savedDay = dayOf(f.exports.reminderWallTime(form.off, form.t).getTime());
        f.calendar.form = null;
      } else {
        await f.render().f.save();
        await f.idle();
        saved.savedDay = dayOf(f.calls.findLast(call => call.name === 'save').args.begin);
        assert.equal(f.calendar.form, null);
      }
      rerender();
    } else if (action === 'unmount') { shell.live = false; closedEditDay = -1; shell.componentWillUnmount(); await f.idle(); }
    else if (action === 'mount') await mount();
    else assert.equal(action, '', `Unmapped model action ${action}`);
    same(index);
  }
  return trace.steps.length - 1;
}

async function checkDayAnchor(mutate) {
  const compiled = await buildCalendarAdapter(mutate), traces = await modelTraces({...model, traces: 30, steps: 40});
  let steps = 0;
  for (const trace of traces) steps += await replay(compiled, trace);
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}

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
