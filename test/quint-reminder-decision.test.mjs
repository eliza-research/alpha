import assert from 'node:assert/strict';
import test from 'node:test';
import {checkReminderDecision} from '../specs/quint/refinement/application/reminder-decision.mjs';

test('reminder Done, Snooze and Delete follow every ReminderDecision model step', {timeout: 280000}, async () => {
  const result = await checkReminderDecision();
  assert.equal(result.traces, 40);
  for (const action of ['start', 'lookup', 'selectedRead', 'afterRetain', 'operated', 'receipt', 'leave', 'reopen', 'changedElsewhere',
    'refresh', 'stutter']) assert.ok(result.actions[action] > 0, action);
  for (const source of ['apps/app/src/prototype/reminder-adapter.ts', 'apps/app/src/runtime/reminder-deletions.ts',
    'apps/app/src/runtime/reminder-journal-store.ts']) assert.ok(result.sources.includes(source), source);
});

test('dropping the record of a decision that reached native is rejected by the replay', {timeout: 280000}, async () => {
  const guard = 'if (createdInput && !dispatched)';
  await assert.rejects(checkReminderDecision(code => {
    assert.ok(code.includes(guard));
    return code.replaceAll(guard, 'if (createdInput)');
  }), /receipt|start|lookup/);
});
