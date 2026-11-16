import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {checkBrowserAgentOpen} from '../specs/quint/refinement/application/browser-agent-open.mjs';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';

test('Browser agent opens and renderer commands match the real adapter and coordinator', {timeout:scaledTimeout(120000)}, async () => {
  const receipt = await checkBrowserAgentOpen([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 12);
  assert.equal(receipt.checkpoints, 56);
  assert.equal(receipt.passed && receipt.inputsUnchanged && receipt.driverInputsBound, true);
  assert.equal(verifyRefinementReceiptInputs(receipt), true);
  assert.equal(receipt.actions.presentSkipped, 1);
  assert.equal(receipt.actions.claimStale, 1);
  assert.equal(receipt.actions.commandSend, 2);
});
