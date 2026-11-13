import test from 'node:test';
import assert from 'node:assert/strict';
import {modelNames} from '../specs/quint/refinement/services/maps-model-traces.mjs';
import {replayMapsNotificationOpen} from '../specs/quint/refinement/application/maps-notification-open.mjs';

test('the notification-tap latch follows every MapsNotificationOpen model trace step by step', {timeout: 300000}, async () => {
  const {scenarios, witnesses} = modelNames('specs/quint/application/MapsNotificationOpen.qnt');
  assert.equal(scenarios.length, 8);
  assert.equal(witnesses.length, 6);
  const result = await replayMapsNotificationOpen({scenarios, witnesses});
  console.log(JSON.stringify(result));
  assert.equal(result.traces, scenarios.length + witnesses.length + 120);
  assert.ok(result.checkpoints > result.traces * 5);
  for (const action of ['coldTap', 'tap', 'setReady', 'flush', 'nativeReads', 'readSettles', 'cancel', 'dispose']) assert.ok(result.actions[action] > 0, action);
});
