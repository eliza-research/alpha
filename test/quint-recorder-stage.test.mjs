import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {runRecorderStageReplay} from '../specs/quint/refinement/application/recorder-stage.mjs';

// RecorderStage model traces (scenarios, witnesses and random walks from the pinned Quint CLI)
// replayed step by step against chat Transcribe in the installed voice adapter, with the recording
// driver's start, stop, transcription and stop events as held ports.
test('chat Transcribe follows every RecorderStage model trace', {timeout: scaledTimeout(300000)}, async () => {
  const receipt = await runRecorderStageReplay();
  assert.equal(receipt.traces, 95);
  assert.ok(receipt.checkpoints > 2000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['enter', 'close', 'staleSettled', 'primaryStart', 'startSettled', 'primaryStop', 'stopSettled', 'maxDuration', 'captureLost',
    'primaryTranscribe', 'transcribeSettled', 'cancelTranscribe', 'apply'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
