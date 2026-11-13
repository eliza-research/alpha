import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {runReadAloudReplay} from '../specs/quint/refinement/application/read-aloud.mjs';

// ReadAloud model traces (scenarios, witnesses and random walks from the pinned Quint CLI) replayed
// step by step against message Listen and note read-aloud in prototype/local-speech-playback.ts,
// with the on-device voice's preparation and playback as gated ports.
test('message Listen and note read-aloud follow every ReadAloud model trace', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await runReadAloudReplay();
  assert.equal(receipt.traces, 89);
  assert.ok(receipt.checkpoints > 2000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['listenMessage', 'messageReady', 'messagePlaybackEnds', 'messageContextLost', 'readNote', 'noteReady', 'notePlaybackEnds', 'stopNote', 'retirementSettles'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
