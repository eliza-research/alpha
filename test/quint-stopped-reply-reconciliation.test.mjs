import assert from 'node:assert/strict';
import test from 'node:test';
import {checkStoppedReplyReconciliation} from '../specs/quint/refinement/application/stopped-reply-reconciliation.mjs';

test('stopped-reply model schedules match the current connection controller', {timeout: 120000}, async () => {
  const receipt = await checkStoppedReplyReconciliation();
  assert.equal(receipt.traces, 10);
  assert.equal(receipt.actions.busySendRefused, 1);
  assert.equal(receipt.actions.readSettles, 7);
  assert.ok(receipt.checkpoints > 50);
  assert.equal(receipt.inputsUnchanged, true);
  assert.equal(receipt.driverInputsBound, true);
});
