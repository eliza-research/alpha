import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayNativeMapsLocation} from '../specs/quint/refinement/native/maps-location.mjs';

test('the Maps location owner follows every NativeMapsLocation model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/native/NativeMapsLocation.qnt');
  assert.equal(scenarios.length, 11);
  assert.equal(witnesses.length, 8);
  const result = await replayNativeMapsLocation({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 60);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['start', 'stop', 'cleanupSettles', 'permissionChecked', 'permissionAnswered', 'hide', 'show', 'listenersAdded', 'watchSettles', 'nativeFix', 'nativeError']) assert.ok(result.actions[action] > 0, action);
});
