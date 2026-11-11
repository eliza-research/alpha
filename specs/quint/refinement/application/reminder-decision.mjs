import assert from 'node:assert/strict';
import {actionCounts, modelTraces, sameState} from './calendar-itf.mjs';
import {buildReminderAdapter, reminderAdapterFixture} from './reminder-adapter-fixture.mjs';

const model = {path: 'specs/quint/application/ReminderDecision.qnt', module: 'ReminderDecision',
  witnesses: ['UnconfirmedRecordWitness', 'ReadBackOnlyWitness', 'ConflictWitness', 'LeftAfterRetainWitness', 'ChangedWitness',
    'AppliedAwaitingRefreshWitness'],
  goals: {
    readBackConfirms: 's.outcome == "done" and s.operates == 1 and s.starts == 2 and s.journal == "none"',
    refreshAcknowledges: 's.outcome == "done" and s.operates == 1 and s.starts == 1 and s.journal == "none" and s.stale',
    twoConfirmed: 's.operates == 2 and s.retains == 2 and s.journal == "none" and s.outcome == "done"',
    deleteWaitsForJournaledDecision: 's.outcome == "conflict" and s.journal == "snooze" and s.starts >= 3 and s.operates == 1',
  }};
const actions = 'reminder-deletions:v1:device', open = 'reminder:d1';
const kinds = {reminder_complete: 'done', reminder_snooze: 'snooze', reminder_cancel: 'cancel'};
const unconfirmed = 'Unconfirmed';

