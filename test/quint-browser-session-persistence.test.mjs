// Partial source contract regression evidence. Original schedules, actions and assertions are retained.
// Only the selected source members/components and controlled ports execute; this is not whole-file refinement.
import {after as afterPartialContract} from 'node:test';
import partialContractAssert from 'node:assert/strict';
import {fileURLToPath as partialContractFile} from 'node:url';
import {captureReplayClosure as capturePartialClosure} from '../specs/quint/refinement/observed-replay.mjs';
import {captureInputs as capturePartialInputs} from '../specs/quint/refinement/check-traces.mjs';
const partialContractInputs = capturePartialClosure([partialContractFile(import.meta.url)]);
afterPartialContract(() => partialContractAssert.deepEqual(capturePartialInputs(Object.keys(partialContractInputs)), partialContractInputs));

import test from 'node:test';
import assert from 'node:assert/strict';
import {checkBrowserSessionPersistence} from '../specs/quint/refinement/application/browser-session-persistence.mjs';

test("partial source contract: the adapter's saved-tabs writer follows every BrowserSessionPersistence trace", {timeout: 240000}, async () => {
  const receipt = await checkBrowserSessionPersistence();
  assert.equal(receipt.traces, 51);
  assert.ok(receipt.scenarios.includes('failedClearRetriesUnchangedSnapshotTest'));
  assert.ok(receipt.witnesses.includes('FailedClearRetryWitness'));
  assert.ok(receipt.checkpoints > 800, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['edit', 'touch', 'restoreSettles', 'poll', 'tick', 'writeSettles', 'clearStart', 'clearSettles'])
    assert.ok(receipt.actions[action] > 0, `${action} is replayed`);
});
