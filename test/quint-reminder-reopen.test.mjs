import assert from 'node:assert/strict';
import test from 'node:test';
import {checkReminderReopen} from '../specs/quint/refinement/application/reminder-reopen.mjs';

test('Reopen and Reopen tomorrow follow every ReminderReopen model step', {timeout: 280000}, async () => {
  const result = await checkReminderReopen();
  assert.equal(result.traces, 46);
  for (const action of ['start', 'lookup', 'selectedRead', 'afterRetain', 'operated', 'receipt', 'readback', 'leave', 'show',
    'changedElsewhere', 'completeAgain', 'tick', 'refresh', 'stutter']) assert.ok(result.actions[action] > 0, action);
  for (const source of ['apps/app/src/prototype/reminder-adapter.ts', 'apps/app/src/runtime/reminder-deletions.ts',
    'apps/app/src/runtime/reminder-journal-store.ts']) assert.ok(result.sources.includes(source), source);
});

test('reporting a reopen whose read back shows the reminder completed again is rejected by the replay', {timeout: 280000}, async () => {
  const guard = 'if (!saved || saved.status === "completed" || saved.occurrenceId === event.reminderOccurrence || saved.dueAt !== schedule.dueAt) throw Error("Mismatch");';
  await assert.rejects(checkReminderReopen(code => {
    assert.ok(code.includes(guard));
    return code.replace(guard, '');
  }), /Unconfirmed|readback/);
});

test('reopening at a reviewed time that has passed is rejected by the replay', {timeout: 280000}, async () => {
  const guard = /if \(schedule\.at <= Date\.now\(\)\) \{\s*api\.toast\("Time passed"\);\s*return;\s*\}/;
  await assert.rejects(checkReminderReopen(code => {
    assert.match(code, guard);
    return code.replace(guard, '');
  }), /nothing is read without an approved, future time|start/);
});
