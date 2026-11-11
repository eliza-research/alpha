import assert from 'node:assert/strict';
import test from 'node:test';
import {checkReminderIntents} from '../specs/quint/refinement/application/reminder-intents.mjs';

test('reminder saves and decisions follow every ReminderIntents model step', {timeout: 280000}, async () => {
  const result = await checkReminderIntents();
  assert.equal(result.traces, 41);
  for (const action of ['startCreate', 'retain', 'abandon', 'dispatch', 'saveAgain', 'closeForm', 'lateSave', 'reconcileCreations',
    'startOperation', 'abandonOperation', 'operate', 'reconcileOperations', 'stutter']) assert.ok(result.actions[action] > 0, action);
  for (const source of ['apps/app/src/prototype/reminder-adapter.ts', 'apps/app/src/runtime/reminder-creations.ts',
    'apps/app/src/runtime/reminder-deletions.ts', 'apps/app/src/runtime/reminder-journal-store.ts'])
    assert.ok(result.sources.includes(source), source);
});

test('dropping the record of a dispatched creation is rejected by the replay', {timeout: 280000}, async () => {
  const guard = 'if (created && !dispatched)';
  await assert.rejects(checkReminderIntents(code => {
    assert.ok(code.includes(guard));
    return code.replace(guard, 'if (created)');
  }), /dispatch/);
});
