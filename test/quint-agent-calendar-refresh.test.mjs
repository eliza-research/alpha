import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkAgentCalendarRefresh} from '../specs/quint/refinement/application/agent-calendar-refresh.mjs';

test('Agent Calendar keeps only authorized feed and next-event readback', {timeout: scaledTimeout(120000)}, async () => {
  const receipt = await checkAgentCalendarRefresh([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 25);
  assert.equal(receipt.checkpoints, 237);
});
