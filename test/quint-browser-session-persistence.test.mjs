import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBrowserSessionPersistence} from '../specs/quint/refinement/application/browser-session-persistence.mjs';

test('the adapter\'s saved-tabs writer follows every BrowserSessionPersistence trace', {timeout: 240000}, async () => {
  const receipt = await checkBrowserSessionPersistence();
  assert.equal(receipt.traces, 51);
  assert.ok(receipt.scenarios.includes('failedClearRetriesUnchangedSnapshotTest'));
  assert.ok(receipt.witnesses.includes('FailedClearRetryWitness'));
  assert.ok(receipt.checkpoints > 800, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['edit', 'touch', 'restoreSettles', 'poll', 'tick', 'writeSettles', 'clearStart', 'clearSettles'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
