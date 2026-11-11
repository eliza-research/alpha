import test from 'node:test';
import assert from 'node:assert/strict';
import {replayCameraFocusWrites} from '../specs/quint/refinement/application/camera-focus-writes.mjs';

test('browser tap-to-focus follows every CameraFocusWrites model step', {timeout: 180000}, async () => {
  const receipt = await replayCameraFocusWrites({traces: 300, maxSteps: 14});
  assert.equal(receipt.traces, 300);
  assert.ok(receipt.steps > 1000, JSON.stringify(receipt));
  for (const action of ['tapFocus', 'clear', 'trackEnds', 'driverReplies']) assert.ok(receipt.actions[action] > 0, action);
});
test('a focus controller that marks a retired tap as applied is rejected by the replay', {timeout: 180000}, async () => {
  await assert.rejects(replayCameraFocusWrites({traces: 300, maxSteps: 14, rewrite: {'browser/camera-focus.ts': text =>
    text.replace("const alive=()=>token===this.epoch&&target.isConnected&&track.readyState==='live';", 'const alive=()=>true;')}}), /trace \d+ step \d+ /);
});
