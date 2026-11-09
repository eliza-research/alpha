import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyRefinementReceiptInputs} from '../specs/quint/refinement/check-traces.mjs';
import {checkGmailAgentMailboxRecovery} from '../specs/quint/refinement/services/gmail-agent-mailbox-recovery.mjs';

test('Gmail agent mailbox confirms the exact review and only reads back a lost dispatch', {timeout: 30000}, async () => {
  const receipt = await checkGmailAgentMailboxRecovery([fileURLToPath(import.meta.url)]);
  assert.equal(receipt.traces, 45);
  assert.equal(receipt.checkpoints, 299);
  assert.ok(receipt.passed && receipt.driverInputsBound && verifyRefinementReceiptInputs(receipt));
  const outcome = name => receipt.traceInputs.find(trace => trace.name === name).steps.at(-1).expect;
  assert.equal(outcome('lost success reads one receipt and repeat stays read-only')['s.totalDispatches'], 1);
  assert.equal(outcome('lost uncertain reply never resubmits a durable unknown')['s.result'], 'unconfirmed');
  assert.equal(outcome('readback abort preserves first dispatch error')['s.result'], 'dispatch-error');
  assert.equal(outcome('abort before dispatch transport')['s.totalDispatches'], 0);
});
