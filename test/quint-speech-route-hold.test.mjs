import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {runSpeechRouteHoldReplay} from '../specs/quint/refinement/application/speech-route-hold.mjs';

// SpeechRouteHold model traces (scenarios, witnesses and random walks from the pinned Quint CLI)
// replayed step by step against speechRoute, noteNetworkSpeechFailure and clearNetworkSpeechHold in
// runtime/voice-selection.ts, with the account, the stored Cloud limit and the clock as ports.
test('the speech route and its network hold follow every SpeechRouteHold model trace', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await runSpeechRouteHoldReplay();
  assert.equal(receipt.traces, 95);
  assert.ok(receipt.checkpoints > 2000, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['accountChanges', 'limitChanges', 'timePasses', 'failure', 'clearHold'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
