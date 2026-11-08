import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkHostedNoticeQuestion} from '../specs/quint/refinement/application/hosted-notice-question.mjs';

test('hosted result questions refine actual review, readback and post-settlement ownership', {timeout: 120000}, async () => {
  const receipt = await checkHostedNoticeQuestion([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 23);
  assert.equal(receipt.observedFields.length, 19);
  assert.ok(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound);
});
