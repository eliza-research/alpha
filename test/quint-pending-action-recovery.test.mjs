// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {runPendingActionRecoveryReplay} from '../specs/quint/refinement/application/pending-action-recovery.mjs';

// PendingActionRecovery model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against recoverPendingActions, with the connection, the pending read,
// the expiry timer and the clock replaced by ports.
test("partial source contract: pending action recovery follows every PendingActionRecovery model trace", {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await runPendingActionRecoveryReplay();
  assert.equal(receipt.traces, 89);
  assert.ok(receipt.checkpoints > 2500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['sync', 'bindingChanged', 'block', 'unblock', 'readSettles', 'timerFires', 'continuation'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
