import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {checkHostedDigestRefresh} from '../specs/quint/refinement/application/hosted-digest-refresh.mjs';

test('mounted digest refresh preserves source-bound session and Home attribution', {timeout: 120000}, async () => {
  const receipt = await checkHostedDigestRefresh([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 9);
  assert.equal(receipt.observedFields.length, 14);
  assert.deepEqual(Object.keys(receipt.actions).sort(),
    ['close', 'historyReply', 'open', 'poll', 'selectSession', 'statusReply', 'syncReply', 'visibility']);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
});
