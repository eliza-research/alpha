import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {checkHostedDigestMutation} from '../specs/quint/refinement/application/hosted-digest-mutation.mjs';

test('mounted digest saves and discard preserve exact journal and publication ownership', {timeout: 120000}, async () => {
  const receipt = await checkHostedDigestMutation([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 8);
  assert.equal(receipt.observedFields.length, 13);
  assert.deepEqual(Object.keys(receipt.actions).sort(),
    ['attach', 'discard', 'mutationReply', 'refreshReply', 'removeReply', 'restore', 'retry']);
  assert.ok(receipt.passed && receipt.driverInputsBound && receipt.inputsUnchanged);
});
