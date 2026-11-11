import test from 'node:test';
import assert from 'node:assert/strict';
import {runVoiceOwnedNavigationReplay} from '../specs/quint/refinement/application/voice-owned-navigation.mjs';

// VoiceOwnedNavigation model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against the voice surface's navigation claim, its currency check and
// its shell navigation wrappers, with the shell and the adapter's cleanup replaced by ports.
test('the voice navigation claim follows every VoiceOwnedNavigation model trace', {timeout: 240000}, async () => {
  const receipt = await runVoiceOwnedNavigationReplay();
  assert.equal(receipt.traces, 90);
  assert.ok(receipt.checkpoints > 2500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['startVoice', 'claimDestination', 'contextPinned', 'contextChanges', 'applySettles', 'userNavigates', 'finish', 'stopVoice'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
