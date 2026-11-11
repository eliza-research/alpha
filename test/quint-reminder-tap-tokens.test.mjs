import assert from 'node:assert/strict';
import test from 'node:test';
import {checkReminderTapTokens} from '../specs/quint/refinement/application/reminder-tap-tokens.mjs';

test('the reminder adapter follows every ReminderTapTokens model step', {timeout: 280000}, async () => {
  const result = await checkReminderTapTokens();
  assert.equal(result.traces, 43);
  for (const action of ['tap', 'check', 'readPending', 'listed', 'confirm', 'afterOpen', 'closeQuestion', 'interact',
    'setBlocked', 'targetChanged', 'targetUnlisted', 'stutter']) assert.ok(result.actions[action] > 0, action);
  assert.ok(result.sources.includes('apps/app/src/prototype/reminder-adapter.ts'));
});

test('a second check started while one is running is rejected by the replay', {timeout: 280000}, async () => {
  const guard = 'if (tapBusy) {';
  await assert.rejects(checkReminderTapTokens(code => {
    assert.ok(code.includes(guard));
    return code.replace(guard, 'if (false) {');
  }), /one awaited step|check/);
});
