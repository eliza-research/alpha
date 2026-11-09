import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkHostedBackgroundAdmission} from '../specs/quint/refinement/application/hosted-background-admission.mjs';

test('renderer hosted background setup and pause preserve exact attempt and session authority', {timeout: 120000}, async () => {
  const receipt = await checkHostedBackgroundAdmission([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 9);
  assert.deepEqual(Object.keys(receipt.actions).sort(), ['abort', 'beginReply', 'configReply', 'pause', 'start']);
  assert.deepEqual(receipt.observedFields, ['s.android', 's.attempts', 's.disables', 's.pauseOutcome', 's.target']);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