async function replay(compiled, trace) {
  const f = reminderAdapterFixture(compiled);
  const due = f.state.now + 2 * 3600000, receipts = new Map(), seen = new Set();
  const native = {revision: 1, status: 'scheduled'};
  let listOk = true, decision = 'none', stage = 'idle', starts = 0, outcome = 'none', mintedBefore = 0;
  let operateWithoutRecord = false, startedStale = false, result = '';
  const target = () => ({sourceId: 'closed-store', sourceRevision: 'a'.repeat(64), reminderId: 'd1', occurrenceId: 'first',
    revision: String(native.revision).repeat(64), timingVersion: 2});
  const done = input => ({version: 1, kind: input.operation.type, sourceId: 'closed-store', reminderId: 'd1',
    occurrenceId: input.operation.type === 'reminder_snooze' ? 'first' : 'next', revision: String(native.revision).repeat(64),
    status: input.operation.type === 'reminder_snooze' ? 'scheduled' : 'completed', at: due, dueAt: due, alertMinutes: 0});
  const apply = input => {
    native.revision++; native.status = input.operation.type === 'reminder_snooze' ? 'scheduled' : 'completed';
    receipts.set(input.operationId, done(input));
  };
  Object.assign(f.handlers, {
    listReminders() {
      if (!listOk) throw Error('Secure store locked');
      return {reminders: [{id: 'd1', title: 'Dated', body: '', at: due, dueAt: due, alertMinutes: 0, mode: 'inexact', status: native.status,
        occurrenceId: 'first', target: target()}]};
    },
    surfaceInfo: () => ({reminderTodoVersion: 1, reminderTapVersion: 1, reminderTimingVersion: 2}),
    pendingReminderTap: () => ({}),
    selectedReminder: target,
    reviewReminder: () => ({status: 'cancelled'}),
    operateReminder(input) {
      operateWithoutRecord ||= !f.journal(actions)[input.operationId];
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
  const shown = () => f.calendar.events.find(row => row.id === open).reminderTarget.revision;
  const stale = () => !!f.calendar.reminderStale || !!shell.reminderRefreshFailed;
  const observe = () => {
    const row = record();
    if (row) seen.add(row.operationId);
    return {stale: stale(), selected: f.calendar.open === open, saving: !!shell.reminderSaving, stage, decision,
      journal: row ? kinds[row.operation.type] : 'none',
      own: !!row && stage !== 'idle' && Number(row.operationId.slice(-12)) > mintedBefore,
      applied: !!row && receipts.has(row.operationId), revisionCurrent: shown() === target().revision,
      starts, retains: seen.size, operates: f.count('operateReminder'), outcome, operateWithoutRecord, startedStale};
  };
  const finish = (value, toast) => {
    stage = 'idle'; decision = 'none'; outcome = value;
    if (toast) assert.match(f.toasts.at(-1), toast);
  };
  sameState(observe(), trace.steps[0].state, trace, 0);
  for (let index = 1; index < trace.steps.length; index++) {
    const {action, picks} = trace.steps[index], said = f.toasts.length;
    if (action === 'start') {
      starts++; decision = picks.decision; mintedBefore = f.state.uuid; startedStale ||= stale();
      const detail = f.render().ev;
      f.hold('secureRead', 1);
      void (decision === 'done' ? detail.reminderDone() : decision === 'snooze' ? detail.reminderSnooze() : detail.del());
      await f.idle();
      assert.equal(f.waiting('secureRead'), 1, 'an admitted decision reads the journal first');
      stage = 'lookup';
    } else if (action === 'lookup') {
      const journaled = record() ? kinds[record().operation.type] : 'none', sent = f.count('operateReminder');
      if (journaled === decision) f.hold('reminderOperationReceipt', 1);
      else if (journaled === 'none' && decision !== 'cancel') f.hold('selectedReminder', 1);
      await f.settle('secureRead');
      if (journaled === decision) { assert.equal(f.waiting('reminderOperationReceipt'), 1); stage = 'receipt'; }
      else if (journaled !== 'none') finish('conflict', /^Unconfirmed$/);
      else if (decision === 'cancel') { assert.equal(f.calls.at(-2).name, 'reviewReminder'); finish('review'); assert.equal(f.toasts.length, said); }
      else { assert.equal(f.waiting('selectedReminder'), 1); stage = 'select'; }
      assert.equal(f.count('operateReminder'), sent, 'reading the journal sends nothing');
    } else if (action === 'selectedRead') {
      const current = shown() === target().revision, selected = f.calendar.open === open;
      // The write pauses once its record is confirmed written.
      if (current && selected) f.hold('secureRead', 1, 1);
      await f.settle('selectedReminder');
      if (!current) finish('changed', /^Changed$/);
      else if (!selected) { finish('left'); assert.equal(f.toasts.length, said); }
      else { assert.equal(f.waiting('secureRead'), 1); stage = 'retained'; }
    } else if (action === 'afterRetain') {
      const selected = f.calendar.open === open;
      if (selected) f.hold('operateReminder', 1);
      await f.settle('secureRead');
      if (selected) { assert.equal(f.waiting('operateReminder'), 1); stage = 'operate'; }
      else { finish('left'); assert.equal(f.toasts.length, said); assert.equal(record(), undefined, 'the unsent record is removed'); }
    } else if (action === 'operated') {
      result = picks.result;
      if (result !== 'succeeded') f.hold('reminderOperationReceipt', 1);
      await f.settle('operateReminder');
      if (result === 'succeeded') finish('done', /^(Done|Snoozed)/);
      else { assert.equal(f.waiting('reminderOperationReceipt'), 1); stage = 'receipt'; }
    } else if (action === 'receipt') {
      const sent = f.count('operateReminder'), confirmed = picks.ok && receipts.has(record().operationId);
      await f.settle('reminderOperationReceipt', input => { if (!picks.ok) throw Error('The answer was lost'); return f.handlers.reminderOperationReceipt(input); });
      assert.equal(f.count('operateReminder'), sent, 'a journaled decision is only read back');
      finish(confirmed ? 'done' : 'unconfirmed', confirmed ? /^(Done|Snoozed)/ : /^Unconfirmed$/);
    } else if (action === 'leave') f.calendar.open = null;
    else if (action === 'reopen') f.calendar.open = open;
    else if (action === 'changedElsewhere') native.revision++;
    else if (action === 'refresh') {
      const sent = f.count('operateReminder'), acknowledged = record() && receipts.has(record().operationId);
      listOk = picks.ok;
      await shell.refreshReminders();
      listOk = true;
      if (acknowledged) { assert.equal(record(), undefined); outcome = 'done'; }
      assert.equal(f.count('operateReminder'), sent, 'a refresh sends nothing');
    } else assert.equal(action, '', `Unmapped model action ${action}`);
    sameState(observe(), trace.steps[index].state, trace, index);
    // Whatever runs, no second reminder write starts beside it.
    if (shell.reminderSaving) {
      const calls = f.calls.length, detail = f.render().ev;
      if (detail) { void detail.reminderDone(); void detail.reminderSnooze(); void detail.del(); }
      await f.idle();
      assert.equal(f.calls.length, calls, 'one reminder write at a time');
    }
  }
  return trace.steps.length - 1;
}

export async function checkReminderDecision(mutate) {
  const compiled = await buildReminderAdapter(mutate), traces = await modelTraces({...model, traces: 30, steps: 40});
  let steps = 0;
  for (const trace of traces) steps += await replay(compiled, trace);
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}
