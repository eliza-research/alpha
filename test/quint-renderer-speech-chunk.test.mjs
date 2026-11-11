import test from 'node:test';
import assert from 'node:assert/strict';
import {runRendererSpeechChunkReplay} from '../specs/quint/refinement/native/renderer-speech-chunk.mjs';

// RendererSpeechChunk model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against playOwnedSpeech over a synthetic voice plugin. No audio.
test('owned renderer speech follows every RendererSpeechChunk model trace', {timeout: 240000}, async () => {
  const receipt = await runRendererSpeechChunkReplay();
  assert.equal(receipt.traces, 92);
  assert.ok(receipt.checkpoints > 2000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['begin', 'listenerRegistered', 'abort', 'prepareResult', 'latePrepare', 'waitElapsed', 'playResult', 'terminalEvent',
    'observeFinished', 'disposeSettled']) assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
