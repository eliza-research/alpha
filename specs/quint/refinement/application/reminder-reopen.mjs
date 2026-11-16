import assert from 'node:assert/strict';
import {actionCounts, modelTraces, sameState} from './calendar-itf.mjs';
import {captureInputs, checkTraces} from '../check-traces.mjs';
import {buildReminderAdapter, reminderAdapterFixture} from './reminder-adapter-fixture.mjs';

const model = {path: 'specs/quint/application/ReminderReopen.qnt', module: 'ReminderReopen',
  witnesses: ['ReopenedWitness', 'TimePassedWitness', 'UnconfirmedRecordWitness', 'ReadBackOnlyWitness', 'MovedScheduleWitness',
    'OtherModeWitness', 'LeftAfterRetainWitness', 'ChangedWitness', 'AppliedAwaitingRefreshWitness', 'UnreadWitness',
    'CompletedAgainWitness'],
  goals: {
    readBackConfirms: 's.outcome == "reopened" and s.operates == 1 and s.starts == 2',
    refreshAcknowledges: 's.outcome == "acknowledged" and s.operates == 1 and not(s.completed)',
    reopenedTwice: 's.outcome == "reopened" and s.operates == 2 and s.retains == 2',
    changedAfterFailedReadback: 's.outcome == "changed" and s.operates == 1 and not(s.completed)',
    passedWithRecord: 's.outcome == "passed" and s.journal != "none"',
  }};
const actions = 'reminder-deletions:v1:device', open = 'reminder:d1', days = 86400000;

