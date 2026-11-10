import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkScheduledSnoozeAdmission} from '../specs/quint/refinement/application/scheduled-snooze-admission.mjs';

test('explicit schedule snooze refines recurrence selection and exact receipt admission', async () => {
  const receipt = await checkScheduledSnoozeAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.traces, 25);
  assert.equal(receipt.observedFields.length, 12);
});
