import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkAgentCalendarEventReturn} from '../specs/quint/refinement/application/agent-calendar-event-return.mjs';

test('canonical Calendar return confirms the captured selection through independently held exact reads', {timeout: 120000}, async () => {
  const receipt = await checkAgentCalendarEventReturn([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 38);
  assert.equal(receipt.checkpoints, 203);
});
