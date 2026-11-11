import assert from 'node:assert/strict';
import test from 'node:test';
import {checkReminderTodoAttempt} from '../specs/quint/refinement/application/reminder-todo-attempt.mjs';

test('the reminder adapter follows every ReminderTodoAttempt model step', {timeout: 240000}, async () => {
  const result = await checkReminderTodoAttempt();
  assert.equal(result.traces, 17);
  for (const action of ['addTodo', 'nativeSave', 'readback', 'startDecision', 'finishDecision', 'stutter'])
    assert.ok(result.actions[action] > 0, action);
  assert.ok(result.sources.includes('apps/app/src/prototype/reminder-adapter.ts'));
});

test('a retry that mints a new id is rejected by the replay', {timeout: 240000}, async () => {
  const reuse = 'todoOwner.todoAttempt?.body === body ?';
  await assert.rejects(checkReminderTodoAttempt(code => {
    assert.ok(code.includes(reuse));
    return code.replace(reuse, 'false ?');
  }), /addTodo/);
});
