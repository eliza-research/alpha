import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {runSpeechCleanupLatchReplay} from '../specs/quint/refinement/native/speech-cleanup-latch.mjs';

// SpeechCleanupLatch model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against reviewed app speech and Cloud app speech with the real
// retirement gate. The voice-surface and read-aloud chains are outside this replay. No audio.
test('partial source contract: app speech and Cloud app speech follow every SpeechCleanupLatch model trace', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await runSpeechCleanupLatchReplay();
  assert.equal(receipt.traces, 96);
  assert.ok(receipt.checkpoints > 2500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['speak', 'finishPlayback', 'cleanupSettled', 'recoveryStopSettled', 'restart'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
