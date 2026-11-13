import {scaledTimeout} from '../specs/quint/refinement/timeouts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {replayWakeListenerStop} from '../specs/quint/refinement/native/wake-listener-stop.mjs';

const rewrite = change => ({rewrite: {'runtime/always-on-listener.ts': change}});
const actions = ['admission', 'request', 'requestWithoutPort', 'requestWhileAdmitted', 'requestOffAndroid', 'replyArrives',
  'replyFails', 'deadline', 'lateReply'];
test('the wake listener stop follows every WakeListenerStop model step', {timeout: scaledTimeout(240000)}, async () => {
  const receipt = await replayWakeListenerStop({traces: 150, maxSteps: 20});
  assert.equal(receipt.traces, 155);
  assert.ok(receipt.steps > 1200, JSON.stringify(receipt));
  for (const action of actions) assert.ok(receipt.actions[action] > 0, action);
});
test('a binding that forgets an unconfirmed verdict is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayWakeListenerStop({traces: 150, maxSteps: 20, ...rewrite(text =>
    text.replace('wakeStopUnconfirmed = !stopped;', 'if (stopped) wakeStopUnconfirmed = false;'))}), /trace \d+ step \d+ /);
});
test('a binding that calls a missing listener port is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayWakeListenerStop({traces: 150, maxSteps: 20, ...rewrite(text =>
    text.replace('stopSenseListenerForChatOnly(nativeListener() ? listener : undefined)', 'stopSenseListenerForChatOnly(listener)'))}), /trace \d+ step \d+ /);
});
test('a binding that stops an admitted listener is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayWakeListenerStop({traces: 150, maxSteps: 20, ...rewrite(text =>
    text.replace("if (imageSenseAvailable() || Capacitor.getPlatform() !== 'android'", "if (Capacitor.getPlatform() !== 'android'"))}), /trace \d+ step \d+ /);
});
test('a skipped request that clears the warning is rejected by the replay', {timeout: scaledTimeout(240000)}, async () => {
  await assert.rejects(replayWakeListenerStop({traces: 150, maxSteps: 20, ...rewrite(text =>
    text.replace("|| !Capacitor.isNativePlatform()) return true;", "|| !Capacitor.isNativePlatform()) { wakeStopUnconfirmed = false; return true; }"))}), /trace \d+ step \d+ /);
});
