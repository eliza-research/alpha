import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkWorkflowNoticeDelivery} from '../specs/quint/refinement/native/workflow-notice-delivery.mjs';

test('native workflow notices refine exact route, durable claim and acknowledgement', async () => {
  const {receipt} = await checkWorkflowNoticeDelivery([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.driverInputsBound, true);
  assert.equal(receipt.traces, 14);
  assert.equal(receipt.checkpoints, 204);
  assert.ok(receipt.observedFields.includes('ReplyAcknowledged'));
});
