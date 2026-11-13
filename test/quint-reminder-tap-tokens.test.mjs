import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {actionCounts, modelTraces, sameState} from '../specs/quint/refinement/application/calendar-itf.mjs';
import {buildReminderAdapter, reminderAdapterFixture} from '../specs/quint/refinement/application/reminder-adapter-fixture.mjs';

const model = {path: 'specs/quint/application/ReminderTapTokens.qnt', module: 'ReminderTapTokens',
  witnesses: ['QueuedRecheckWitness', 'NewerTapDuringCheckWitness', 'ChangedTargetKeptWitness', 'QuestionOpenWitness',
    'ConsumedWitness', 'NewerTapWaitsForOwnerWitness'],
  goals: {
    secondTapConsumed: 's.lastConsumed == 2',
    questionConsumed: 's.lastConsumed != 0 and s.question and s.questionOpen == 0 and s.detail == s.lastConsumed',
    questionReleased: 's.question and s.questionOpen == 0 and s.banner and s.detail == s.nativeToken and s.nativeToken != 0 and not(s.busy)',
    questionKeptForChangedReminder: 's.question and s.questionOpen == 0 and s.detail == s.nativeToken and not(s.retained) and not(s.busy) and s.banner',
    newerTapLeftAfterOpen: 's.detail != 0 and s.nativeToken > s.detail and s.lastConsumed == 0 and not(s.busy) and s.banner',
    queuedCheckRuns: 's.stage == "list" and s.captured == 2 and s.detail == 0 and s.lastConsumed == 0',
    interactionAfterOpen: 's.interaction >= 2 and s.detail == 0 and s.nativeToken == 1 and not(s.busy) and s.lastConsumed == 0 and s.banner and s.retained and s.targetListed and not(s.blocked)',
  }};
const targetOf = token => ({sourceId: 'closed-store', sourceRevision: 'a'.repeat(64), reminderId: 'r' + token,
  occurrenceId: 'first', revision: String(token).repeat(64), timingVersion: 2});
const numberOf = token => token ? Number(String(token).slice(6)) : 0;

