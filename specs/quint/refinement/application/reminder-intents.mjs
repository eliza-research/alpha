import assert from 'node:assert/strict';
import {actionCounts, modelTraces, sameState} from './calendar-itf.mjs';
import {buildReminderAdapter, reminderAdapterFixture} from './reminder-adapter-fixture.mjs';

const model = {path: 'specs/quint/application/ReminderIntents.qnt', module: 'ReminderIntents',
  witnesses: ['UnresolvableCreationWitness', 'HistoryFullOfPendingWitness', 'UnknownOperationWitness', 'OperationsFullWitness',
    'FoundRowWitness', 'OtherRowKnownWitness'],
  goals: {
    refusedForFullHistory: 's.createRefusedFull',
    foundRowsTrimmed: 's.foundRows == 1 and s.pendingAbsent == 1 and s.schedules == 4',
    lateSaveFound: 's.schedules == 1 and s.foundRows == 1 and s.attempts == 1 and not(s.formHasId) and s.pendingAbsent == 0 and s.opAttempts == 0',
    receiptAcknowledged: 's.operates == 2 and Ops == 0 and s.opStage == "idle"',
    abandonedBoth: 's.attempts == 2 and s.schedules == 0 and s.opAttempts == 2 and s.operates == 0 and s.stage == "idle" and s.opStage == "idle"',
  }};
// The model's two-row histories stand in for the journals' 32 and 100 rows.
const limits = [['REMINDER_CREATION_LIMIT = 32', 'REMINDER_CREATION_LIMIT = 2'], ['REMINDER_ACTION_LIMIT = 100', 'REMINDER_ACTION_LIMIT = 2']];
const bounded = mutate => code => {
  for (const [real, small] of limits) { assert.ok(code.includes(real), real); code = code.replace(real, small); }
  return mutate ? mutate(code) : code;
};
const creations = 'reminder-creations:v1:device', actions = 'reminder-deletions:v1:device';
const targetOf = id => ({sourceId: 'closed-store', sourceRevision: 'a'.repeat(64), reminderId: id, occurrenceId: 'occurrence-' + id,
  revision: 'b'.repeat(64), timingVersion: 2});

