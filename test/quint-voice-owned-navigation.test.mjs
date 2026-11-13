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
import {runVoiceOwnedNavigationReplay} from '../specs/quint/refinement/application/voice-owned-navigation.mjs';

// VoiceOwnedNavigation model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against the voice surface's navigation claim, its currency check and
// its shell navigation wrappers, with the shell and the adapter's cleanup replaced by ports.
test("partial source contract: the voice navigation claim follows every VoiceOwnedNavigation model trace", {timeout: 240000}, async () => {
  const receipt = await runVoiceOwnedNavigationReplay();
  assert.equal(receipt.traces, 90);
  assert.ok(receipt.checkpoints > 2500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['startVoice', 'claimDestination', 'contextPinned', 'contextChanges', 'applySettles', 'userNavigates', 'finish', 'stopVoice'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
