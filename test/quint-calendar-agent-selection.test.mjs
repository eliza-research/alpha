import assert from 'node:assert/strict';
import test from 'node:test';
import {actionCounts, modelTraces, sameState} from '../specs/quint/refinement/application/calendar-itf.mjs';
import {buildCalendarAdapter, calendarAdapterFixture} from '../specs/quint/refinement/application/calendar-adapter-fixture.mjs';

const model = {path: 'specs/quint/application/CalendarAgentSelection.qnt', module: 'CalendarAgentSelection',
  witnesses: ['EventSelectedWitness', 'SourceSelectedWitness', 'RetiredInspectionWitness', 'SourceHiddenByCalendarChoiceWitness'],
  goals: {
    keptAcrossCommit: 's.selection.kind == "event" and s.shown.get(2) == 1 and s.open == s.selection.open and s.epoch >= 2',
    droppedByCommit: 's.selection.kind == "none" and s.open == 1 and s.shown.get(1) == 1 and s.keyOpen == 0 and s.epoch == 2 and s.pending == "none"',
    reinspectedAfterRefresh: 's.selection.kind == "event" and s.selection.revision == 2',
    lateSourceDropped: 's.pending == "none" and s.form == "other" and s.selection.kind == "none" and s.epoch == 1',
  }};
const none = {kind: 'none', open: 0, revision: 0};
const begin = new Date(2027, 0, 15, 15).getTime();
const rowId = event => `calendar:${event}:${begin}`;
const eventOf = id => id ? Number(String(id).split(':')[1]) : 0;