async function replay(compiled, trace) {
  const f = reminderAdapterFixture(compiled);
  const receipts = new Map(), seen = new Set();
  // A one-off reminder completed after it was due.
  const native = {revision: 1, status: 'completed', occurrence: 1, dueAt: f.state.now - 2 * 3600000, alertMinutes: 0};
  let listOk = true, mode = 'none', stage = 'idle', starts = 0, outcome = 'none', mintedBefore = 0, journalFresh = true;
  let operateWithoutRecord = false, startedStale = false, startedOpen = false, startedUnreviewed = false, result = '';
  // The review answers at once; when the model says the reviewed time passed, the clock moves during it.
  let approval = {approved: true, passed: false, asked: 0};
  Object.defineProperty(f.state, 'confirm', {configurable: true, get() {
    approval.asked++;
    if (approval.approved && approval.passed) f.state.now += 3 * days;
    return approval.approved;
  }});
  const target = () => ({sourceId: 'closed-store', sourceRevision: 'a'.repeat(64), reminderId: 'd1', occurrenceId: `occurrence-${native.occurrence}`,
    revision: String(native.revision).repeat(64), timingVersion: 2});
  const row = () => ({id: 'd1', title: 'Dated', body: '', at: native.dueAt, dueAt: native.dueAt, alertMinutes: native.alertMinutes,
    mode: 'inexact', status: native.status, occurrenceId: `occurrence-${native.occurrence}`, target: target()});
  const apply = input => {
    const {schedule} = input.operation.fields;
    Object.assign(native, {revision: native.revision + 1, occurrence: native.occurrence + 1, dueAt: schedule.dueAt,
      alertMinutes: schedule.alertMinutes, status: schedule.alertMinutes === null ? 'pending' : 'scheduled'});
    receipts.set(input.operationId, {version: 1, kind: input.operation.type, sourceId: 'closed-store', reminderId: 'd1',
      occurrenceId: `occurrence-${native.occurrence}`, revision: String(native.revision).repeat(64), status: native.status,
      at: schedule.at, dueAt: schedule.dueAt, alertMinutes: schedule.alertMinutes});
  };
  const completeElsewhere = () => Object.assign(native, {revision: native.revision + 1, occurrence: native.occurrence + 1, status: 'completed'});
  Object.assign(f.handlers, {
    listReminders() {
      if (!listOk) throw Error('Secure store locked');
      return {reminders: [row()]};
    },
    surfaceInfo: () => ({reminderTodoVersion: 1, reminderTapVersion: 1, reminderTimingVersion: 2}),
    pendingReminderTap: () => ({}),
    selectedReminder: target,
    operateReminder(input) {
      operateWithoutRecord ||= !f.journal(actions)[input.operationId];
      assert.equal(input.operation.type, 'reminder_update');
      assert.ok(input.operation.fields.schedule.at > f.state.now, 'the reviewed time is still ahead when native is asked');
      if (result !== 'lost-never') apply(input);
      if (result === 'succeeded') return {status: 'succeeded', result: receipts.get(input.operationId)};
      throw Error('The answer was lost');
    },
    reminderOperationReceipt: input => receipts.has(input.operationId) ? {status: 'succeeded', result: receipts.get(input.operationId)}
      : {status: 'unknown'},
  });
  const shell = new f.Shell();
  shell.componentDidMount();
  await f.idle();
  f.calendar.open = open;
  const record = () => { const rows = Object.values(f.journal(actions)); assert.ok(rows.length <= 1); return rows[0]; };
  const event = () => f.calendar.events.find(item => item.id === open);
  const stale = () => !!f.calendar.reminderStale || !!shell.reminderRefreshFailed;
  const observe = () => {
    const journaled = record();
    if (journaled) seen.add(journaled.operationId);
    return {stale: stale(), selected: f.calendar.open === open, completed: event().reminderStatus === 'completed',
      nativeCompleted: native.status === 'completed', saving: !!shell.reminderSaving, stage, mode,
      journal: journaled ? (journaled.operation.fields.schedule.alertMinutes === null ? 'open' : 'tomorrow') : 'none',
      journalFresh: !journaled || journalFresh,
      own: !!journaled && stage !== 'idle' && Number(journaled.operationId.slice(-12)) > mintedBefore,
      applied: !!journaled && receipts.has(journaled.operationId), revisionCurrent: event().reminderTarget.revision === target().revision,
      starts, retains: seen.size, operates: f.count('operateReminder'), outcome, operateWithoutRecord, startedStale, startedOpen,
      startedUnreviewed};
  };
  const finish = (value, toast) => {
    stage = 'idle'; mode = 'none'; outcome = value;
    if (toast) assert.match(f.toasts.at(-1), toast);
  };
  const press = (detail, pressed) => pressed === 'open' ? detail.reminderReopen() : detail.reminderReopenTomorrow();
  sameState(observe(), trace.steps[0].state, trace, 0);
  assert.equal(f.render().ev.reminderReopenable, true);
  for (let index = 1; index < trace.steps.length; index++) {
    const {action, picks} = trace.steps[index], said = f.toasts.length;
    if (action === 'start') {
      const approved = picks.lot !== 0, passed = picks.lot === 1, detail = f.render().ev, reads = f.count('secureRead');
      approval = {approved, passed, asked: 0};
      mintedBefore = f.state.uuid;
      const completed = event().reminderStatus === 'completed', fresh = !stale();
      f.hold('secureRead', 1);
      void press(detail, picks.mode);
      await f.idle();
      assert.equal(approval.asked, 1, 'the owner reviews the new time');
      if (approved && !passed) {
        starts++; mode = picks.mode; stage = 'lookup';
        startedStale ||= !fresh; startedOpen ||= !completed;
        assert.equal(f.waiting('secureRead'), 1, 'an admitted reopen reads the journal first');
      } else {
        f.release('secureRead');
        assert.equal(f.count('secureRead'), reads, 'nothing is read without an approved, future time');
        if (approved) { outcome = 'passed'; assert.equal(f.toasts.at(-1), 'Time passed'); if (record()) journalFresh = false; }
        else { outcome = 'declined'; assert.equal(f.toasts.length, said); }
      }
      startedUnreviewed ||= !!shell.reminderSaving && (!approved || passed);
    } else if (action === 'lookup') {
      const journaled = record(), sent = f.count('operateReminder');
      const same = journaled && observe().journal === mode && journalFresh;
      if (same) f.hold('reminderOperationReceipt', 1);
      else if (!journaled) f.hold('selectedReminder', 1);
      await f.settle('secureRead');
      if (same) { assert.equal(f.waiting('reminderOperationReceipt'), 1); stage = 'receipt'; }
      else if (journaled) finish('conflict', /^Unconfirmed$/);
      else { assert.equal(f.waiting('selectedReminder'), 1); stage = 'select'; }
      assert.equal(f.count('operateReminder'), sent, 'reading the journal sends nothing');
    } else if (action === 'selectedRead') {
      const current = event().reminderTarget.revision === target().revision, selected = f.calendar.open === open;
      // The write pauses once its record is confirmed written.
      if (current && selected) f.hold('secureRead', 1, 1);
      await f.settle('selectedReminder');
      if (!current) finish('changed', /^Changed$/);
      else if (!selected) { finish('left'); assert.equal(f.toasts.length, said); }
      else { assert.equal(f.waiting('secureRead'), 1); stage = 'retained'; journalFresh = true; }
    } else if (action === 'afterRetain') {
      const selected = f.calendar.open === open;
      if (selected) f.hold('operateReminder', 1);
      await f.settle('secureRead');
      if (selected) { assert.equal(f.waiting('operateReminder'), 1); stage = 'operate'; }
      else { finish('left'); assert.equal(f.toasts.length, said); assert.equal(record(), undefined, 'the unsent record is removed'); }
    } else if (action === 'operated') {
      result = picks.result;
      f.hold(result === 'succeeded' ? 'listReminders' : 'reminderOperationReceipt', 1);
      await f.settle('operateReminder');
      if (result === 'succeeded') { assert.equal(f.waiting('listReminders'), 1, 'a confirmed reopen is read back'); stage = 'readback'; }
      else { assert.equal(f.waiting('reminderOperationReceipt'), 1); stage = 'receipt'; }
    } else if (action === 'receipt') {
      const sent = f.count('operateReminder'), confirmed = picks.ok && receipts.has(record().operationId);
      if (confirmed) f.hold('listReminders', 1);
      await f.settle('reminderOperationReceipt', input => { if (!picks.ok) throw Error('The answer was lost'); return f.handlers.reminderOperationReceipt(input); });
      assert.equal(f.count('operateReminder'), sent, 'a journaled reopen is only read back');
      if (confirmed) { assert.equal(f.waiting('listReminders'), 1, 'a confirmed reopen is read back'); stage = 'readback'; }
      else finish('unconfirmed', /^Unconfirmed$/);
    } else if (action === 'readback') {
      assert.equal(record(), undefined, 'the confirmed record is removed before the read back');
      const shown = event().reminderTarget.revision;
      await f.settle('listReminders', () => {
        if (picks.found === 'failed') throw Error('Secure store locked');
        if (picks.found === 'changed') completeElsewhere();
        return f.handlers.listReminders();
      });
      if (picks.found === 'match') finish('reopened', /^Reopened/);
      else { finish('unread', /^Unconfirmed$/); assert.equal(event().reminderTarget.revision, shown, 'the detail keeps what it showed'); }
    } else if (action === 'leave') f.calendar.open = null;
    else if (action === 'show') f.calendar.open = open;
    else if (action === 'changedElsewhere') native.revision++;
    else if (action === 'completeAgain') { completeElsewhere(); await shell.refreshReminders(); }
    else if (action === 'tick') { f.state.now += 3 * days; journalFresh = false; }
    else if (action === 'refresh') {
      const sent = f.count('operateReminder'), acknowledged = record() && receipts.has(record().operationId);
      listOk = picks.ok;
      await shell.refreshReminders();
      listOk = true;
      if (acknowledged) { assert.equal(record(), undefined); outcome = 'acknowledged'; }
      assert.equal(f.count('operateReminder'), sent, 'a refresh sends nothing');
    } else assert.equal(action, '', `Unmapped model action ${action}`);
    sameState(observe(), trace.steps[index].state, trace, index);
    const detail = f.render().ev;
    if (detail) assert.equal(detail.reminderReopenable, event().reminderStatus === 'completed', 'Reopen is offered on a completed reminder only');
    // Whatever runs, no second reminder write starts beside it; a reminder shown as open is not reopened.
    if (detail && (shell.reminderSaving || event().reminderStatus !== 'completed')) {
      const calls = f.calls.length, asked = approval.asked;
      void detail.reminderReopen(); void detail.reminderReopenTomorrow();
      await f.idle();
      assert.equal(f.calls.length, calls, 'one reminder write at a time, for a completed reminder');
      assert.equal(approval.asked, asked, 'no review is opened for it');
    }
  }
  return trace.steps.length - 1;
}

