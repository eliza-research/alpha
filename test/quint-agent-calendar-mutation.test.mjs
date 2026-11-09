import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkAgentCalendarMutation} from '../specs/quint/refinement/application/agent-calendar-mutation.mjs';

test('Agent Calendar mutates only after current preservation and defers the latest refresh', {timeout: 120000}, async () => {
  const receipt = await checkAgentCalendarMutation([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 24);
  assert.equal(receipt.checkpoints, 134);
});
