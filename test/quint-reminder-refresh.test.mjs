import assert from 'node:assert/strict';
import test from 'node:test';
import {checkReminderRefresh} from '../specs/quint/refinement/application/reminder-refresh.mjs';

test('the reminder adapter follows every ReminderRefresh model step', {timeout: 240000}, async () => {
  const result = await checkReminderRefresh();
  assert.equal(result.traces, 34);
  for (const action of ['refresh', 'deviceRead', 'reminderChanged', 'reminderOpened', 'complete', 'unmount', 'stutter'])
    assert.ok(result.actions[action] > 0, action);
  assert.ok(result.sources.includes('apps/app/src/prototype/reminder-adapter.ts'));
});

test('a superseded refresh that publishes is rejected by the replay', {timeout: 240000}, async () => {
  const guard = 'generation !== this.reminderRefreshGeneration';
  await assert.rejects(checkReminderRefresh(code => {
    assert.ok(code.includes(guard));
    return code.replaceAll(guard, 'false');
  }), /complete/);
});
