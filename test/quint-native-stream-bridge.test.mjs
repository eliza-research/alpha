import test from 'node:test';
import assert from 'node:assert/strict';
import {runNativeStreamBridgeReplay} from '../specs/quint/refinement/native/native-stream-bridge.mjs';

// NativeStreamBridge model traces (scenarios, witnesses and random walks from the pinned Quint
// CLI) replayed step by step against streamNativeAgent over a synthetic Capacitor port. No device
// or agent runtime.
test('the native stream bridge follows every NativeStreamBridge model trace', {timeout: 240000}, async () => {
  const receipt = await runNativeStreamBridgeReplay();
  assert.equal(receipt.traces, 70);
  assert.ok(receipt.checkpoints > 1500, `checkpoints ${receipt.checkpoints}`);
  for (const action of ['listenerAttached', 'requestStream', 'requestRejected', 'responseEvent', 'chunkEvent', 'completeEvent', 'abort', 'finish'])
    assert.ok(receipt.actions[action] > 0, `${action} was replayed`);
});
