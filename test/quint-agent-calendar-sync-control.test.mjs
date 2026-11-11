import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkAgentCalendarSyncControl} from '../specs/quint/refinement/application/agent-calendar-sync-control.mjs';

test('linked Calendar control retains exact current review and destination ownership through readback', {timeout: scaledTimeout(180000)}, async () => {
  const receipt = await checkAgentCalendarSyncControl([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 36);
  assert.equal(receipt.checkpoints, 267);
});