/** Replays ReminderReopen traces against the real reminder adapter's Reopen and Reopen tomorrow. */
export async function checkReminderReopen(mutate) {
  const compiled = await buildReminderAdapter(mutate), traces = await modelTraces({...model, traces: 30, steps: 40});
  let steps = 0;
  for (const trace of traces) steps += await replay(compiled, trace);
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}

/** Replays the missing wall time separately from the ordinary valid-time schedules. */
export async function checkReminderReopenDstGap(extraSources = [], mutate) {
  const compiled = await buildReminderAdapter(mutate);
  const sources = [...compiled.sources, 'specs/quint/refinement/application/reminder-adapter-fixture.mjs',
    'specs/quint/refinement/application/reminder-reopen.mjs', ...extraSources];
  const driverHashes = captureInputs(sources);
  const priorZone = process.env.TZ;
  const f = reminderAdapterFixture(compiled);
  let shell;
  process.env.TZ = 'America/New_York';
  try {
    // Saturday afternoon. The reminder's original 02:30 is valid on Saturday
    // but tomorrow's clocks advance directly from 01:59 to 03:00.
    f.state.now = Date.parse('2027-03-13T17:00:00Z');
    const dueAt = Date.parse('2027-03-13T07:30:00Z');
    assert.equal(new Date(dueAt).getHours(), 2);
    assert.equal(new Date(dueAt).getMinutes(), 30);
    assert.equal(new Date(2027, 2, 14, 2, 30).getHours(), 3);
    const target = {sourceId: 'closed-store', sourceRevision: 'a'.repeat(64), reminderId: 'd1',
      occurrenceId: 'occurrence-1', revision: 'b'.repeat(64), timingVersion: 2};
    Object.assign(f.handlers, {
      listReminders: () => ({reminders: [{id: 'd1', title: 'Dated', body: '', at: dueAt, dueAt,
        alertMinutes: 0, mode: 'inexact', status: 'completed', occurrenceId: target.occurrenceId, target}]}),
      surfaceInfo: () => ({reminderTodoVersion: 1, reminderTapVersion: 1, reminderTimingVersion: 2}),
      pendingReminderTap: () => ({}),
    });
    let reviews = 0;
    Object.defineProperty(f.state, 'confirm', {get() { reviews++; return false; }});
    shell = new f.Shell();
    shell.componentDidMount();
    await f.idle();
    f.calendar.open = open;
    const observe = () => ({
      's.selected': f.calendar.open === open, 's.completed': f.calendar.events.find(item => item.id === open)?.reminderStatus === 'completed',
      's.saving': !!shell.reminderSaving, 's.operates': f.count('operateReminder'),
      's.journal': Object.keys(f.journal(actions)).length === 0 ? 'none' : 'tomorrow',
      's.outcome': f.toasts.at(-1) === 'Time skipped (DST)' ? 'dst-gap' : 'none',
    });
    const detail = f.render().ev;
    assert.equal(detail.reminderReopenable, true);
    const before = observe(), calls = f.calls.length;
    await detail.reminderReopenTomorrow();
    await f.idle();
    assert.equal(reviews, 0, 'A missing civil time never reaches confirmation');
    assert.equal(f.calls.length, calls, 'A missing civil time never reads the journal or calls native');
    return await checkTraces({model: model.module, id: 'ReminderReopenDstGap', sources, driverHashes, scope: 'bounded-component',
      traces: [{name: 'missing local reminder time tomorrow', expect: before, steps: [
        {label: 'Reopen tomorrow refuses before review or admission', action: {name: 'refuseTomorrowInGap'}, expect: observe()},
      ]}], assumptions: ['The actual reminder adapter and pinned schedule helper execute under an injected clock in New York.',
        'Reminder rows, native calls and durable storage use closed fixture ports. The device calendar and other time zones are outside this replay.']});
  } finally {
    shell?.componentWillUnmount();
    if (priorZone === undefined) delete process.env.TZ;
    else process.env.TZ = priorZone;
  }
}