async function replay(compiled, trace) {
  const f = calendarAdapterFixture(compiled);
  const provider = {1: 0, 2: 0};
  let selectionEpoch = 0, pending = {kind: 'none', token: 0, open: 0}, close;
  Object.assign(f.handlers, {
    list: () => ({status: 'ready', calendars: [{id: 'local', local: true, writable: true, account: 'Alpha Phone', name: 'Phone'}],
      events: [1, 2].map(event => ({id: String(event), calendarId: 'local', title: 'Event ' + event, body: '', location: '',
        begin, end: begin + 3600000, revision: provider[event]}))}),
    pendingCreations: () => ({status: 'ready', creations: []}),
    requestAccess: () => ({status: 'granted'}),
    inspectDeletion: () => ({status: 'changed'}),
  });
  const shell = new f.Shell();
  shell.componentDidMount();
  await f.idle();
  const newEvent = f.render().newEvent, base = f.probe.selection().epoch;
  f.hold('inspect', 1000); f.hold('prepareAgentSource', 1000);
  const epoch = () => f.probe.selection().epoch - base;
  const selection = () => {
    const value = f.probe.selection().selection;
    return !value ? none : value.kind === 'calendar-source' ? {kind: 'source', open: 0, revision: 0}
      : {kind: 'event', open: eventOf(value.open), revision: value.revision};
  };
  // The model keeps one awaited answer. An older one still in flight answers now and must change nothing.
  const supersede = async name => {
    while (f.waiting(name) > (pending.kind === (name === 'inspect' ? 'event' : 'source') ? 1 : 0)) {
      const before = JSON.stringify([selection(), epoch(), f.calendar]);
      await f.settle(name, ({id} = {}) => name === 'inspect' ? {status: 'ready', eventId: id, revision: provider[id], sourceRevision: 'source'}
        : {status: 'ready', sourceId: 'local', sourceRevision: 'source'});
      assert.equal(JSON.stringify([selection(), epoch(), f.calendar]), before, 'a retired answer is dropped');
    }
  };
  const observe = () => {
    const {key} = f.probe.selection(), parsed = key ? JSON.parse(key) : null;
    return {open: eventOf(f.calendar.open),
      shown: Object.fromEntries([1, 2].map(event => [event, shell.nativeCalendarRows.find(row => row.alphaCalendarId === String(event)).nativeEvent.revision])),
      provider: {...provider}, form: !f.calendar.form ? 'none' : f.calendar.form.cal === 'native:local' ? 'local' : 'other',
      selection: selection(), selectionEpoch, keyOpen: parsed ? eventOf(parsed[0]) : 0, keyRevision: parsed ? parsed[1].revision : 0,
      epoch: epoch(), pending: pending.kind, pendingToken: pending.token, pendingOpen: pending.open};
  };
  // What the assistant is handed must be exactly what the model exposes.
  const exposure = expected => {
    const exposed = expected.selection.kind === 'source' ? (expected.form === 'local' ? expected.selection : none)
      : expected.selection.kind === 'event' && expected.open === expected.selection.open ? expected.selection : none;
    const actual = shell.calendarSelection();
    assert.deepEqual(!actual ? none : actual.kind === 'calendar-source' ? {kind: 'source', open: 0, revision: 0}
      : {kind: 'event', open: Number(actual.id), revision: actual.revision}, exposed);
    if (actual?.kind === 'calendar-event') assert.equal(rowId(actual.id), f.calendar.open, 'only the open event is exposed');
  };
  const check = index => { sameState(observe(), trace.steps[index].state, trace, index); exposure(trace.steps[index].state); };
  check(0);
  for (let index = 1; index < trace.steps.length; index++) {
    const {action, picks} = trace.steps[index], had = selection().kind;
    if (action === 'openEvent') f.calendar.open = rowId(picks.e);
    else if (action === 'renderDetail') {
      close = f.render().ev.close;
      await f.idle();
      pending = {kind: 'event', token: epoch(), open: eventOf(f.calendar.open)};
      await supersede('inspect'); await supersede('prepareAgentSource');
    } else if (action === 'inspected') {
      const answered = pending.open;
      pending = {kind: 'none', token: pending.token, open: pending.open};
      await f.settle('inspect', () => picks.flag ? {status: 'ready', eventId: String(answered), revision: provider[answered],
        sourceRevision: 'source'} : {status: 'changed'});
    } else if (action === 'closeEvent') close();
    else if (action === 'refresh') { await shell.refreshAgentCalendar(); await f.idle(); }
    else if (action === 'commitElsewhere') {
      f.window.dispatchEvent(new CustomEvent('alpha:calendar-committed', {detail: {eventId: 'elsewhere'}}));
      await f.idle();
    } else if (action === 'providerChange') provider[picks.e]++;
    else if (action === 'newForm') {
      void newEvent();
      await f.idle();
      pending = {kind: 'source', token: epoch(), open: 0};
      await supersede('inspect'); await supersede('prepareAgentSource');
    } else if (action === 'sourcePrepared') {
      pending = {kind: 'none', token: pending.token, open: 0};
      await f.settle('prepareAgentSource', () => picks.flag ? {status: 'ready', sourceId: 'local', sourceRevision: 'source'}
        : {status: 'unavailable'});
    } else if (action === 'pickCalendar') f.calendar.form = {...f.calendar.form, cal: picks.flag ? 'native:local' : 'native:7'};
    else if (action === 'closeForm') f.calendar.form = null;
    else assert.equal(action, '', `Unmapped model action ${action}`);
    // A selection belongs to the epoch in which it was made or handed back.
    if (selection().kind !== 'none' && (had === 'none' || action === 'commitElsewhere')) selectionEpoch = epoch();
    check(index);
  }
  return trace.steps.length - 1;
}

async function checkCalendarAgentSelection(mutate) {
  const compiled = await buildCalendarAdapter(mutate), traces = await modelTraces({...model, traces: 30, steps: 40});
  let steps = 0;
  for (const trace of traces) steps += await replay(compiled, trace);
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}

test('the calendar adapter follows every CalendarAgentSelection model step', {timeout: 280000}, async () => {
  const result = await checkCalendarAgentSelection();
  assert.equal(result.traces, 38);
  for (const action of ['openEvent', 'renderDetail', 'inspected', 'closeEvent', 'refresh', 'commitElsewhere', 'providerChange',
    'newForm', 'sourcePrepared', 'pickCalendar', 'closeForm', 'stutter']) assert.ok(result.actions[action] > 0, action);
  assert.ok(result.sources.includes('apps/app/src/prototype/calendar-adapter.ts'));
});

test('an inspection answer kept after its epoch ended is rejected by the replay', {timeout: 280000}, async () => {
  const guard = 'token === agentSelectionEpoch';
  await assert.rejects(checkCalendarAgentSelection(code => {
    assert.ok(code.includes(guard));
    return code.replaceAll(guard, 'true');
  }), /retired answer is dropped|inspected|sourcePrepared/);
});
