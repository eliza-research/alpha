import assert from 'node:assert/strict';
import test from 'node:test';
import {checkCloudConnectionNotices} from '../specs/quint/refinement/application/cloud-connection-notices.mjs';

test('mounted Cloud notices refine independent dismissal and Settings ownership', {timeout:600000}, async () => {
  const receipt = await checkCloudConnectionNotices(['test/quint-cloud-connection-notices.test.mjs']);
  assert.equal(receipt.traces, 2);
  assert.equal(receipt.observedFields.length, 10);
  assert.ok(receipt.observedFields.includes('expiryInSettings'));
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
