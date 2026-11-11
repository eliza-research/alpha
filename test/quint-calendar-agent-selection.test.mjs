import assert from 'node:assert/strict';
import test from 'node:test';
import {checkCalendarAgentSelection} from '../specs/quint/refinement/application/calendar-agent-selection.mjs';

test('the calendar adapter follows every CalendarAgentSelection model step', {timeout: 280000}, async () => {
  const result = await checkCalendarAgentSelection();
  assert.equal(result.traces, 38);
  for (const action of ['openEvent', 'renderDetail', 'inspected', 'closeEvent', 'refresh', 'commitElsewhere', 'providerChange',
    'newForm', 'sourcePrepared', 'pickCalendar', 'closeForm', 'stutter']) assert.ok(result.actions[action] > 0, action);
  assert.ok(result.sources.includes('apps/app/src/prototype/calendar-adapter.ts'));
});

test('an inspection answer kept after its epoch ended is rejected by the replay', {timeout: 280000}, async () => {
  const guard = 'token === agentSelectionEpoch';
  await assert.rejects(checkCalendarAgentSelection(code => {
    assert.ok(code.includes(guard));
    return code.replaceAll(guard, 'true');
  }), /retired answer is dropped|inspected|sourcePrepared/);
});
