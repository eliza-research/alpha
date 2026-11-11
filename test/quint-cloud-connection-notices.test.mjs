import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {checkCloudConnectionNotices} from '../specs/quint/refinement/application/cloud-connection-notices.mjs';

test('mounted Cloud notices refine independent dismissal and Settings ownership', {timeout:scaledTimeout(600000)}, async () => {
  const receipt = await checkCloudConnectionNotices(['test/quint-cloud-connection-notices.test.mjs']);
  assert.equal(receipt.traces, 2);
  assert.equal(receipt.observedFields.length, 8);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