async function replay(compiled, trace) {
  const f = reminderAdapterFixture(compiled);
  const rows = new Map(), receipts = new Set(), withheld = new Map();
  let attempts = 0, opAttempts = 0, schedules = 0, operates = 0, dispatchWithoutRecord = false, operateWithoutRecord = false;
  let createRefusedFull = false, stage = 'idle', opStage = 'idle', created = '', operated = '', outcome = '', receiptLost = false;
  const due = f.state.now + 2 * 3600000;
  for (let index = 1; index <= 4; index++) rows.set('d' + index, {id: 'd' + index, title: 'Dated ' + index, body: '', at: due, dueAt: due,
    alertMinutes: 0, mode: 'inexact', status: 'scheduled', occurrenceId: 'occurrence-d' + index, target: targetOf('d' + index)});
  const saved = request => ({...request, mode: 'inexact', status: 'scheduled', occurrenceId: 'occurrence-' + request.id,
    target: targetOf(request.id)});
  const result = (input, status) => ({version: 1, kind: input.operation.type, sourceId: 'closed-store',
    reminderId: input.operation.target.reminderId, occurrenceId: input.operation.target.occurrenceId, revision: 'c'.repeat(64),
    status, at: due, dueAt: due, alertMinutes: 0});
  Object.assign(f.handlers, {
    listReminders: () => ({reminders: [...rows.values()].map(row => structuredClone(row))}),
    surfaceInfo: () => ({reminderTodoVersion: 1, reminderTapVersion: 1, reminderTimingVersion: 2}),
    pendingReminderTap: () => ({}),
    selectedReminder: ({id}) => structuredClone(rows.get(id).target),
    scheduleReminder(request) {
      schedules++;
      dispatchWithoutRecord ||= f.journal(creations)[request.id]?.state !== 'pending';
      if (outcome === 'scheduled' || outcome === 'lost-saved') rows.set(request.id, saved(request));
      // A save that lands later is the same request.
      if (outcome === 'lost-absent') withheld.set(request.id, saved(request));
      if (outcome === 'scheduled') return {status: 'scheduled', id: request.id};
      if (outcome === 'refused') return {status: 'storage-full', id: request.id};
      throw Error('The answer was lost');
    },
    operateReminder(input) {
      operates++;
      operateWithoutRecord ||= !f.journal(actions)[input.operationId];
      if (outcome !== 'lost-never') { receipts.add(input.operationId); rows.get(input.operation.target.reminderId).status = 'completed'; }
      if (outcome === 'succeeded') return {status: 'succeeded', result: result(input, 'completed')};
      receiptLost = outcome === 'lost-applied';
      throw Error('The answer was lost');
    },
    reminderOperationReceipt(input) {
      if (receiptLost) { receiptLost = false; throw Error('The answer was lost'); }
      return receipts.has(input.operationId) ? {status: 'succeeded', result: result(input, 'completed')} : {status: 'unknown'};
    },
  });
  const shell = new f.Shell();
  shell.componentDidMount();
  await f.idle();
  assert.equal(f.calendar.events.length, 4);
  const observe = () => {
    // The running save's own record is counted by `attemptRetained` until its outcome is known.
    const history = Object.values(f.journal(creations)).filter(row => stage === 'idle' || row.id !== created);
    const pending = history.filter(row => row.state === 'pending');
    const operations = Object.keys(f.journal(actions)), formId = f.calendar.form?.reminderCreationId;
    const own = formId && stage !== 'retain' ? f.journal(creations)[formId] : undefined;
    assert.equal(f.waiting('secureRead') + f.waiting('scheduleReminder') + f.waiting('operateReminder') <= 1, true);
    return {pendingKnown: pending.filter(row => rows.has(row.id)).length, pendingAbsent: pending.filter(row => !rows.has(row.id)).length,
      foundRows: history.length - pending.length,
      saving: !!shell.reminderSaving && stage !== 'idle', stage,
      // The form carries its id from the moment the save starts; the record follows at retain.
      formHasId: !!formId && stage !== 'retain',
      attemptRetained: stage !== 'idle' && !!f.journal(creations)[created],
      formRow: !own || stage === 'dispatch' ? 'none' : own.state === 'found' ? 'found' : rows.has(own.id) ? 'known' : 'absent',
      attempts, schedules, dispatchWithoutRecord, createRefusedFull,
      opsSucceeded: operations.filter(id => receipts.has(id)).length - (opStage === 'retained' && receipts.has(operated) ? 1 : 0),
      opsUnknown: operations.filter(id => !receipts.has(id)).length - (opStage === 'retained' ? 1 : 0),
      opStage, opRetained: opStage !== 'idle' && !!f.journal(actions)[operated], opAttempts, operates, operateWithoutRecord};
  };
  sameState(observe(), trace.steps[0].state, trace, 0);
  for (let index = 1; index < trace.steps.length; index++) {
    const {action, picks} = trace.steps[index];
    if (action === 'startCreate') {
      attempts++;
      f.calendar.open = null;
      f.calendar.form = {id: null, title: 'Created ' + attempts, off: 1, t: 10, d: 1, where: '', video: false, who: [],
        cal: 'alpha-reminders', repeat: 'none', alert: 0, notes: ''};
      f.state.confirm = picks.flag;
      // The save pauses before its record is written and again once it is confirmed written.
      f.hold('secureRead', 2, 1);
      void f.render().f.save();
      await f.idle();
      assert.equal(f.waiting('secureRead'), 1, 'an admitted save retains its record first');
      created = f.calendar.form.reminderCreationId; stage = 'retain';
    } else if (action === 'retain') {
      const sent = f.toasts.length;
      await f.settle('secureRead');
      stage = f.journal(creations)[created] ? 'dispatch' : 'idle';
      if (stage === 'idle') {
        // A history full of unconfirmed creations refuses the record; the handler's cleanup reads on.
        f.release('secureRead');
        while (f.waiting('secureRead')) await f.settle('secureRead');
        assert.equal(f.journal(creations)[created], undefined);
        assert.equal(f.toasts.at(-1), 'Unconfirmed');
        assert.equal(f.toasts.length, sent + 1);
        createRefusedFull = true;
      }
    } else if (action === 'abandon') {
      f.calendar.form = {...f.calendar.form, title: 'Changed'};
      await f.settle('secureRead');
      stage = 'idle'; f.calendar.form = null;
    } else if (action === 'dispatch') {
      outcome = picks.outcome;
      await f.settle('secureRead');
      stage = 'idle';
    } else if (action === 'saveAgain') {
      const sent = f.calls.filter(call => call.name === 'scheduleReminder').length;
      await f.render().f.save();
      await f.idle();
      assert.equal(f.calls.filter(call => call.name === 'scheduleReminder').length, sent, 'a retained form is never scheduled again');
    } else if (action === 'closeForm') f.calendar.form = null;
    else if (action === 'lateSave') {
      const own = f.calendar.form?.reminderCreationId;
      const id = picks.own ? own : [...withheld.keys()].find(key => key !== own && !rows.has(key) && f.journal(creations)[key]);
      assert.ok(id && withheld.has(id), 'an unconfirmed creation whose reminder is not saved yet');
      rows.set(id, withheld.get(id)); withheld.delete(id);
    } else if (action === 'reconcileCreations' || action === 'reconcileOperations') {
      const sent = f.calls.filter(call => ['scheduleReminder', 'operateReminder'].includes(call.name)).length;
      // The refresh's own journal reads are not the paused save's: only that save's next read waits.
      if (stage === 'retain') f.release('secureRead');
      await shell.refreshReminders();
      if (stage === 'retain') f.hold('secureRead', 1);
      assert.equal(f.calls.filter(call => ['scheduleReminder', 'operateReminder'].includes(call.name)).length, sent, 'recovery only reads');
    } else if (action === 'startOperation') {
      opAttempts++;
      f.calendar.form = null;
      f.calendar.open = 'reminder:d' + opAttempts;
      // The decision pauses once its record is confirmed written, before it reaches native.
      f.hold('secureRead', 1, 2);
      void f.render().ev.reminderDone();
      await f.idle();
      assert.equal(f.waiting('secureRead'), 1, 'an admitted decision retains its record first');
      operated = Object.keys(f.journal(actions)).find(id => f.journal(actions)[id].operation.target.reminderId === 'd' + opAttempts);
      opStage = 'retained';
    } else if (action === 'abandonOperation') {
      f.calendar.open = null;
      await f.settle('secureRead');
      opStage = 'idle';
    } else if (action === 'operate') {
      outcome = picks.result;
      await f.settle('secureRead');
      opStage = 'idle'; f.calendar.open = null;
    } else assert.equal(action, '', `Unmapped model action ${action}`);
    sameState(observe(), trace.steps[index].state, trace, index);
  }
  return trace.steps.length - 1;
}

export async function checkReminderIntents(mutate) {
  const compiled = await buildReminderAdapter(bounded(mutate)), traces = await modelTraces({...model, traces: 30, steps: 40});
  let steps = 0;
  for (const trace of traces) steps += await replay(compiled, trace);
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}
