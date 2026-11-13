import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {actionCounts, modelTraces, sameState} from '../specs/quint/refinement/application/calendar-itf.mjs';
import {buildReminderAdapter, reminderAdapterFixture} from '../specs/quint/refinement/application/reminder-adapter-fixture.mjs';

const model = {path: 'specs/quint/application/ReminderTodoAttempt.qnt', module: 'ReminderTodoAttempt',
  witnesses: ['SavedButUnconfirmedWitness', 'RepeatedDispatchWitness', 'SameTextTwiceWitness', 'RefusedWitness',
    'SavedNotListedWitness']};
const idOf = uuid => Number(String(uuid).slice(-12));
const textOf = title => Number(String(title).slice(5));
const outcomes = [[/^Saved$/, 'saved'], [/^Unconfirmed$/, 'unconfirmed'],
  [/Nothing was saved\.$/, 'refused']];

async function replay(compiled, trace) {
  const f = reminderAdapterFixture(compiled);
  const rows = new Map(), minted = {1: 0, 2: 0, 3: 0, 4: 0}, dispatches = {1: 0, 2: 0, 3: 0, 4: 0};
  let adds = 0, retries = 0, response = 'none';
  const listed = () => ({reminders: [...rows.values()].map(row => structuredClone(row))});
  Object.assign(f.handlers, {
    listReminders: listed,
    surfaceInfo: () => ({reminderTodoVersion: 1, reminderTapVersion: 1, reminderTimingVersion: 2}),
    pendingReminderTap: () => ({}),
    reminderOperationReceipt: () => ({status: 'unknown'}),
  });
  const shell = new f.Shell();
  shell.componentDidMount();
  await f.idle();
  assert.equal(shell.reminderTodoVersion, 1);
  const observe = () => {
    const attempt = shell.todoAttempt;
    const said = f.toasts.map(text => outcomes.find(([pattern]) => pattern.test(text))?.[1]).filter(Boolean).at(-1) ?? 'none';
    return {saving: !!shell.reminderSaving,
      stage: f.waiting('saveTodo') ? 'save' : f.waiting('listReminders') ? 'read' : f.waiting('todoDecision') ? 'decision' : 'idle',
      attemptId: attempt ? idOf(attempt.id) : 0, attemptText: attempt ? textOf(attempt.title) : 0,
      minted: f.state.uuid, textOf: {...minted}, adds, retries,
      saved: [...rows.keys()].sort((a, b) => a - b), response,
      listed: f.render().todos.map(item => idOf(item.id)).sort((a, b) => a - b), outcome: said, dispatches: {...dispatches}};
  };
  sameState(observe(), trace.steps[0].state, trace, 0);
  for (let index = 1; index < trace.steps.length; index++) {
    const {action, picks} = trace.steps[index];
    if (action === 'addTodo') {
      const before = f.state.uuid, sent = f.count('saveTodo');
      f.hold('saveTodo'); f.hold('listReminders');
      void f.render().addTodo('text ' + picks.text);
      await f.idle();
      assert.equal(f.count('saveTodo'), sent + 1, 'an admitted save reaches native once');
      adds++;
      if (f.state.uuid === before) retries++;
      else minted[f.state.uuid] = picks.text;
      const request = f.held.find(call => call.name === 'saveTodo').args;
      assert.deepEqual(request, {id: shell.todoAttempt.id, title: 'text ' + picks.text, body: ''});
    } else if (action === 'nativeSave') {
      await f.settle('saveTodo', ({id, title}) => {
        dispatches[idOf(id)]++;
        const answer = picks.answer;
        // Native keeps one to-do per id: an identical retry changes nothing.
        if (answer === 'saved' || answer === 'lost-saved') {
          if (!rows.has(idOf(id))) rows.set(idOf(id), {id, title, body: '', at: 0, status: 'todo', undated: true,
            createdAt: idOf(id), target: {reminderId: id}});
        }
        response = answer === 'saved' ? 'saved' : answer === 'refused' ? 'refused' : 'none';
        if (answer === 'saved') return {status: 'todo', id};
        if (answer === 'refused') return {status: 'storage-full', id};
        throw Error('The answer was lost');
      });
    } else if (action === 'readback') {
      await f.settle('listReminders', () => { if (!picks.flag) throw Error('Secure store locked'); return listed(); });
      response = 'none';
    } else if (action === 'startDecision') {
      // The model names the to-do and the decision when it finishes; the handler needs both now.
      const finish = trace.steps.slice(index + 1).find(step => step.action === 'finishDecision');
      const id = finish?.picks.id ?? idOf(f.render().todos[0].id), remove = finish?.picks.flag ?? false;
      const todo = f.render().todos.find(item => idOf(item.id) === id);
      assert.ok(todo, 'a saved to-do is listed');
      f.hold('todoDecision');
      void (remove ? todo.remove() : todo.done ? todo.reopen() : todo.complete());
      await f.idle();
    } else if (action === 'finishDecision') {
      await f.settle('todoDecision', ({target, action: decision}) => {
        const id = idOf(target.reminderId);
        assert.equal(id, picks.id);
        assert.equal(decision === 'cancel', picks.flag);
        if (decision === 'cancel') rows.delete(id);
        else rows.get(id).status = decision === 'done' ? 'completed' : 'todo';
        return {status: decision === 'cancel' ? 'cancelled' : rows.get(id).status, id: target.reminderId};
      });
    } else assert.equal(action, '', `Unmapped model action ${action}`);
    sameState(observe(), trace.steps[index].state, trace, index);
    // Whatever the model refuses here, the handlers refuse too: a second write never starts.
    if (shell.reminderSaving) {
      const sent = f.calls.length;
      void f.render().addTodo('text 1');
      for (const todo of f.render().todos) void todo.complete();
      await f.idle();
      assert.equal(f.calls.length, sent, 'no native call while a reminder write is running');
      sameState(observe(), trace.steps[index].state, trace, index);
    }
  }
  return trace.steps.length - 1;
}

async function checkReminderTodoAttempt(mutate) {
  const compiled = await buildReminderAdapter(mutate), traces = await modelTraces(model);
  let steps = 0;
  for (const trace of traces) steps += await replay(compiled, trace);
  return {traces: traces.length, steps, actions: actionCounts(traces), sources: compiled.sources};
}

test('the reminder adapter follows every ReminderTodoAttempt model step', {timeout: scaledTimeout(240000)}, async () => {
  const result = await checkReminderTodoAttempt();
  assert.equal(result.traces, 17);
  for (const action of ['addTodo', 'nativeSave', 'readback', 'startDecision', 'finishDecision', 'stutter'])
    assert.ok(result.actions[action] > 0, action);
  assert.ok(result.sources.includes('apps/app/src/prototype/reminder-adapter.ts'));
});

test('a retry that mints a new id is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  const reuse = 'todoOwner.todoAttempt?.body === body ?';
  await assert.rejects(checkReminderTodoAttempt(code => {
    assert.ok(code.includes(reuse));
    return code.replace(reuse, 'false ?');
  }), /addTodo/);
});
