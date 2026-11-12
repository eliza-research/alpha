import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {checkPersonalAssistantScheduledTaskCustody} from '../specs/quint/refinement/services/personal-assistant-scheduled-task-custody.mjs';

test('selected Personal Assistant scheduling policies refine the pinned SQL custody model', {timeout: scaledTimeout(60_000)}, async () => {
  const {receipt, obligations} = await checkPersonalAssistantScheduledTaskCustody();
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 8);
  assert.equal(obligations.length, 1);
});