async function replay(compiled, trace) {
  const f = reminderAdapterFixture(compiled);
  const native = {token: 0, issued: 0, retained: true, listed: true, question: false, lastConsumed: 0};
  let captured = 0, capturedQuestion = false, consumedUnseen = false, openedWhileBlocked = false;
  const detail = () => f.state.view === 'calendar' && /^reminder:r\d$/.test(f.calendar.open ?? '') ? Number(f.calendar.open.slice(10)) : 0;
  const pending = () => native.token ? {token: 'token-' + native.token, retained: native.retained, question: native.question,
    // A changed reminder no longer has the tapped revision.
    target: native.retained ? targetOf(native.token) : {...targetOf(native.token), revision: 'f'.repeat(64)}} : {};
  const reminders = () => ({reminders: [1, 2, 3].filter(token => token <= native.issued && (token !== native.token || native.listed))
    .map(token => ({id: 'r' + token, title: 'Reminder ' + token, body: '', at: f.state.now + 3600000, dueAt: f.state.now + 3600000,
      alertMinutes: 0, status: 'posted', occurrenceId: 'first', target: targetOf(token)}))});
  Object.assign(f.handlers, {
    listReminders: reminders, pendingReminderTap: pending,
    surfaceInfo: () => ({reminderTodoVersion: 1, reminderTapVersion: 1, reminderTimingVersion: 2}),
    reminderOperationReceipt: () => ({status: 'unknown'}),
    consumeReminderTap({token}) {
      // Native consumes only its current, unchanged tap.
      if (numberOf(token) !== native.token || !native.retained) throw Error('The pending tap changed');
      consumedUnseen ||= detail() !== native.token;
      native.lastConsumed = native.token; native.token = 0;
      return {};
    },
    releaseReminderQuestion: () => ({}),
  });
  const shell = new f.Shell();
  shell.componentDidMount();
  await f.idle();
  const base = f.tap().interaction;
  f.state.holdCommits = true;
  f.hold('pendingReminderTap', 1000); f.hold('listReminders', 1000);
  // The second token read of a check follows its reminder read.
  const tokenRead = () => f.calls.at(-1).name === 'pendingReminderTap' && f.calls.at(-2).name === 'listReminders' ? 'confirm' : 'read';
  const observe = () => {
    const flags = f.tap();
    const stage = f.commits.length ? 'opened' : f.waiting('listReminders') ? 'list' : f.waiting('pendingReminderTap') ? tokenRead() : 'idle';
    assert.equal(f.commits.length + f.waiting('listReminders') + f.waiting('pendingReminderTap') <= 1, true, 'one awaited step');
    // A check captures a token at its first read and holds it until it ends.
    if (!flags.busy || stage === 'read') { captured = 0; capturedQuestion = false; }
    return {nativeToken: native.token, issued: native.issued, retained: native.retained, targetListed: native.listed,
      question: native.question, lastConsumed: native.lastConsumed, busy: flags.busy, requested: flags.requested, stage,
      captured, capturedQuestion, interaction: flags.interaction - base, blocked: f.document.hidden,
      banner: !!f.calendar.reminderTapPending, detail: detail(), questionOpen: numberOf(f.state.question && f.calendar.reminderTapToken
        ? 'token-' + Number(f.state.question.notice.id.slice(1)) : ''),
      consumedUnseen, openedWhileBlocked};
  };
  // The check's own snapshot of the interaction count is not readable from outside it.
  const same = index => {
    const {interactionAt: _unobserved, ...expected} = trace.steps[index].state;
    sameState(observe(), expected, trace, index);
  };
  same(0);
  for (let index = 1; index < trace.steps.length; index++) {
    const {action, picks} = trace.steps[index], opened = f.opened.length;
    if (action === 'tap') Object.assign(native, {token: native.issued + 1, issued: native.issued + 1, retained: true, listed: true,
      question: picks.flag});
    else if (action === 'check') {
      if (picks.flag) f.listeners.get('pendingReminderTap')({}); else f.window.dispatchEvent(new Event('focus'));
      await f.idle();
    } else if (action === 'readPending') {
      const answer = pending();
      await f.settle('pendingReminderTap', () => answer);
      if (f.tap().busy && answer.token && answer.retained && !f.waiting('pendingReminderTap')) {
        captured = numberOf(answer.token); capturedQuestion = !!answer.question;
      }
    } else if (action === 'listed') await f.settle('listReminders');
    else if (action === 'confirm') await f.settle('pendingReminderTap');
    else if (action === 'afterOpen') { f.commits.shift()(); await f.idle(); }
    else if (action === 'closeQuestion') {
      // The review asks the adapter whether the question may still be answered, then consumes or releases.
      const review = f.state.question;
      let allowed = false;
      if (picks.flag) {
        const recheck = review.recheck();
        await f.idle();
        if (f.waiting('pendingReminderTap')) await f.settle('pendingReminderTap');
        if (f.waiting('listReminders')) await f.settle('listReminders');
        allowed = await recheck;
      }
      await (allowed ? review.consume() : review.release());
      f.state.question = undefined;
      review.closed();
      await f.idle();
      // Closing refreshes only the saved-link banner.
      await f.settle('pendingReminderTap');
    } else if (action === 'interact') { shell.goHome(); await f.idle(); }
    else if (action === 'setBlocked') f.document.hidden = picks.flag;
    else if (action === 'targetChanged') native.retained = false;
    else if (action === 'targetUnlisted') native.listed = false;
    else assert.equal(action, '', `Unmapped model action ${action}`);
    if (f.opened.length > opened) openedWhileBlocked ||= f.document.hidden;
    same(index);
  }
  return trace.steps.length - 1;
}

async function checkReminderTapTokens(mutate) {
  const compiled = await buildReminderAdapter(mutate), traces = await modelTraces({...model, traces: 30, steps: 40});
  let steps = 0;
  for (const trace of traces) steps += await replay(compiled, trace);
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}

test('the reminder adapter follows every ReminderTapTokens model step', {timeout: scaledTimeout(280000)}, async () => {
  const result = await checkReminderTapTokens();
  assert.equal(result.traces, 43);
  for (const action of ['tap', 'check', 'readPending', 'listed', 'confirm', 'afterOpen', 'closeQuestion', 'interact',
    'setBlocked', 'targetChanged', 'targetUnlisted', 'stutter']) assert.ok(result.actions[action] > 0, action);
  assert.ok(result.sources.includes('apps/app/src/prototype/reminder-adapter.ts'));
});

test('a second check started while one is running is rejected by the replay', {timeout: scaledTimeout(280000)}, async () => {
  const guard = 'if (tapBusy) {';
  await assert.rejects(checkReminderTapTokens(code => {
    assert.ok(code.includes(guard));
    return code.replace(guard, 'if (false) {');
  }), /one awaited step|check/);
});
