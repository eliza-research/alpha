import test from 'node:test';
import assert from 'node:assert/strict';
import {runPendingActionRecoveryReplay} from '../specs/quint/refinement/application/pending-action-recovery.mjs';

// PendingActionRecovery model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against recoverPendingActions, with the connection, the pending read,
// the expiry timer and the clock replaced by ports.
test('pending action recovery follows every PendingActionRecovery model trace', {timeout: 240000}, async () => {
  const receipt = await runPendingActionRecoveryReplay();
  assert.equal(receipt.traces, 89);
  assert.ok(receipt.checkpoints > 2500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['sync', 'bindingChanged', 'block', 'unblock', 'readSettles', 'timerFires', 'continuation'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
